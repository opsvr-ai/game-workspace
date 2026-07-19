// craftsman-ignore: TS001,TS003
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { logger } from '../common/logger';
import type { HeartbeatUser } from './heartbeat.service';

@Injectable()
export class BlacklistIngestService {
  constructor(private readonly prisma: PrismaService) {}

  async processReport(
    user: HeartbeatUser,
    data: { processes: any[]; totalCount: number },
  ): Promise<void> {
    if (!user.companionId) return;
    logger.info('RECV blacklist:report', { companionId: user.companionId, totalCount: data.totalCount });

    await this.prisma.companionProcessReport.create({
      data: {
        companionId: user.companionId,
        processes: data.processes as any,
        totalCount: data.totalCount,
        reportTime: new Date(),
      },
    });
  }

  async processKillResult(
    user: HeartbeatUser,
    data: {
      processName: string;
      pid: number;
      success: boolean;
      resultText?: string;
      triggeredBy?: string;
      processPath?: string;
    },
  ): Promise<void> {
    if (!user.companionId) return;
    logger.info('RECV blacklist:kill_result', {
      companionId: user.companionId,
      processName: data.processName,
      pid: data.pid,
      success: data.success,
    });
    if (!data.success)
      logger.warn('Kill failed', {
        companionId: user.companionId,
        processName: data.processName,
        resultText: data.resultText,
      });

    await this.prisma.processKillLog.create({
      data: {
        companionId: user.companionId,
        processName: data.processName,
        processPath: data.processPath ?? null,
        pid: data.pid,
        success: data.success,
        resultText: data.resultText ?? null,
        triggeredBy: data.triggeredBy ?? 'PERIODIC',
      },
    });
  }

  async processUpdateAck(
    user: HeartbeatUser,
    data: { version: number },
  ): Promise<void> {
    if (!user.companionId) return;
    logger.info('RECV blacklist:update_ack', { companionId: user.companionId, version: data.version });
  }
}
