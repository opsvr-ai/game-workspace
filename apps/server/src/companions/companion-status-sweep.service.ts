import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CompanionsService } from './companions.service';

/**
 * 定时清理「假在线」：客户端掉线/睡眠后如果没有及时上报断开，
 * 数据库里的 status 会一直停在 AVAILABLE，导致老板端误以为还在线。
 * 每 60 秒扫描一次，把超过 3 分钟没有心跳、且不在服务中的陪玩置为 OFFLINE。
 */
@Injectable()
export class CompanionStatusSweepService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companionsService: CompanionsService,
  ) {}

  onModuleInit(): void {
    setInterval(() => {
      void this.tick();
    }, 60 * 1000);
  }

  async tick(): Promise<void> {
    const stale = new Date(Date.now() - 3 * 60 * 1000);
    await this.prisma.companion.updateMany({
      where: {
        status: { notIn: ['OFFLINE', 'BUSY'] },
        OR: [
          { pc: { is: null } },
          { pc: { lastHeartbeat: null } },
          { pc: { lastHeartbeat: { lt: stale } } },
        ],
      },
      data: { status: 'OFFLINE' },
    });

    // BUSY 是接单状态，不能由上面的普通扫描直接改成离线；
    // 但如果有 BUSY 却没有真正进行中的服务会话，说明是历史脏状态，
    // 会让人永远收不到急单推送，需要单独清回空闲/离线。
    // 这里复用 hasActiveServiceSession，与上线解析/断线处理使用同一套判断标准。
    const busyCompanions = await this.prisma.companion.findMany({
      where: { status: 'BUSY' },
      select: { id: true, pc: { select: { lastHeartbeat: true } } },
    });
    for (const c of busyCompanions) {
      if (await this.companionsService.hasActiveServiceSession(c.id)) continue;
      const nextStatus =
        c.pc?.lastHeartbeat && c.pc.lastHeartbeat >= stale ? 'AVAILABLE' : 'OFFLINE';
      await this.prisma.companion.update({
        where: { id: c.id },
        data: { status: nextStatus },
      });
    }
  }
}
