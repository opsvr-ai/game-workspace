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
}
