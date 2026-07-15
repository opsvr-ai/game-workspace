import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class StudiosService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.studio.findMany({
      include: { _count: { select: { users: true, companions: true } } },
    });
  }

  async create(
    name: string,
    type: string,
    managerUsername: string,
    managerPassword: string,
    managerDisplayName?: string,
    splitMode?: string,
  ) {
    const passwordHash = await bcrypt.hash(managerPassword, 10);
    return this.prisma.$transaction(async (tx) => {
      const studio = await tx.studio.create({ data: { name, type, splitMode: splitMode ?? 'TIERED' } });
      await tx.user.create({
        data: {
          username: managerUsername,
          passwordHash,
          role: 'ADMIN',
          studioId: studio.id,
          isAuthorized: true,
          displayName: managerDisplayName ?? null,
        },
      });
      return studio;
    });
  }

  async update(id: string, name?: string, type?: string, splitMode?: string) {
    const data: any = {};
    if (name !== undefined) data.name = name;
    if (type !== undefined) data.type = type;
    if (splitMode !== undefined) data.splitMode = splitMode;
    return this.prisma.studio.update({ where: { id }, data });
  }

  async getEmployees(studioId?: string) {
    const users = await this.prisma.user.findMany({
      where: {
        ...(studioId ? { studioId } : {}),
        role: { not: 'OWNER' },
      },
      select: {
        id: true,
        username: true,
        role: true,
        studioId: true,
        isAuthorized: true,
        createdAt: true,
        // 排除 passwordHash 和 secondPasswordHash，防止密码哈希泄露
        studio: { select: { id: true, name: true } },
        companion: { select: { id: true, status: true, monthlyRevenue: true, deposit: true, balance: true, frozen: true, games: true, billingCode: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Add today's order counts per companion
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const todayEnd = new Date(); todayEnd.setHours(23,59,59,999);
    const companionIds = users.filter((u: any) => u.companion?.id).map((u: any) => u.companion!.id);
    if (companionIds.length > 0) {
      const todayOrders = await this.prisma.order.groupBy({
        by: ['companionId'],
        where: { companionId: { in: companionIds }, createdAt: { gte: todayStart, lte: todayEnd }, status: { not: 'CANCELLED' } },
        _count: { id: true },
      });
      const counts = new Map(todayOrders.map((o: any) => [o.companionId, o._count.id]));
      // Add budan counts
      const budanData = await this.prisma.order.findMany({
        where: { companionId: { in: companionIds }, createdAt: { gte: todayStart, lte: todayEnd } },
        select: { companionId: true, customFields: true, notes: true },
      });
      const budanCounts = new Map<string, number>();
      budanData.forEach((o: any) => {
        if ((o.customFields as any)?.deltaNote?.includes('补单') || o.notes?.includes('补单')) {
          budanCounts.set(o.companionId!, (budanCounts.get(o.companionId!) || 0) + 1);
        }
      });
      users.forEach((u: any) => {
        if (u.companion) u.companion.todayOrderCount = (counts.get(u.companion.id) || 0) + (budanCounts.get(u.companion.id) || 0);
      });
    }

    return users;
  }

  async createEmployee(studioId: string, dto: { username: string; password: string; role: string }) {
    const passwordHash = await bcrypt.hash(dto.password, 10);
    return this.prisma.user.create({
      data: {
        username: dto.username,
        passwordHash,
        role: dto.role,
        studioId,
        isAuthorized: true, // 老板创建的账号直接授权
        companion: dto.role === 'COMPANION'
          ? { create: { studioId, billingCode: `Z${Date.now().toString(36).toUpperCase()}` } }
          : undefined,
      },
    });
  }

  async resetPassword(userId: string, newPassword: string) {
    const passwordHash = await bcrypt.hash(newPassword, 10);
    return this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  }

  async deleteEmployee(userId: string) {
    // Delete companion first if exists (cascade), then user
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;
    await this.prisma.user.delete({ where: { id: userId } });
  }
}
