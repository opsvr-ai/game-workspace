import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CommissionService } from './commission.service';

let lastSettled: string | null = null;

@Injectable()
export class CommissionScheduler implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commissions: CommissionService,
  ) {}

  onModuleInit() {
    // 每小时检查一次；启动 30 秒后先跑一次补结算
    setInterval(() => { this.tick().catch(() => {}); }, 60 * 60 * 1000);
    setTimeout(() => { this.tick().catch(() => {}); }, 30 * 1000);
  }

  async tick() {
    const now = new Date();
    const boundary = new Date(now.getFullYear(), now.getMonth(), 1, 12, 0, 0, 0);
    if (now < boundary) return;

    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1, 12, 0, 0, 0);
    const month = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    if (lastSettled === month) return;

    const studios = await this.prisma.studio.findMany({ select: { id: true } });
    for (const s of studios) {
      await this.commissions.ensureDefaultCsRules(s.id);
      await this.commissions.calculateMonth(s.id, month);
    }
    lastSettled = month;
  }
}
