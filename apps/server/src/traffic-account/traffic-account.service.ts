import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TrafficAccountService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: any, scope?: string) {
    const where: any = {};
    if (scope === 'studio') {
      // 发布订单等场景：显示本工作室全部引流账号（客服可替请假的同事看账号）
      if (user.studioId) where.studioId = user.studioId;
    } else if (user.role === 'COMPANION' || user.role === 'CS') {
      where.userId = user.id;
    } else if (user.studioId) {
      where.studioId = user.studioId;
    }
    return this.prisma.trafficAccount.findMany({
      where,
      include: { user: { select: { username: true, displayName: true } } },
      orderBy: [{ type: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async create(user: any, dto: {
    type: string;
    nickname: string;
    code?: string;
    trafficLevel?: string;
    accountStyle?: string;
    accountId?: string;
    wifi?: string;
    wifiRegion?: string;
    riskPopped?: string;
    riskNote?: string;
    banned?: string;
    banNote?: string;
    phone?: string;
    promotionContact?: string;
    realName?: string;
    registerDate?: string;
    banDate?: string;
    imageSourceNote?: string;
    imageFolder?: string;
    otherNote?: string;
    extra?: Record<string, any>;
    notes?: string;
    userId?: string;
  }) {
    if (!user.studioId) throw new ForbiddenException('无工作室权限');
    const ownerId = user.role === 'CS' || user.role === 'COMPANION' ? user.id : (dto.userId || user.id);
    if (!dto.type?.trim() || !dto.nickname?.trim()) {
      throw new ForbiddenException('类型和昵称必填');
    }
    return this.prisma.trafficAccount.create({
      data: {
        studioId: user.studioId,
        userId: ownerId,
        type: dto.type.trim(),
        code: dto.code?.trim() || null,
        trafficLevel: dto.trafficLevel?.trim() || null,
        accountStyle: dto.accountStyle?.trim() || null,
        nickname: dto.nickname.trim(),
        accountId: dto.accountId?.trim() || null,
        wifi: dto.wifi?.trim() || null,
        wifiRegion: dto.wifiRegion?.trim() || null,
        riskPopped: dto.riskPopped?.trim() || null,
        riskNote: dto.riskNote?.trim() || null,
        banned: dto.banned?.trim() || null,
        banNote: dto.banNote?.trim() || null,
        phone: dto.phone?.trim() || null,
        promotionContact: dto.promotionContact?.trim() || null,
        realName: dto.realName?.trim() || null,
        registerDate: dto.registerDate?.trim() || null,
        banDate: dto.banDate?.trim() || null,
        imageSourceNote: dto.imageSourceNote?.trim() || null,
        imageFolder: dto.imageFolder?.trim() || null,
        otherNote: dto.otherNote?.trim() || null,
        extra: dto.extra || {},
        notes: dto.notes?.trim() || null,
      },
    });
  }

  async update(user: any, id: string, dto: {
    type?: string;
    code?: string;
    trafficLevel?: string;
    accountStyle?: string;
    nickname?: string;
    accountId?: string;
    wifi?: string;
    wifiRegion?: string;
    riskPopped?: string;
    riskNote?: string;
    banned?: string;
    banNote?: string;
    phone?: string;
    promotionContact?: string;
    realName?: string;
    registerDate?: string;
    banDate?: string;
    imageSourceNote?: string;
    imageFolder?: string;
    otherNote?: string;
    extra?: Record<string, any>;
    status?: string;
    notes?: string;
  }) {
    const acc = await this.prisma.trafficAccount.findUnique({ where: { id } });
    if (!acc) throw new NotFoundException('引流账号不存在');
    // CS 只能改自己的；ADMIN/OWNER 可改工作室内的
    if (user.role === 'CS' || user.role === 'COMPANION') {
      if (acc.userId !== user.id) throw new ForbiddenException('只能操作自己的引流账号');
    } else if (user.studioId && acc.studioId !== user.studioId) {
      throw new ForbiddenException('无权操作其他工作室的账号');
    }
    const data: any = {};
    if (dto.type !== undefined) data.type = dto.type.trim();
    if (dto.code !== undefined) data.code = dto.code?.trim() || null;
    if (dto.trafficLevel !== undefined) data.trafficLevel = dto.trafficLevel?.trim() || null;
    if (dto.accountStyle !== undefined) data.accountStyle = dto.accountStyle?.trim() || null;
    if (dto.nickname !== undefined) data.nickname = dto.nickname.trim();
    if (dto.accountId !== undefined) data.accountId = dto.accountId?.trim() || null;
    if (dto.wifi !== undefined) data.wifi = dto.wifi?.trim() || null;
    if (dto.wifiRegion !== undefined) data.wifiRegion = dto.wifiRegion?.trim() || null;
    if (dto.riskPopped !== undefined) data.riskPopped = dto.riskPopped?.trim() || null;
    if (dto.riskNote !== undefined) data.riskNote = dto.riskNote?.trim() || null;
    if (dto.banned !== undefined) data.banned = dto.banned?.trim() || null;
    if (dto.banNote !== undefined) data.banNote = dto.banNote?.trim() || null;
    if (dto.phone !== undefined) data.phone = dto.phone?.trim() || null;
    if (dto.promotionContact !== undefined) data.promotionContact = dto.promotionContact?.trim() || null;
    if (dto.realName !== undefined) data.realName = dto.realName?.trim() || null;
    if (dto.registerDate !== undefined) data.registerDate = dto.registerDate?.trim() || null;
    if (dto.banDate !== undefined) data.banDate = dto.banDate?.trim() || null;
    if (dto.imageSourceNote !== undefined) data.imageSourceNote = dto.imageSourceNote?.trim() || null;
    if (dto.imageFolder !== undefined) data.imageFolder = dto.imageFolder?.trim() || null;
    if (dto.otherNote !== undefined) data.otherNote = dto.otherNote?.trim() || null;
    if (dto.extra !== undefined) data.extra = dto.extra;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.notes !== undefined) data.notes = dto.notes?.trim() || null;
    return this.prisma.trafficAccount.update({ where: { id }, data });
  }

  async remove(user: any, id: string) {
    const acc = await this.prisma.trafficAccount.findUnique({ where: { id } });
    if (!acc) throw new NotFoundException('引流账号不存在');
    if (user.role === 'CS' || user.role === 'COMPANION') {
      if (acc.userId !== user.id) throw new ForbiddenException('只能删除自己的引流账号');
    } else if (user.studioId && acc.studioId !== user.studioId) {
      throw new ForbiddenException('无权操作其他工作室的账号');
    }
    await this.prisma.trafficAccount.delete({ where: { id } });
    return { success: true };
  }
}
