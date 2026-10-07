import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CompanionsService } from './companions.service';
import { WsGateway } from '../ws/ws.gateway';
import { switchCompanionStatus } from '../common/companion-status-switch';

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
    private readonly wsGateway: WsGateway,
  ) {}

  onModuleInit(): void {
    setInterval(() => {
      void this.tick();
    }, 60 * 1000);
  }

  async tick(): Promise<void> {
    const stale = new Date(Date.now() - 3 * 60 * 1000);
    const goneCompanions = await this.prisma.companion.findMany({
      where: {
        status: { notIn: ['OFFLINE', 'BUSY'] },
        OR: [
          { pc: { is: null } },
          { pc: { lastHeartbeat: null } },
          { pc: { lastHeartbeat: { lt: stale } } },
        ],
      },
      select: { id: true },
    });
    // 走统一入口而不是裸 updateMany：改状态时把还开着的那段计时日志一起封口。
    // 不封的话，「人早就睡了」的那段时间会被看板一直算成在线 —— 接单率（接单时长 ÷ 在线时长）
    // 就被越摊越低（老板 2026-10-07）。
    const now = new Date();
    for (const c of goneCompanions) {
      await switchCompanionStatus(this.prisma, c.id, 'OFFLINE', now);
    }

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
      await switchCompanionStatus(this.prisma, c.id, nextStatus, now);
      // 改了状态就得推黑名单 —— 客户端只认 blacklist:update 里的 status（老板 2026-10-03：
      // 服务端自己动状态却不通知，「接单中」的客户端于是继续按旧状态挂/摘杀进程的名单）。
      await this.wsGateway.refreshCompanionBlacklist(c.id).catch(() => {});
    }
  }
}
