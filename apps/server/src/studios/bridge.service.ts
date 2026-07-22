// craftsman-ignore: TS001
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const ALL_FUNCTIONS = ['ORDERS', 'POOL', 'CUSTOMERS', 'BILLING', 'KPI'];
const CACHE_TTL = 5000; // 5 seconds

@Injectable()
export class BridgeService {
  constructor(private prisma: PrismaService) {}

  // In-memory caches to avoid repeated DB queries on every pool/broadcast call
  private bridgedCache = new Map<string, { ids: string[]; ts: number }>();
  private visibleCache = new Map<string, { ids: string[]; ts: number }>();

  private cacheGet(map: Map<string, { ids: string[]; ts: number }>, key: string): string[] | null {
    const entry = map.get(key);
    if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.ids;
    map.delete(key);
    return null;
  }

  private cacheSet(map: Map<string, { ids: string[]; ts: number }>, key: string, ids: string[]) {
    map.set(key, { ids, ts: Date.now() });
  }

  private invalidateCache(studioAId: string, studioBId: string) {
    this.bridgedCache.delete(studioAId);
    this.bridgedCache.delete(studioBId);
    // Also clear all function-specific visible cache entries
    for (const key of this.visibleCache.keys()) {
      if (key.startsWith(studioAId + ':') || key.startsWith(studioBId + ':')) {
        this.visibleCache.delete(key);
      }
    }
    this.visibleCache.delete(studioAId);
    this.visibleCache.delete(studioBId);
  }

  /** Owner proposes a bridge between two studios */
  async propose(studioAId: string, studioBId: string, ownerId: string) {
    const [a, b] = [studioAId, studioBId].sort();
    const existing = await this.prisma.studioBridge.findUnique({
      where: { studioAId_studioBId: { studioAId: a, studioBId: b } },
    });
    if (existing) {
      if (existing.status === 'ACTIVE') throw new ForbiddenException('已打通');
      // Re-propose: reset to PENDING
      await this.prisma.studioBridge.update({ where: { id: existing.id }, data: { status: 'PENDING', proposedBy: ownerId } });
      this.invalidateCache(a, b);
      return existing;
    }
    const bridge = await this.prisma.studioBridge.create({
      data: {
        studioAId: a, studioBId: b, proposedBy: ownerId,
        permissions: { create: ALL_FUNCTIONS.map((f) => ({ function: f })) },
      },
      include: { permissions: true },
    });
    return bridge;
  }

  /** Find a bridge by ID */
  async find(bridgeId: string) {
    return this.prisma.studioBridge.findUnique({ where: { id: bridgeId } });
  }

  /** Admin accepts a bridge for their studio */
  async respond(bridgeId: string, studioId: string, accept: boolean, functionFilter?: string[]) {
    const bridge = await this.prisma.studioBridge.findUnique({ where: { id: bridgeId }, include: { permissions: true } });
    if (!bridge) throw new NotFoundException('Bridge not found');
    if (bridge.status === 'ACTIVE' || bridge.status === 'REJECTED') throw new ForbiddenException('已处理');

    const isA = bridge.studioAId === studioId;
    const isB = bridge.studioBId === studioId;
    if (!isA && !isB) throw new ForbiddenException('无权操作');

    const functions = functionFilter || ALL_FUNCTIONS;
    for (const perm of bridge.permissions) {
      if (functions.includes(perm.function)) {
        await this.prisma.studioBridgePermission.update({
          where: { id: perm.id },
          data: isA ? { acceptedA: accept } : { acceptedB: accept },
        });
      }
    }

    if (!accept) {
      await this.prisma.studioBridge.update({ where: { id: bridgeId }, data: { status: 'REJECTED' } });
      this.invalidateCache(bridge.studioAId, bridge.studioBId);
      return { status: 'REJECTED' };
    }

    // Check if both sides accepted all
    const updated = await this.prisma.studioBridge.findUnique({ where: { id: bridgeId }, include: { permissions: true } });
    if (updated?.permissions.every((p) => p.acceptedA && p.acceptedB)) {
      await this.prisma.studioBridge.update({ where: { id: bridgeId }, data: { status: 'ACTIVE', acceptedAt: new Date() } });
      this.invalidateCache(bridge.studioAId, bridge.studioBId);
      return { status: 'ACTIVE' };
    }
    return { status: 'PENDING' };
  }

  /** Get all active bridge connections for a studio */
  async getActiveBridges(studioId: string | null) {
    if (!studioId) return [];
    return this.prisma.studioBridge.findMany({
      where: {
        status: 'ACTIVE',
        OR: [{ studioAId: studioId }, { studioBId: studioId }],
      },
      include: {
        studioA: { select: { id: true, name: true } },
        studioB: { select: { id: true, name: true } },
        permissions: true,
      },
    });
  }

  /** Get all studio IDs that share data with this studio */
  async getBridgedStudioIds(studioId: string): Promise<string[]> {
    if (!studioId) return [];
    const cached = this.cacheGet(this.bridgedCache, studioId);
    if (cached) return cached;
    const bridges = await this.getActiveBridges(studioId);
    const ids = new Set<string>();
    for (const b of bridges) {
      if (b.studioAId === studioId) ids.add(b.studioBId);
      else ids.add(b.studioAId);
    }
    const result = [...ids];
    this.cacheSet(this.bridgedCache, studioId, result);
    return result;
  }

  /** Get all studio IDs visible to a user (own + bridged), optionally filtered by function */
  async getVisibleStudioIds(studioId: string, fn?: string): Promise<string[]> {
    if (!studioId) return [];
    const cacheKey = fn ? `${studioId}:${fn}` : studioId;
    const cached = this.cacheGet(this.visibleCache, cacheKey);
    if (cached) return cached;
    const own = [studioId];
    if (!fn) {
      const bridged = await this.getBridgedStudioIds(studioId);
      const result = [...own, ...bridged];
      this.cacheSet(this.visibleCache, cacheKey, result);
      return result;
    }
    // Filter bridges by specific function permission
    const bridges = await this.prisma.studioBridge.findMany({
      where: {
        status: 'ACTIVE',
        OR: [{ studioAId: studioId }, { studioBId: studioId }],
        permissions: { some: { function: fn, acceptedA: true, acceptedB: true } },
      },
    });
    const ids = new Set(own);
    for (const b of bridges) {
      if (b.studioAId === studioId) ids.add(b.studioBId);
      else ids.add(b.studioAId);
    }
    const result = [...ids];
    this.cacheSet(this.visibleCache, cacheKey, result);
    return result;
  }

  /** Terminate an active bridge — either side can disconnect at any time */
  async terminate(bridgeId: string, studioId: string) {
    const bridge = await this.prisma.studioBridge.findUnique({ where: { id: bridgeId } });
    if (!bridge) throw new NotFoundException('桥接不存在');
    if (bridge.status !== 'ACTIVE') throw new ForbiddenException('桥接未激活');
    if (bridge.studioAId !== studioId && bridge.studioBId !== studioId) throw new ForbiddenException('无权操作');
    await this.prisma.studioBridge.update({ where: { id: bridgeId }, data: { status: 'REJECTED' } });
    this.invalidateCache(bridge.studioAId, bridge.studioBId);
    return { status: 'REJECTED' };
  }

  /** List pending proposals */
  async listPending(studioId?: string) {
    const where: any = { status: 'PENDING' };
    if (studioId) where.OR = [{ studioAId: studioId }, { studioBId: studioId }];
    return this.prisma.studioBridge.findMany({
      where,
      include: {
        studioA: { select: { id: true, name: true } },
        studioB: { select: { id: true, name: true } },
        permissions: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
