import { Injectable, ForbiddenException, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CompanionWechatService {
  constructor(private prisma: PrismaService) {}

  async listWorkWechats(studioId: string, user?: any) {
    const where: any = { studioId };
    // 客服只能看到并操作绑定给自己的客服微信，店长/老板看全部。
    if (user?.role === 'CS') {
      where.type = 'STUDIO';
      where.csUserId = user.id;
    }
    // 陪玩选择微信：俱乐部里的陪玩只看自己的微信，工作室里的陪玩只看本工作室的陪玩微信
    else if (user?.role === 'COMPANION' && user.companionId) {
      const companion = await this.prisma.companion.findUnique({
        where: { id: user.companionId },
        select: { studio: { select: { type: true } } },
      });
      if (companion?.studio?.type === 'RENTAL') {
        where.companionId = user.companionId;
      } else {
        where.type = 'COMPANION';
      }
    }
    return this.prisma.workWechat.findMany({
      where,
      include: { companion: { include: { user: { select: { username: true, avatar: true, displayName: true } } } } },
    });
  }

  async addWorkWechat(studioId: string, wechatId: string, type?: string) {
    const id = (wechatId || '').trim();
    if (!id) throw new BadRequestException('请输入微信号');
    const existing = await this.prisma.workWechat.findUnique({ where: { wechatId: id } });
    if (existing) throw new ConflictException('该微信号已存在，请勿重复添加');
    return this.prisma.workWechat.create({ data: { studioId, wechatId: id, type: type || 'COMPANION' } });
  }

  async updateWorkWechatNickname(id: string, nickname: string, user?: any) {
    const wechat = await this.prisma.workWechat.findUnique({ where: { id } });
    if (!wechat) throw new NotFoundException('微信不存在');
    if (user?.role === 'CS' && wechat.csUserId !== user.id) {
      throw new ForbiddenException('客服只能修改绑定给自己的微信');
    }
    return this.prisma.workWechat.update({
      where: { id },
      data: { nickname: nickname?.trim() || null },
    });
  }

  async bindWechat(id: string, companionId: string) {
    // 隐私：微信和陪玩必须属于同一工作室，禁止跨工作室/俱乐部绑定
    const wechat = await this.prisma.workWechat.findUnique({ where: { id } });
    if (!wechat) throw new NotFoundException('微信不存在');
    const companion = await this.prisma.companion.findUnique({
      where: { id: companionId },
      select: { studioId: true },
    });
    if (!companion) throw new NotFoundException('陪玩不存在');
    if (wechat.studioId !== companion.studioId) {
      throw new ForbiddenException('微信与陪玩不属于同一工作室，禁止跨工作室绑定');
    }
    // Unbind any existing wechat already bound to this companion
    await this.prisma.workWechat.updateMany({
      where: { companionId },
      data: { companionId: null, status: 'AVAILABLE' },
    });
    return this.prisma.workWechat.update({ where: { id }, data: { companionId, status: 'BOUND' } });
  }

  async unbindWechat(id: string) {
    return this.prisma.workWechat.update({ where: { id }, data: { companionId: null, status: 'AVAILABLE' } });
  }

  async bindCsUser(id: string, csUserId: string) {
    // 隐私：微信和客服必须属于同一工作室，禁止跨工作室/俱乐部绑定
    const wechat = await this.prisma.workWechat.findUnique({ where: { id } });
    if (!wechat) throw new NotFoundException('微信不存在');
    const csUser = await this.prisma.user.findUnique({
      where: { id: csUserId },
      select: { studioId: true },
    });
    if (!csUser) throw new NotFoundException('客服不存在');
    if (wechat.studioId !== csUser.studioId) {
      throw new ForbiddenException('微信与客服不属于同一工作室，禁止跨工作室绑定');
    }
    // 一个工作微信只能绑定给一个客服，但一个客服可以绑定多个工作微信。
    // 这里不再解绑该客服名下其他微信，避免绑定新微信时把旧的自动挤掉。
    return this.prisma.workWechat.update({
      where: { id },
      data: { csUserId, companionId: null, status: 'BOUND' },
    });
  }

  async unbindCsUser(id: string) {
    return this.prisma.workWechat.update({ where: { id }, data: { csUserId: null, status: 'AVAILABLE' } });
  }

  async deleteWorkWechat(id: string, user?: any) {
    const wechat = await this.prisma.workWechat.findUnique({ where: { id } });
    if (!wechat) throw new NotFoundException('微信不存在');
    if (user?.role === 'CS' && wechat.csUserId !== user.id) {
      throw new ForbiddenException('客服只能删除绑定给自己的微信');
    }
    return this.prisma.workWechat.delete({ where: { id } });
  }

  // ── 陪玩自己提交工作微信 + 管理端审核（老板 2026-10-02） ──
  //
  // 老板原话：「让陪玩自己填写自己的微信号，但是需要管理端审核，
  //   以后想换可以换，但是管理端审核过了以后才显示新的。」
  //
  // 口径：陪玩提交只是「申请」（WorkWechatRequest）；真正生效、界面上显示、
  // 抢单判重用的仍是 WorkWechat 上绑定的那一条 —— 只有管理端审核通过才会去改。
  // 所以「换了号但还没过审」不会影响当前生效的号。

  private normalizeWechatId(raw?: string | null) {
    const id = String(raw || '').trim();
    if (!id) throw new BadRequestException('请输入微信号');
    if (/\s/.test(id)) throw new BadRequestException('微信号里不能有空格');
    if (id.length < 2 || id.length > 32) throw new BadRequestException('微信号长度不对（2~32 个字符）');
    return id;
  }

  /** 陪玩看自己的：当前生效的微信号 + 正在审核的申请 + 最近一条被驳回 */
  async getMyWorkWechat(companionId: string) {
    if (!companionId) throw new ForbiddenException('只有陪玩可以查看自己的工作微信');
    const [bound, pending, lastRejected] = await Promise.all([
      this.prisma.workWechat
        .findUnique({ where: { companionId }, select: { wechatId: true, nickname: true } })
        .catch(() => null),
      this.prisma.workWechatRequest
        .findFirst({ where: { companionId, status: 'PENDING' }, orderBy: { createdAt: 'desc' } })
        .catch(() => null),
      this.prisma.workWechatRequest
        .findFirst({ where: { companionId, status: 'REJECTED' }, orderBy: { reviewedAt: 'desc' } })
        .catch(() => null),
    ]);
    return {
      effective: String(bound?.wechatId || '') || null,
      effectiveNickname: bound?.nickname || null,
      pending: pending
        ? { id: pending.id, wechatId: pending.wechatId, createdAt: pending.createdAt }
        : null,
      lastRejected: lastRejected
        ? {
            id: lastRejected.id,
            wechatId: lastRejected.wechatId,
            reason: lastRejected.rejectReason || null,
            reviewedAt: lastRejected.reviewedAt,
          }
        : null,
    };
  }

  /** 陪玩提交 / 修改自己的微信号：进待审核，不直接生效 */
  async submitMyWorkWechat(companionId: string, rawWechatId?: string | null) {
    if (!companionId) throw new ForbiddenException('只有陪玩可以提交工作微信');
    const wechatId = this.normalizeWechatId(rawWechatId);
    const companion = await this.prisma.companion.findUnique({
      where: { id: companionId },
      select: { studioId: true },
    });
    if (!companion) throw new NotFoundException('陪玩不存在');

    // 就是现在生效的那个号 → 不用再提交
    const bound = await this.prisma.workWechat.findUnique({
      where: { companionId },
      select: { wechatId: true },
    });
    if (bound && String(bound.wechatId || '').trim() === wechatId) {
      throw new ConflictException('这个微信号就是你当前绑定的，不用再提交');
    }

    await this.assertWechatUsable(wechatId, companionId);

    // 已有待审核的申请就直接改成新的（不重复堆）
    const existingPending = await this.prisma.workWechatRequest.findFirst({
      where: { companionId, status: 'PENDING' },
    });
    if (existingPending) {
      return this.prisma.workWechatRequest.update({
        where: { id: existingPending.id },
        data: { wechatId, rejectReason: null, createdAt: new Date() },
      });
    }
    return this.prisma.workWechatRequest.create({
      data: { studioId: companion.studioId, companionId, wechatId, status: 'PENDING' },
    });
  }

  /** 这个微信号能不能给这个陪玩用（别人的/客服的都不行） */
  private async assertWechatUsable(wechatId: string, companionId: string) {
    const occupied = await this.prisma.workWechat.findUnique({
      where: { wechatId },
      select: { companionId: true, csUserId: true, type: true },
    });
    if (!occupied) return;
    if (occupied.companionId && occupied.companionId !== companionId) {
      throw new ConflictException('这个微信号已经绑给别的陪玩了，请联系管理端');
    }
    if (occupied.csUserId) {
      throw new ConflictException('这个微信号是客服在用，不能作为陪玩工作微信');
    }
    if (!occupied.companionId && occupied.type === 'STUDIO') {
      throw new ConflictException('这个微信号是客服工作微信，不能作为陪玩工作微信');
    }
  }

  /**
   * 管理端：列出陪玩提交的微信号申请（默认本店，可按状态筛）。
   *
   * `allStudios`：老板（OWNER）是全站老板、账号上没有 studioId，默认那条 `sid()` 只会退化成
   * 「第一个工作室」，他就只能看到一家的申请 —— 三个店的提交要各自店长去审。所以老板这里
   * 不按工作室过滤，并且每条附上工作室名字，跨店看的时候能分清是哪家。
   */
  async listWorkWechatRequests(
    studioId: string,
    status?: string,
    opts: { allStudios?: boolean } = {},
  ) {
    const where: any = {};
    if (!opts.allStudios && studioId) where.studioId = studioId;
    if (status) where.status = status;
    const rows =
      (await this.prisma.workWechatRequest.findMany({
        where,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        take: 200,
        include: {
          companion: {
            include: { user: { select: { username: true, displayName: true, avatar: true } } },
          },
        },
      })) || [];

    // 附上工作室名字（老板跨店看的时候要能分清是哪家）
    const ids = [...new Set(rows.map((r: any) => r.studioId).filter(Boolean))];
    if (!ids.length) return rows;
    const studios =
      (await this.prisma.studio
        .findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
        .catch(() => [] as Array<{ id: string; name: string }>)) || [];
    const nameOf = new Map(studios.map((s: any) => [s.id, s.name]));
    return rows.map((r: any) => ({ ...r, studioName: nameOf.get(r.studioId) || null }));
  }

  /** 管理端：待审核数量（界面上的红标） */
  async countPendingWorkWechatRequests(studioId: string) {
    const where: any = { status: 'PENDING' };
    if (studioId) where.studioId = studioId;
    return this.prisma.workWechatRequest.count({ where });
  }

  /**
   * 管理端审核通过：把申请里的微信号绑给这个陪玩。
   * 他原来绑的号自动退下来（一个陪玩只有一个工作微信）。
   */
  async approveWorkWechatRequest(id: string, reviewerId?: string) {
    const req = await this.prisma.workWechatRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('申请不存在');
    if (req.status === 'APPROVED') throw new ConflictException('这条申请已经通过过了');
    const companion = await this.prisma.companion.findUnique({
      where: { id: req.companionId },
      select: { studioId: true },
    });
    if (!companion) throw new NotFoundException('陪玩不存在');
    await this.assertWechatUsable(req.wechatId, req.companionId);

    const existing = await this.prisma.workWechat.findUnique({ where: { wechatId: req.wechatId } });
    const reviewedAt = new Date();
    const reviewedById = reviewerId || null;

    await this.prisma.$transaction(async (tx: any) => {
      // 这个陪玩原来绑的号先退下来
      await tx.workWechat.updateMany({
        where: { companionId: req.companionId, wechatId: { not: req.wechatId } },
        data: { companionId: null, status: 'AVAILABLE' },
      });
      if (existing) {
        await tx.workWechat.update({
          where: { id: existing.id },
          data: { type: 'COMPANION', companionId: req.companionId, csUserId: null, status: 'BOUND' },
        });
      } else {
        await tx.workWechat.create({
          data: {
            studioId: companion.studioId,
            wechatId: req.wechatId,
            type: 'COMPANION',
            companionId: req.companionId,
            status: 'BOUND',
          },
        });
      }
      await tx.workWechatRequest.update({
        where: { id },
        data: { status: 'APPROVED', rejectReason: null, reviewedById, reviewedAt },
      });
      // 同一个人其它的待审核申请一并作废（旧的换号申请）
      await tx.workWechatRequest.updateMany({
        where: { companionId: req.companionId, status: 'PENDING', id: { not: id } },
        data: { status: 'REJECTED', rejectReason: '已被新的审核结果取代', reviewedById, reviewedAt },
      });
    });

    return {
      id: req.id,
      companionId: req.companionId,
      wechatId: req.wechatId,
      status: 'APPROVED',
    };
  }

  /** 管理端驳回：当前生效的号不变 */
  async rejectWorkWechatRequest(id: string, reason?: string, reviewerId?: string) {
    const req = await this.prisma.workWechatRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('申请不存在');
    const updated = await this.prisma.workWechatRequest.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectReason: String(reason || '').trim() || null,
        reviewedById: reviewerId || null,
        reviewedAt: new Date(),
      },
    });
    return {
      id: updated.id,
      companionId: updated.companionId,
      wechatId: updated.wechatId,
      status: updated.status,
    };
  }
}
