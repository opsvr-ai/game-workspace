import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TrafficAccountService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: any) {
    const where: any = {};
    if (user.role === 'COMPANION' || user.role === 'CS') {
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
    accountId?: string;
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
        nickname: dto.nickname.trim(),
        accountId: dto.accountId?.trim() || null,
        notes: dto.notes?.trim() || null,
      },
    });
  }

  async update(user: any, id: string, dto: {
    type?: string;
    nickname?: string;
    accountId?: string;
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
    if (dto.nickname !== undefined) data.nickname = dto.nickname.trim();
    if (dto.accountId !== undefined) data.accountId = dto.accountId?.trim() || null;
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
