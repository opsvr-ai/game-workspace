// craftsman-ignore: TS001,TS003
import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assertCanManage } from '../common/role-hierarchy';
import * as bcrypt from 'bcryptjs';
import { currentBusinessDayRange } from '../common/business-day';

@Injectable()
export class StudiosService {
  constructor(private prisma: PrismaService) {}

  async listPublic() {
    return this.prisma.studio.findMany({
      select: { id: true, name: true, type: true },
      orderBy: { name: 'asc' },
    });
  }

  // 直接新增一个线上俱乐部（RENTAL 工作室）并自动桥接到当前工作室。
  async createOnlineClub(ownerStudioId: string, name: string, displayName?: string) {
    if (!name || !name.trim()) throw new ForbiddenException('请填写线上俱乐部名称');
    const onlineClub = await this.prisma.studio.create({
      data: { name: name.trim(), type: 'RENTAL', displayName: displayName?.trim() || null, splitMode: 'FIXED' },
    });
    const [a, b] = [ownerStudioId, onlineClub.id].sort();
    const allFunctions = ['ORDERS', 'POOL', 'CUSTOMERS', 'BILLING', 'KPI'];
    await this.prisma.studioBridge.create({
      data: {
        studioAId: a,
        studioBId: b,
        proposedBy: ownerStudioId,
        status: 'ACTIVE',
        acceptedAt: new Date(),
        permissions: {
          create: allFunctions.map((f) => ({ function: f, acceptedA: true, acceptedB: true })),
        },
      },
    });
    return onlineClub;
  }

  async createInviteToken(token: string, ownerUserId: string) {
    await this.prisma.systemConfig.create({
      data: {
        key: `invite.${token}`,
        value: JSON.stringify({ ownerUserId, createdAt: new Date().toISOString(), used: false }),
      },
    });
  }

  // 邀请注册：合作伙伴/租客自行填写工作室名+店长账号密码，自动创建并桥接到主工作室
  async registerViaInvite(
    token: string,
    studioName: string,
    managerUsername: string,
    managerPassword: string,
    managerDisplayName?: string,
    address?: string,
  ) {
    const inviteCfg = await this.prisma.systemConfig.findUnique({ where: { key: `invite.${token}` } });
    if (!inviteCfg) throw new ForbiddenException('邀请链接无效');
    const invite = (inviteCfg.value as any) || {};
    if (invite.used) throw new ForbiddenException('邀请链接已被使用');

    const passwordHash = await bcrypt.hash(managerPassword, 10);
    const result = await this.prisma.$transaction(async (tx) => {
      const studio = await tx.studio.create({
        data: { name: studioName.trim(), type: 'DIRECT', splitMode: 'TIERED', address: address?.trim() || null },
      });
      const manager = await tx.user.create({
        data: {
          username: managerUsername.trim(),
          passwordHash,
          role: 'ADMIN',
          studioId: studio.id,
          isAuthorized: true,
          displayName: managerDisplayName?.trim() || null,
        },
      });
      return { studio, manager };
    });

    await this.prisma.systemConfig.update({
      where: { key: `invite.${token}` },
      data: { value: JSON.stringify({ ...invite, used: true, usedAt: new Date().toISOString() }) },
    });

    return { studioId: result.studio.id, username: result.manager.username };
  }

  async listOnlineClubs(studioId: string) {
    const bridges = await this.prisma.studioBridge.findMany({
      where: { status: 'ACTIVE', OR: [{ studioAId: studioId }, { studioBId: studioId }] },
      include: {
        studioA: { select: { id: true, name: true, displayName: true, type: true } },
        studioB: { select: { id: true, name: true, displayName: true, type: true } },
      },
    });
    const clubs: Array<{ id: string; name: string; displayName?: string | null; type: string }> = [];
    for (const b of bridges) {
      const other = b.studioAId === studioId ? b.studioB : b.studioA;
      if (other && other.type === 'RENTAL') {
        clubs.push({ id: other.id, name: other.name, displayName: other.displayName, type: other.type });
      }
    }
    return clubs;
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

  async update(id: string, name?: string, type?: string, splitMode?: string, address?: string, displayName?: string, logoUrl?: string) {
    const data: any = {};
    if (name !== undefined) data.name = name;
    if (type !== undefined) data.type = type;
    if (splitMode !== undefined) data.splitMode = splitMode;
    if (address !== undefined) data.address = address;
    if (displayName !== undefined) data.displayName = displayName;
    if (logoUrl !== undefined) data.logoUrl = logoUrl;
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
        idCardFront: true,
        idCardBack: true,
        address: true,
        leaseContractUrl: true,
        studio: { select: { id: true, name: true, type: true } },
        companion: { select: { id: true, status: true, monthlyRevenue: true, deposit: true, balance: true, frozen: true, games: true, billingCode: true, realName: true, idNumber: true, phone: true, idCardFront: true, idCardBack: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Add today's order counts per companion（营业日 12:00 至次日 12:00）
    const { start: todayStart, end: todayEnd } = currentBusinessDayRange();
    const companionIds = users.filter((u: any) => u.companion?.id).map((u: any) => u.companion!.id);
    if (companionIds.length > 0) {
      const todayOrders = await this.prisma.order.groupBy({
        by: ['companionId'],
        where: { companionId: { in: companionIds }, createdAt: { gte: todayStart, lt: todayEnd }, status: { not: 'CANCELLED' } },
        _count: { id: true },
      });
      const counts = new Map(todayOrders.map((o: any) => [o.companionId, o._count.id]));
      // Add budan counts
      const budanData = await this.prisma.order.findMany({
        where: { companionId: { in: companionIds }, createdAt: { gte: todayStart, lt: todayEnd } },
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
    if (adminRole && adminRole !== 'OWNER') {
      const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { studioId: true, role: true } });
      if (!target) throw new ForbiddenException('用户不存在');
      assertCanManage(adminRole, target.role, adminStudioId, target.studioId);
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
      await tx.companionStatusBlacklist.deleteMany({ where: { studioId: id } });
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
      await tx.companion.deleteMany({ where: { studioId: id } });
      await tx.user.deleteMany({ where: { studioId: id } });
      return tx.studio.delete({ where: { id } });
    });
  }

  async deleteEmployee(userId: string, adminStudioId?: string, role?: string) {
    if (role && role !== 'OWNER') {
      const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { studioId: true, role: true } });
      if (!target) return;
      assertCanManage(role, target.role, adminStudioId, target.studioId);
    }
    // Delete companion first if exists (cascade), then user
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;
    await this.prisma.user.delete({ where: { id: userId } });
  }

  // ── Payment Accounts ──

  async getPaymentAccounts(studioId?: string) {
    return this.prisma.studioPaymentAccount.findMany({
      where: studioId ? { studioId } : undefined,
      orderBy: { createdAt: 'asc' },
    });
  }

  async createPaymentAccount(dto: { studioId: string; type: string; accountName: string; accountNumber: string }) {
    return this.prisma.studioPaymentAccount.create({ data: dto });
  }
}
