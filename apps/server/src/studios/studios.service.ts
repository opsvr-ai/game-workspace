import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class StudiosService {
  constructor(private prisma: PrismaService) {}

  async listPublic() {
    return this.prisma.studio.findMany({
      select: { id: true, name: true, type: true },
      orderBy: { name: 'asc' },
    });
  }

  async findAll() {
    return this.prisma.studio.findMany({
      include: {
        _count: { select: { users: true, companions: true } },
        users: { select: { id: true, username: true, role: true, displayName: true, realName: true, phone: true, idNumber: true, address: true, leaseContractUrl: true, createdAt: true }, take: 10, orderBy: { createdAt: 'desc' } },
      },
    });
  }

  async create(
    name: string,
    type: string,
    managerUsername: string,
    managerPassword: string,
    managerDisplayName?: string,
    splitMode?: string,
    address?: string,
    leaseContractUrl?: string,
  ) {
    const passwordHash = await bcrypt.hash(managerPassword, 10);
    return this.prisma.$transaction(async (tx) => {
      const studio = await tx.studio.create({ data: { name, type, splitMode: splitMode ?? 'TIERED', address, leaseContractUrl } });
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

  async update(id: string, name?: string, type?: string, splitMode?: string, address?: string) {
    const data: any = {};
    if (name !== undefined) data.name = name;
    if (type !== undefined) data.type = type;
    if (splitMode !== undefined) data.splitMode = splitMode;
    if (address !== undefined) data.address = address;
    return this.prisma.studio.update({ where: { id }, data });
  }

  async getEmployees(studioId?: string, studioType?: string, roleFilter?: string) {
    const where: any = { role: { not: 'OWNER' } };
    if (studioId) where.studioId = studioId;
    if (roleFilter) where.role = roleFilter;
    if (studioType) {
      where.studio = { type: studioType };
    }
    const users = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        role: true,
        studioId: true,
        isAuthorized: true,
        createdAt: true,
        displayName: true,
        realName: true,
        idNumber: true,
        phone: true,
        address: true,
        leaseContractUrl: true,
        studio: { select: { id: true, name: true, type: true } },
        companion: { select: { id: true, status: true, monthlyRevenue: true, deposit: true, balance: true, frozen: true, games: true, billingCode: true, realName: true, idNumber: true, phone: true, idCardFront: true, idCardBack: true } },
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

  async resetPassword(userId: string, newPassword: string, adminStudioId?: string, adminRole?: string) {
    // ADMIN can only reset passwords for employees in their own studio
    if (adminRole === 'ADMIN' && adminStudioId) {
      const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { studioId: true } });
      if (!target || target.studioId !== adminStudioId) {
        throw new Error('无权操作其他工作室的员工');
      }
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    return this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  }

  async delete(id: string) {
    return this.prisma.$transaction(async (tx) => {
      // Delete all related records in dependency order
      const companionIds = (await tx.companion.findMany({ where: { studioId: id }, select: { id: true } })).map((c: { id: string }) => c.id);
      await tx.processKillLog.deleteMany({ where: { companionId: { in: companionIds } } });
      await tx.companionProcessReport.deleteMany({ where: { companionId: { in: companionIds } } });
      await tx.companionStatusBlacklist.deleteMany({ where: { companionId: { in: companionIds } } });
      await tx.companionBlacklistOverride.deleteMany({ where: { companionId: { in: companionIds } } });
      await tx.companionTimeLog.deleteMany({ where: { companionId: { in: companionIds } } });
      await tx.companionAttendance.deleteMany({ where: { companionId: { in: companionIds } } });
      await tx.pCOperationLog.deleteMany({ where: { pc: { companionId: { in: companionIds } } } });
      await tx.companionPC.deleteMany({ where: { companionId: { in: companionIds } } });
      await tx.walletTransaction.deleteMany({ where: { companionId: { in: companionIds } } });
      await tx.expenseReport.deleteMany({ where: { companionId: { in: companionIds } } });

      const orderIds = (await tx.order.findMany({ where: { studioId: id }, select: { id: true } })).map((o: { id: string }) => o.id);
      if (orderIds.length > 0) {
        await tx.transaction.deleteMany({ where: { orderId: { in: orderIds } } });
        await tx.order.deleteMany({ where: { studioId: id } });
      }
      await tx.customerFollowUp.deleteMany({ where: { customer: { studioId: id } } });
      await tx.customerProfile.deleteMany({ where: { customer: { studioId: id } } });
      await tx.customer.deleteMany({ where: { studioId: id } });
      await tx.tenantAuthorization.deleteMany({ where: { studioId: id } });
      await tx.expense.deleteMany({ where: { studioId: id } });
      await tx.workWechat.deleteMany({ where: { studioId: id } });
      await tx.processBlacklist.deleteMany({ where: { studioId: id } });
      await tx.processWhitelist.deleteMany({ where: { studioId: id } });
      await tx.chatMessageLegacy.deleteMany({ where: { studioId: id } });
      await tx.studioDailyStats.deleteMany({ where: { studioId: id } });
      await tx.revenueDaily.deleteMany({ where: { studioId: id } });
      await tx.companion.deleteMany({ where: { studioId: id } });
      await tx.user.deleteMany({ where: { studioId: id } });
      return tx.studio.delete({ where: { id } });
    });
  }

  async deleteEmployee(userId: string, adminStudioId?: string, role?: string) {
    // ADMIN/CS can only delete employees in their own studio
    if ((role === 'ADMIN' || role === 'CS') && adminStudioId) {
      const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { studioId: true, role: true } });
      if (!target || target.studioId !== adminStudioId) {
        throw new ForbiddenException('无权删除其他工作室的员工');
      }
      // Prevent deleting users with higher role (e.g. ADMIN deleting OWNER)
      if (role === 'ADMIN' && target.role === 'ADMIN') {
        throw new ForbiddenException('店长不能删除其他店长');
      }
    }
    // Delete companion first if exists (cascade), then user
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;
    await this.prisma.user.delete({ where: { id: userId } });
  }
}
