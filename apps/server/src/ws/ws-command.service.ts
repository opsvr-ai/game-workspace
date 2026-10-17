// craftsman-ignore: TS001,TS003
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { logger } from '../common/logger';
import type { ConnectedUser } from './ws-connection.service';

/**
 * 「客户端回执」语义层 —— 原 ws.gateway.ts 的 `pc:command_ack` 整段。
 *
 * 远程指令下发后客户端回执要落一条 PCOperationLog（谁下的、成功没成功），
 * 业务判断（只看陪玩、没登记过 PC 就不记）原样保留。
 *
 * 说明：`blacklist:report` / `blacklist:kill_result` / `blacklist:update_ack`
 * 三个回执本来就有专门的 BlacklistIngestService 承载，网关入口直接委托它，
 * 这里不再包一层空壳（避免同一个逻辑两份实现）。
 */
@Injectable()
export class WsCommandService {
  constructor(private readonly prisma: PrismaService) {}

  async handleCommandAck(
    user: ConnectedUser | undefined,
    data: { command: string; success: boolean },
  ): Promise<void> {
    if (!user?.companionId) return;
    logger.info('RECV pc:command_ack', { companionId: user.companionId, command: data.command, success: data.success });
    if (!data.success) logger.warn('Remote command failed', { companionId: user.companionId, command: data.command });

    const pc = await this.prisma.companionPC.findUnique({ where: { companionId: user.companionId } });
    if (!pc) return;

    await this.prisma.pCOperationLog.create({
      data: {
        pcId: pc.id,
        operation: data.command,
        operatorId: user.id,
        detail: JSON.stringify({ success: data.success }),
      },
    });
  }
}
