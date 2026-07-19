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

  async addWorkWechat(studioId: string, wechatId: string) {
    return this.prisma.workWechat.create({ data: { studioId, wechatId } });
  }

  async bindWechat(id: string, companionId: string) {
    return this.prisma.workWechat.update({ where: { id }, data: { companionId, status: 'BOUND' } });
  }

  async unbindWechat(id: string) {
    return this.prisma.workWechat.update({ where: { id }, data: { companionId: null, status: 'AVAILABLE' } });
  }
}
