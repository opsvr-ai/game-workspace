// craftsman-ignore: TS001
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { UserRole } from '@chunlv/shared';

export interface CreateCustomerDto {
  wechatId: string;
  studioId: string;
  companionId?: string;
  isLegacy?: boolean;
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
  constructor(
    private prisma: PrismaService,
  ) {}

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
              csUserId: true,
              csUser: { select: { username: true, displayName: true, avatar: true } },
              status: true,
              gameName: true,
              type: true,
              amount: true,
              duration: true,
              customFields: true,
              sessions: {
                orderBy: { seq: 'desc' },
                take: 1,
                select: { id: true, startedAt: true, status: true, pausedAt: true, totalPausedSec: true, coCompanionId: true, coAmount: true, claimedMode: true, claimedPrice: true, duration: true },
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
    // 桥接共享的客户只读，不能修改对方工作室的客户数据
    if (user && user.role !== 'OWNER' && user.studioId && customer.studioId !== user.studioId) {
      throw new ForbiddenException('共享客户只读，不能修改对方工作室的数据');
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

  async listDeposits(customerId: string, user?: AuthenticatedUser) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { studioId: true, companionId: true },
    });
    if (!customer) throw new NotFoundException('客户不存在');
    if (user?.role === 'COMPANION' && customer.companionId !== user.companionId) {
      throw new ForbiddenException('只能查看自己名下客户的存单');
    }
    if ((user?.role === 'CS' || user?.role === 'ADMIN') && customer.studioId !== user.studioId) {
      throw new ForbiddenException('无权查看其他工作室的客户存单');
    }
    return this.prisma.customerDeposit.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      include: { companion: { include: { user: { select: { username: true, displayName: true } } } } },
    });
  }

  async createDeposit(
    customerId: string,
    body: { amount: number; screenshotUrl?: string; note?: string },
    user?: AuthenticatedUser,
  ) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { studioId: true, companionId: true },
    });
    if (!customer) throw new NotFoundException('客户不存在');
    if (user?.role === 'COMPANION' && customer.companionId !== user.companionId) {
      throw new ForbiddenException('只能给自己名下客户存单');
    }
    if ((user?.role === 'CS' || user?.role === 'ADMIN') && customer.studioId !== user.studioId) {
      throw new ForbiddenException('无权操作其他工作室的客户');
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new ForbiddenException('请填写正确的存单金额');

    const deposit = await this.prisma.customerDeposit.create({
      data: {
        customerId,
        companionId: user?.companionId ?? null,
        amount,
        screenshotUrl: body.screenshotUrl || null,
        note: body.note || null,
      },
    });
    await this.prisma.customer.update({
      where: { id: customerId },
      data: { depositBalance: { increment: amount } },
    });
    return deposit;
  }

  async reassign(id: string, companionId: string | null, user?: AuthenticatedUser) {
    const customer = await this.findOne(id, user); // Validate access
    if (user && user.role !== 'OWNER' && user.studioId && customer.studioId !== user.studioId) {
      throw new ForbiddenException('共享客户只读，不能重新分配');
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
        coCompanion: {
          include: {
            user: { select: { username: true, displayName: true } },
          },
        },
        sessions: {
          orderBy: { seq: 'asc' },
          select: {
            id: true,
            companionId: true,
            coCompanionId: true,
            startedAt: true,
            endedAt: true,
            status: true,
            pausedAt: true,
            totalPausedSec: true,
            duration: true,
            claimedMode: true,
            claimedPrice: true,
            coAmount: true,
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
    const customer = await this.findOne(customerId, user); // Validate access
    if (user && user.role !== 'OWNER' && user.studioId && customer.studioId !== user.studioId) {
      throw new ForbiddenException('共享客户只读，不能修改资料');
    }
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
    /** 下次跟进时间（客服在跟进台账里选的，ISO 字符串） */
    nextFollowUpAt?: string;
    /** 这次是用哪个客服工作微信加的客户 */
    workWechatName?: string;
  }, user?: AuthenticatedUser) {
    const customer = await this.findOne(dto.customerId, user); // Validate access
    if (user && user.role !== 'OWNER' && user.studioId && customer.studioId !== user.studioId) {
      throw new ForbiddenException('共享客户只读，不能添加跟进');
    }
    // 显式列出字段（不再直接把 dto 丢给 prisma）：新加的两个字段要转成日期 / 空值
    const nextFollowUpAt = dto.nextFollowUpAt ? new Date(dto.nextFollowUpAt) : null;
    const followUp = await this.prisma.customerFollowUp.create({
      data: {
        customerId: dto.customerId,
        playerId: dto.playerId,
        adminId: dto.adminId,
        content: dto.content,
        nextAction: dto.nextAction,
        nextFollowUpAt:
          nextFollowUpAt && !Number.isNaN(nextFollowUpAt.getTime()) ? nextFollowUpAt : null,
        workWechatName: dto.workWechatName || null,
      },
    });
    // Auto-update customer status after follow-up
    await this.updateCustomerStatus(dto.customerId);
    return followUp;
  }

  // ── 重复客户档案（老板 2026-09-29：「线上那几条重复的客户档案要不要一起清一轮」）──
  //
  // 线上出现过同一个微信号建了 2~3 条档案（根因是发单时没带原客户ID，服务端就新插一条，
  // 已于 2026-09-29 修掉，见 CreateOrderModal）。这里做两件事：
  //   ① 把「同一个工作室 + 同一个微信号」的重复组查出来（只读，给界面看）；
  //   ② 把一条并到另一条 —— 订单 / 跟进 / 存单 / 接触记录 / 轨迹 / 报账单 / 客户资料全部挪过去，
  //      标量字段「保留的那条为主、空着的用来源补、金额相加、备注拼接」，最后删掉多余那条。

  /** 重复客户档案分组（同一工作室下、微信号相同且非空的档案） */
  async listDuplicateGroups(studioId?: string | null) {
    const where: any = { wechatId: { not: '' } };
    if (studioId) where.studioId = studioId;
    const rows = await this.prisma.customer.findMany({
      where,
      select: {
        id: true,
        studioId: true,
        customerCode: true,
        wechatId: true,
        platform: true,
        platformAccount: true,
        notes: true,
        totalSpent: true,
        depositBalance: true,
        status: true,
        createdAt: true,
        companionId: true,
        _count: { select: { orders: true, followUps: true, deposits: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = `${row.studioId}|${row.wechatId.trim()}`;
      const list = groups.get(key) || [];
      list.push(row);
      groups.set(key, list);
    }

    return [...groups.values()]
      .filter((list) => list.length > 1)
      .map((list) => {
        // 默认保留哪一条：先看谁身上有活（订单 > 跟进 > 存单），一样多就留最早那条原始档案。
        // 界面上老板/店长可以改成保留别的，改完再合。
        const score = (c: (typeof list)[number]) =>
          c._count.orders * 100 + c._count.followUps * 10 + c._count.deposits;
        const keep = [...list].sort(
          (a, b) =>
            score(b) - score(a) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        )[0];
        return {
          wechatId: list[0].wechatId,
          keepId: keep.id,
          customers: list.map((c) => ({ ...c, isKeep: c.id === keep.id })),
        };
      });
  }

  /** 把 sourceId 这条档案并进 targetId（保留 targetId），并删掉 sourceId */
  async mergeCustomers(sourceId: string, targetId: string, user?: AuthenticatedUser) {
    if (!sourceId || !targetId || sourceId === targetId) {
      throw new ForbiddenException('要合并的两条档案不能是同一条');
    }
    const [source, target] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: sourceId } }),
      this.prisma.customer.findUnique({ where: { id: targetId } }),
    ]);
    if (!source) throw new NotFoundException('要合并的客户档案不存在');
    if (!target) throw new NotFoundException('要保留的客户档案不存在');
    if (source.studioId !== target.studioId) {
      throw new ForbiddenException('两条档案不在同一个工作室，不能合并');
    }
    if (user && user.role !== 'OWNER' && user.studioId && target.studioId !== user.studioId) {
      throw new ForbiddenException('只能合并本工作室的客户档案');
    }

    const moved = await this.prisma.$transaction(async (tx) => {
      const orders = await tx.order.updateMany({
        where: { customerId: sourceId },
        data: { customerId: targetId },
      });
      const followUps = await tx.customerFollowUp.updateMany({
        where: { customerId: sourceId },
        data: { customerId: targetId },
      });
      const deposits = await tx.customerDeposit.updateMany({
        where: { customerId: sourceId },
        data: { customerId: targetId },
      });
      const contacts = await tx.customerContact.updateMany({
        where: { customerId: sourceId },
        data: { customerId: targetId },
      });
      const tracks = await tx.customerTrack.updateMany({
        where: { customerId: sourceId },
        data: { customerId: targetId },
      });
      const deleteRequests = await tx.customerDeleteRequest.updateMany({
        where: { customerId: sourceId },
        data: { customerId: targetId },
      });
      const screenshots = await tx.battleScreenshot.updateMany({
        where: { customerId: sourceId },
        data: { customerId: targetId },
      });

      // 客户资料是一对一：保留的那条没有就搬过去，两边都有就留保留那条的（来源那条删掉，不残留孤儿行）
      let profileMoved = false;
      const sourceProfile = await tx.customerProfile.findUnique({ where: { customerId: sourceId } });
      if (sourceProfile) {
        const targetProfile = await tx.customerProfile.findUnique({
          where: { customerId: targetId },
        });
        if (targetProfile) {
          await tx.customerProfile.delete({ where: { customerId: sourceId } });
        } else {
          await tx.customerProfile.update({
            where: { customerId: sourceId },
            data: { customerId: targetId },
          });
          profileMoved = true;
        }
      }

      const STATUS_RANK: Record<string, number> = {
        ACTIVE: 3,
        FOLLOW_UP: 2,
        PENDING_DEVELOPMENT: 1,
        LOST: 0,
      };
      const mergedNotes = [
        target.notes,
        source.notes ? `[合并 #${source.customerCode}] ${source.notes}` : '',
      ]
        .map((v) => (v || '').trim())
        .filter(Boolean)
        .join('\n');

      await tx.customer.update({
        where: { id: targetId },
        data: {
          platform: target.platform || source.platform,
          platformAccount: target.platformAccount || source.platformAccount,
          consultDate: target.consultDate || source.consultDate,
          wechatAddDate: target.wechatAddDate || source.wechatAddDate,
          notes: mergedNotes || null,
          totalSpent: target.totalSpent + source.totalSpent,
          depositBalance: target.depositBalance + source.depositBalance,
          status:
            (STATUS_RANK[source.status] || 0) > (STATUS_RANK[target.status] || 0)
              ? source.status
              : target.status,
          companionId: target.companionId || source.companionId,
          scheduledAt: target.scheduledAt || source.scheduledAt,
          isAccountBanned: target.isAccountBanned || source.isAccountBanned,
          isDeletedByCustomer: target.isDeletedByCustomer && source.isDeletedByCustomer,
        },
      });

      await tx.customer.delete({ where: { id: sourceId } });

      return {
        orders: orders.count,
        followUps: followUps.count,
        deposits: deposits.count,
        contacts: contacts.count,
        tracks: tracks.count,
        screenshots: screenshots.count,
        deleteRequests: deleteRequests.count,
        profileMoved,
      };
    });

    return { sourceCode: source.customerCode, targetCode: target.customerCode, ...moved };
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
