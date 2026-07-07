import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BUILTIN_WHITELIST } from './constants';

@Injectable()
export class ProcessBlacklistService {
  constructor(private prisma: PrismaService) {}

  // ── Blacklist CRUD ──

  async listBlacklist(studioId: string, page = 1, pageSize = 20) {
    const where = { studioId };
    const [items, total] = await Promise.all([
      this.prisma.processBlacklist.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.processBlacklist.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async addBlacklist(studioId: string, processName: string, processPath?: string) {
    return this.prisma.processBlacklist.create({
      data: { studioId, processName, processPath },
    });
  }

  async updateBlacklist(id: string, studioId: string, data: { isActive?: boolean; processPath?: string }) {
    const entry = await this.prisma.processBlacklist.findUnique({ where: { id } });
    if (!entry || entry.studioId !== studioId) throw new NotFoundException('黑名单条目不存在');
    return this.prisma.processBlacklist.update({ where: { id }, data });
  }

  async removeBlacklist(id: string, studioId: string) {
    const entry = await this.prisma.processBlacklist.findUnique({ where: { id } });
    if (!entry || entry.studioId !== studioId) throw new NotFoundException('黑名单条目不存在');
    return this.prisma.processBlacklist.delete({ where: { id } });
  }

  // ── Companion Overrides ──

  async listCompanionOverrides(companionId: string) {
    return this.prisma.companionBlacklistOverride.findMany({
      where: { companionId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addCompanionOverride(companionId: string, processName: string, processPath?: string) {
    return this.prisma.companionBlacklistOverride.create({
      data: { companionId, processName, processPath },
    });
  }

  async removeCompanionOverride(overrideId: string, companionId: string) {
    const entry = await this.prisma.companionBlacklistOverride.findFirst({
      where: { id: overrideId, companionId },
    });
    if (!entry) throw new NotFoundException('覆盖条目不存在');
    return this.prisma.companionBlacklistOverride.delete({ where: { id: overrideId } });
  }

  // ── Effective Blacklist (studio + companion overrides) ──

  async getEffectiveBlacklist(companionId: string): Promise<{ processName: string; processPath: string | null }[]> {
    const companion = await this.prisma.companion.findUnique({
      where: { id: companionId },
      select: { studioId: true, status: true },
    });
    if (!companion) throw new NotFoundException('陪玩不存在');

    const [studioEntries, overrideEntries, statusEntries] = await Promise.all([
      this.prisma.processBlacklist.findMany({
        where: { studioId: companion.studioId, isActive: true },
        select: { processName: true, processPath: true },
      }),
      this.prisma.companionBlacklistOverride.findMany({
        where: { companionId, isActive: true },
        select: { processName: true, processPath: true },
      }),
      this.prisma.companionStatusBlacklist.findMany({
        where: { companionId, status: companion.status },
        select: { processName: true },
      }),
    ]);

    // Merge: studio defaults → companion override → status blacklist (highest priority)
    const map = new Map<string, { processName: string; processPath: string | null }>();
    for (const e of studioEntries) map.set(e.processName.toLowerCase(), e);
    for (const o of overrideEntries) map.set(o.processName.toLowerCase(), o);
    for (const s of statusEntries) map.set(s.processName.toLowerCase(), { processName: s.processName, processPath: null });

    return Array.from(map.values());
  }

  // ── Whitelist ──

  async ensureBuiltinWhitelist(studioId: string) {
    for (const name of BUILTIN_WHITELIST) {
      await this.prisma.processWhitelist.upsert({
        where: { studioId_processName: { studioId, processName: name } },
        create: { studioId, processName: name, isSystem: true },
        update: {},
      });
    }
  }

  async getWhitelist(studioId: string): Promise<{ processName: string; isSystem: boolean }[]> {
    await this.ensureBuiltinWhitelist(studioId);
    const entries = await this.prisma.processWhitelist.findMany({
      where: { studioId },
      orderBy: [{ isSystem: 'desc' }, { processName: 'asc' }],
    });
    return entries.map((e) => ({ processName: e.processName, isSystem: e.isSystem }));
  }

  async addWhitelist(studioId: string, processName: string, processPath?: string) {
    return this.prisma.processWhitelist.create({
      data: { studioId, processName, processPath, isSystem: false },
    });
  }

  async removeWhitelist(id: string, studioId: string) {
    const entry = await this.prisma.processWhitelist.findFirst({ where: { id, studioId } });
    if (!entry) throw new NotFoundException('白名单条目不存在');
    if (entry.isSystem) throw new ForbiddenException('不能删除系统内置白名单');
    return this.prisma.processWhitelist.delete({ where: { id } });
  }

  // ── Process Reports ──

  async saveProcessReport(companionId: string, processes: any[], totalCount: number) {
    const existing = await this.prisma.companionProcessReport.count({ where: { companionId } });
    if (existing >= 50) {
      const oldest = await this.prisma.companionProcessReport.findMany({
        where: { companionId },
        orderBy: { createdAt: 'asc' },
        take: existing - 49,
        select: { id: true },
      });
      if (oldest.length > 0) {
        await this.prisma.companionProcessReport.deleteMany({
          where: { id: { in: oldest.map((o) => o.id) } },
        });
      }
    }

    return this.prisma.companionProcessReport.create({
      data: {
        companionId,
        processes: processes as any,
        totalCount,
        reportTime: new Date(),
      },
    });
  }

  async getRecentReports(studioId: string, companionId?: string, limit = 20) {
    const where: any = {};
    if (companionId) {
      where.companionId = companionId;
    } else {
      const companions = await this.prisma.companion.findMany({
        where: { studioId },
        select: { id: true },
      });
      where.companionId = { in: companions.map((c) => c.id) };
    }

    return this.prisma.companionProcessReport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        companion: {
          select: {
            user: { select: { username: true } },
          },
        },
      },
    });
  }

  
  /** Extract unique process names from a companion latest report. */
  async getUniqueProcessNames(companionId: string): Promise<string[]> {
    const report = await this.prisma.companionProcessReport.findFirst({
      where: { companionId },
      orderBy: { createdAt: "desc" },
      select: { processes: true },
    });
    if (!report) return [];
    const processes = report.processes as Array<{ name?: string }> | null;
    if (!processes || !Array.isArray(processes)) return [];
    const names = new Set<string>();
    for (const p of processes) {
      if (p.name && typeof p.name === "string") names.add(p.name);
    }
    return Array.from(names).sort();
  }

  async getLatestReport(companionId: string) {
    return this.prisma.companionProcessReport.findFirst({
      where: { companionId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Kill Logs ──

  async logKill(
    companionId: string,
    processName: string,
    pid: number,
    success: boolean,
    resultText?: string,
    processPath?: string,
    triggeredBy = 'PERIODIC',
  ) {
    return this.prisma.processKillLog.create({
      data: { companionId, processName, processPath, pid, success, resultText, triggeredBy },
    });
  }

  async getKillLogs(studioId: string, companionId?: string, page = 1, pageSize = 20) {
    const where: any = {};
    if (companionId) {
      where.companionId = companionId;
    } else {
      const companions = await this.prisma.companion.findMany({
        where: { studioId },
        select: { id: true },
      });
      where.companionId = { in: companions.map((c) => c.id) };
    }

    const [items, total] = await Promise.all([
      this.prisma.processKillLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          companion: {
            select: {
              user: { select: { username: true } },
            },
          },
        },
      }),
      this.prisma.processKillLog.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  // ── Push ──

  async getStudioCompanionIds(studioId: string): Promise<string[]> {
    const companions = await this.prisma.companion.findMany({
      where: { studioId },
      select: { id: true },
    });
    return companions.map((c) => c.id);
  }
}
