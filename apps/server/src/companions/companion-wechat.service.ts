import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CompanionWechatService {
  constructor(private prisma: PrismaService) {}

  async listWorkWechats(studioId: string) {
    return this.prisma.workWechat.findMany({
      where: { studioId },
      include: { companion: { include: { user: { select: { username: true, avatar: true, displayName: true } } } } },
    });
  }

  async addWorkWechat(studioId: string, wechatId: string, type?: string) {
    return this.prisma.workWechat.create({ data: { studioId, wechatId, type: type || 'COMPANION' } });
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
    // 同一个客服只能绑一个工作室微信，绑定新微信时先解绑旧微信
    await this.prisma.workWechat.updateMany({
      where: { csUserId },
      data: { csUserId: null, status: 'AVAILABLE' },
    });
    return this.prisma.workWechat.update({
      where: { id },
      data: { csUserId, companionId: null, status: 'BOUND' },
    });
  }

  async unbindCsUser(id: string) {
    return this.prisma.workWechat.update({ where: { id }, data: { csUserId: null, status: 'AVAILABLE' } });
  }

  async deleteWorkWechat(id: string) {
    return this.prisma.workWechat.delete({ where: { id } });
  }
}
