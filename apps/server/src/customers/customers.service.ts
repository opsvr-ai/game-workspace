import { Injectable, NotFoundException } from '@nestjs/common';
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

  async findAll(user: AuthenticatedUser) {
    const where: any = {};

    if (user.role === 'COMPANION') {
      where.companionId = user.companionId;
    } else if (user.role === 'ADMIN' || user.role === 'CS') {
      where.studioId = user.studioId;
    }

    return this.prisma.customer.findMany({
      where,
      include: {
        companion: {
          include: {
            user: { select: { username: true } },
          },
        },
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            gameName: true,
            type: true,
            amount: true,
            duration: true,
            customFields: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
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
    const customerCode =
      data.customerCode || `C${Date.now().toString(36).toUpperCase()}`;

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

  async update(id: string, data: UpdateCustomerDto) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) {
      throw new NotFoundException('客户不存在');
    }

    const updateData: any = {};

    if (data.wechatId !== undefined) updateData.wechatId = data.wechatId;
    if (data.companionId !== undefined) updateData.companionId = data.companionId;
    if (data.platform !== undefined) updateData.platform = data.platform;
    if (data.platformAccount !== undefined) updateData.platformAccount = data.platformAccount;
    if (data.consultDate !== undefined)
      updateData.consultDate = data.consultDate ? new Date(data.consultDate) : null;
    if (data.wechatAddDate !== undefined)
      updateData.wechatAddDate = data.wechatAddDate ? new Date(data.wechatAddDate) : null;
    if (data.isAccountBanned !== undefined) updateData.isAccountBanned = data.isAccountBanned;
    if (data.isDeletedByCustomer !== undefined)
      updateData.isDeletedByCustomer = data.isDeletedByCustomer;
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

  async reassign(id: string, companionId: string | null) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) {
      throw new NotFoundException('客户不存在');
    }

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

  async findOrders(id: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) {
      throw new NotFoundException('客户不存在');
    }

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

  async detectCustomerType(customerId: string): Promise<{ type: string; orderCount: number }> {
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
      const daysSince = Math.floor(
        (Date.now() - lastOrder.createdAt.getTime()) / 86400000,
      );
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

  async getOrCreateProfile(customerId: string) {
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

  async updateProfile(customerId: string, data: any) {
    return this.prisma.customerProfile.upsert({
      where: { customerId },
      create: { customerId, ...data },
      update: data,
    });
  }

  async getFollowUps(customerId: string) {
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
  }) {
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
