import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BattleScreenshotsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(params: {
    studioId: string;
    companionId: string;
    customerId?: string | null;
    images: string[];
  }) {
    // 战绩图数量大、体积大，容易占用网络带宽；仅在陪玩「空闲」时允许上传，
    // 避免陪玩服务中传图导致网络拥堵、影响陪客户。
    const companion = await this.prisma.companion.findUnique({
      where: { id: params.companionId },
      select: { status: true },
    });
    if (companion && companion.status !== 'AVAILABLE') {
      throw new BadRequestException('请在空闲时上传战绩图，避免占用网络影响服务');
    }
    if (!params.images || params.images.length < 3) {
      throw new BadRequestException('最少上传 3 张战绩图为一组');
    }
    if (params.customerId) {
      // 校验客户属于同一工作室（且归属该陪玩，避免乱挂客户）
      const customer = await this.prisma.customer.findUnique({
        where: { id: params.customerId },
        select: { studioId: true, companionId: true },
      });
      if (!customer || customer.studioId !== params.studioId) {
        throw new BadRequestException('客户不存在或不属于当前工作室');
      }
      if (customer.companionId && customer.companionId !== params.companionId) {
        throw new ForbiddenException('只能关联属于自己的客户');
      }
    }
    return this.prisma.battleScreenshot.create({
      data: {
        studioId: params.studioId,
        companionId: params.companionId,
        customerId: params.customerId || null,
        images: params.images,
        status: 'PENDING',
      },
    });
  }

  async listMine(companionId: string) {
    return this.prisma.battleScreenshot.findMany({
      where: { companionId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listAll(studioId: string, status?: string) {
    return this.prisma.battleScreenshot.findMany({
      where: { studioId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      include: {
        companion: { include: { user: { select: { username: true, displayName: true, avatar: true } } } },
        customer: { select: { customerCode: true, wechatId: true } },
        reviewedBy: { select: { username: true, displayName: true } },
      },
    });
  }

  async review(id: string, reviewerUserId: string, action: 'approve' | 'reject', note?: string) {
    const item = await this.prisma.battleScreenshot.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('记录不存在');
    if (item.status !== 'PENDING') throw new BadRequestException('该记录已处理');

    const status = action === 'approve' ? 'APPROVED' : 'REJECTED';
    await this.prisma.battleScreenshot.update({
      where: { id },
      data: {
        status,
        reviewedById: reviewerUserId,
        reviewedAt: new Date(),
        note: note || undefined,
      },
    });

    if (action === 'approve') {
      // 采纳后给陪玩综合分加分（每采纳一组 +1 分，可通过配置调整）。
      const bonus = await this.getBonusPerApproval();
      await this.prisma.companion.update({
        where: { id: item.companionId },
        data: { bonusScore: { increment: bonus } },
      }).catch(() => {});
    }

    return { id, status };
  }

  private async getBonusPerApproval(): Promise<number> {
    const cfg = await this.prisma.systemConfig.findUnique({
      where: { key: 'excellence.battle_screenshot_bonus' },
    });
    const v = Number(cfg?.value ?? 1);
    return Number.isFinite(v) && v > 0 ? v : 1;
  }
}
