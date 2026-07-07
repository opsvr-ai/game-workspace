import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';

@Injectable()
export class RestingMonitorService {
  private readonly logger = new Logger(RestingMonitorService.name);
  private restingTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly wsGateway: WsGateway,
  ) {}

  startResting(companionId: string): void {
    this.clearTimer(companionId);
    const timer = setTimeout(async () => {
      const companion = await this.prisma.companion.findUnique({
        where: { id: companionId },
        select: { status: true },
      });
      if (companion?.status === 'RESTING') {
        this.wsGateway.sendCommand(companionId, 'shutdown');
        this.logger.log('Resting auto-shutdown triggered', { companionId });
      }
    }, 60 * 60 * 1000);
    this.restingTimers.set(companionId, timer);
    this.logger.log('Resting timer started (1h)', { companionId });
  }

  clearTimer(companionId: string): void {
    const t = this.restingTimers.get(companionId);
    if (t) {
      clearTimeout(t);
      this.restingTimers.delete(companionId);
      this.logger.log('Resting timer cleared', { companionId });
    }
  }
}
