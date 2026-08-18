import { Injectable } from '@nestjs/common';
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
