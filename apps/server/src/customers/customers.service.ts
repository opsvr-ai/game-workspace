// craftsman-ignore: TS001
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { UserRole } from '@chunlv/shared';

export interface CreateCustomerDto {
  wechatId: string;
  studioId: string;
  companionId?: string;
  customerCode?: string;
  platform?: string;
  platformAccount?: string;
  consultDate?: string;
  wechatAddDate?: string;
  notes?: string;
}

export interface UpdateCustomerDto {
  wechatId?: string;
  companionId?: string | null;
  platform?: string;
  platformAccount?: string;
  consultDate?: string;
  wechatAddDate?: string;
  isAccountBanned?: boolean;
  isDeletedByCustomer?: boolean;
  notes?: string;
  scheduledAt?: string | null;
}

interface AuthenticatedUser {
  id: string;
  username: string;
  role: UserRole;
  studioId: string | null;
  companionId?: string;
}

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  async findAll(user: AuthenticatedUser, sortBy?: string) {
    const where: any = {};

    if (user.role === 'COMPANION') {
      where.companionId = user.companionId;
      where.isDeletedByCustomer = false;
    } else if (user.role === 'ADMIN' || user.role === 'CS') {
      where.studioId = user.studioId;
    }

    // Sort: totalSpent=消费金额降序, createdAt=创建时间降序, updatedAt=最近更新降序(默认)
    let orderBy: any = { updatedAt: 'desc' };
    if (sortBy === 'totalSpent') {
      orderBy = { totalSpent: 'desc' };
    } else if (sortBy === 'createdAt') {
      orderBy = { createdAt: 'desc' };
    }

    return this.prisma.customer.findMany({
      where,
      include: {
        companion: {
          include: {
            user: { select: { username: true } },
          },
        },
        followUps: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
          orders: {
            orderBy: { createdAt: 'desc' },
            take: 5,
            select: {
              id: true,
              status: true,
              gameName: true,
              type: true,
              amount: true,
              duration: true,
              customFields: true,
              sessions: {
                orderBy: { seq: 'desc' },
                take: 1,
                select: { id: true, startedAt: true, status: true },
              },
            },
          },
      },
      orderBy,
    });
  }

  async findOne(id: string, user?: AuthenticatedUser) {
    const where: any = { id };
    // Studio isolation: non-OWNER users can only see customers in their studio
    if (user && user.role !== 'OWNER') {
      if (user.role === 'COMPANION') {
        where.companionId = user.companionId;
        where.isDeletedByCustomer = false;
      } else {
        where.studioId = user.studioId;
      }
    }
    const customer = await this.prisma.customer.findUnique({
      where,
      include: {
        companion: {
          include: {
            user: { select: { username: true } },
          },
        },
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });

    if (!customer) {
      throw new NotFoundException('客户不存在');
    }

    return customer;
  }

  async create(data: CreateCustomerDto) {
    let customerCode = data.customerCode;
    if (!customerCode) {
      const cfg = await this.prisma.systemConfig.upsert({
        where: { key: 'counter.global_code' },
        create: { key: 'counter.global_code', value: '0' },
        update: {},
      });
      const current = parseInt(cfg.value as string, 10) || 0;
      const next = current + 1;
      await this.prisma.systemConfig.update({
        where: { key: 'counter.global_code' },
        data: { value: String(next) },
      });
      customerCode = String(next);
    }

    return this.prisma.customer.create({
      data: {
        studioId: data.studioId,
        customerCode,
        wechatId: data.wechatId,
        companionId: data.companionId ?? null,
        platform: data.platform ?? null,
        platformAccount: data.platformAccount ?? null,
        consultDate: data.consultDate ? new Date(data.consultDate) : null,
        wechatAddDate: data.wechatAddDate ? new Date(data.wechatAddDate) : null,
        notes: data.notes ?? null,
      },
      include: {
        companion: {
          include: {
            user: { select: { username: true } },
          },
        },
      },
    });
  }

  async update(id: string, data: UpdateCustomerDto, user?: AuthenticatedUser) {
    const customer = await this.findOne(id, user); // Reuse scoped findOne
    if (!customer) {
      throw new NotFoundException('客户不存在');
    }
    // Prevent cross-studio companionId tampering
    if (user && data.companionId !== undefined) {
      if (user.role === 'COMPANION' && data.companionId !== user.companionId) {
        throw new ForbiddenException('无权修改客户归属');
      }
    }

    const updateData: any = {};

    if (data.wechatId !== undefined) updateData.wechatId = data.wechatId;
    if (data.companionId !== undefined) updateData.companionId = data.companionId;
    if (data.platform !== undefined) updateData.platform = data.platform;
    if (data.platformAccount !== undefined) updateData.platformAccount = data.platformAccount;
    if (data.consultDate !== undefined) updateData.consultDate = data.consultDate ? new Date(data.consultDate) : null;
    if (data.wechatAddDate !== undefined)
      updateData.wechatAddDate = data.wechatAddDate ? new Date(data.wechatAddDate) : null;
    if (data.isAccountBanned !== undefined) updateData.isAccountBanned = data.isAccountBanned;
    if (data.isDeletedByCustomer !== undefined) updateData.isDeletedByCustomer = data.isDeletedByCustomer;
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.scheduledAt !== undefined) updateData.scheduledAt = data.scheduledAt ? new Date(data.scheduledAt) : null;

    return this.prisma.customer.update({
      where: { id },
      data: updateData,
      include: {
        companion: {
          include: {
            user: { select: { username: true } },
          },
        },
      },
    });
  }

  async delete(id: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) {
      throw new NotFoundException('客户不存在');
    }

    return this.prisma.customer.delete({ where: { id } });
  }

  async reassign(id: string, companionId: string | null, user?: AuthenticatedUser) {
    await this.findOne(id, user); // Validate access

    if (companionId) {
      const companion = await this.prisma.companion.findUnique({
        where: { id: companionId },
      });
      if (!companion) {
        throw new NotFoundException('陪玩不存在');
      }
    }

    return this.prisma.customer.update({
      where: { id },
      data: { companionId },
      include: {
        companion: {
          include: {
            user: { select: { username: true } },
          },
        },
      },
    });
  }

  async findOrders(id: string, user?: AuthenticatedUser) {
    await this.findOne(id, user); // Validate access

    return this.prisma.order.findMany({
      where: { customerId: id },
      include: {
        companion: {
          include: {
            user: { select: { username: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async detectCustomerType(customerId: string, user?: AuthenticatedUser): Promise<{ type: string; orderCount: number }> {
    await this.findOne(customerId, user); // Validate access
    const count = await this.prisma.order.count({
      where: { customerId, status: 'DONE' },
    });
    if (count === 0) return { type: 'FIRST', orderCount: 0 };
    return { type: 'REPURCHASE', orderCount: count };
  }

  async updateCustomerStatus(customerId: string): Promise<string> {
    const lastOrder = await this.prisma.order.findFirst({
      where: { customerId, status: 'DONE' },
      orderBy: { createdAt: 'desc' },
    });

    let status: string;
    if (!lastOrder) {
      status = 'PENDING_DEVELOPMENT';
    } else {
      const daysSince = Math.floor((Date.now() - lastOrder.createdAt.getTime()) / 86400000);
      if (daysSince <= 7) status = 'ACTIVE';
      else if (daysSince <= 30) status = 'FOLLOW_UP';
      else status = 'LOST';
    }

    await this.prisma.customer.update({
      where: { id: customerId },
      data: { status },
    });
    return status;
  }

  async getOrCreateProfile(customerId: string, user?: AuthenticatedUser) {
    await this.findOne(customerId, user); // Validate access
    let profile = await this.prisma.customerProfile.findUnique({
      where: { customerId },
    });
    if (!profile) {
      profile = await this.prisma.customerProfile.create({
        data: { customerId },
      });
    }
    return profile;
  }

  async updateProfile(customerId: string, data: any, user?: AuthenticatedUser) {
    await this.findOne(customerId, user); // Validate access
    return this.prisma.customerProfile.upsert({
      where: { customerId },
      create: { customerId, ...data },
      update: data,
    });
  }

  async getFollowUps(customerId: string, user?: AuthenticatedUser) {
    await this.findOne(customerId, user); // Validate access
    return this.prisma.customerFollowUp.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addFollowUp(dto: {
    customerId: string;
    playerId?: string;
    adminId?: string;
    content: string;
    nextAction?: string;
  }, user?: AuthenticatedUser) {
    await this.findOne(dto.customerId, user); // Validate access
    const followUp = await this.prisma.customerFollowUp.create({ data: dto });
    // Auto-update customer status after follow-up
    await this.updateCustomerStatus(dto.customerId);
    return followUp;
  }

  // ── Traffic Pool ──

  async getTrafficPool(studioId: string, platform?: string) {
    const where: any = { studioId };
    if (platform) where.platform = platform;
    return this.prisma.customer.findMany({
      where,
      select: { id: true, customerCode: true, platform: true, platformAccount: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getChannelStats(studioId: string) {
    const customers = await this.prisma.customer.findMany({ where: { studioId }, select: { platform: true } });
    const stats: Record<string, number> = {};
    for (const c of customers) {
      stats[c.platform || '未知'] = (stats[c.platform || '未知'] || 0) + 1;
    }
    return stats;
  }
}
