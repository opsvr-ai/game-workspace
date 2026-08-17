import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const MODES = ['offline', 'online', 'bridge'] as const;
const KEY = (mode: string) => `revenue.split_percentages.${mode}`;
const DEFAULTS: Record<string, any> = {
  offline: {
    tiers: [
      { min: 0, max: 5999.9, companion: 50, studio: 50 },
      { min: 6000, max: 9999, companion: 60, studio: 40 },
      { min: 10000, max: null, companion: 70, studio: 30, minTenureMonths: 6 },
    ],
  },
  online: { studio: 50, admin: 10, cs: 5, companion: 35 },
  bridge: { confidentialSettle: false, secretRefund: 15 },
};

@Injectable()
export class ProfitSplitService {
  constructor(private prisma: PrismaService) {}

  async get(mode: string) {
    if (!MODES.includes(mode as any)) throw new BadRequestException('未知分成模式');
    const cfg = await this.prisma.systemConfig.findUnique({ where: { key: KEY(mode) } });
    return (cfg?.value as any) || DEFAULTS[mode];
  }

  async save(mode: string, data: any) {
    if (!MODES.includes(mode as any)) throw new BadRequestException('未知分成模式');
    let values: any = data;
    if (mode === 'online') {
      const keys = ['studio', 'admin', 'cs', 'companion'];
      const normalized: Record<string, number> = {};
      for (const k of keys) {
        const v = Number(data[k]);
        if (!Number.isFinite(v) || v < 0 || v > 100) throw new BadRequestException('分成比例必须在 0-100 之间');
        normalized[k] = v;
      }
      const total = Object.values(normalized).reduce((s, v) => s + v, 0);
      if (Math.abs(total - 100) > 0.001) throw new BadRequestException(`分成比例合计必须为100%，当前为${total}%`);
      values = normalized;
    } else if (mode === 'bridge') {
      values = {
        confidentialSettle: data.confidentialSettle === true,
        secretRefund: Number(data.secretRefund || 0),
      };
    } else if (mode === 'offline') {
      values = { tiers: Array.isArray(data.tiers) ? data.tiers : DEFAULTS.offline.tiers };
    }
    await this.prisma.systemConfig.upsert({
      where: { key: KEY(mode) },
      create: { key: KEY(mode), value: values },
      update: { value: values },
    });
    return values;
  }
}
