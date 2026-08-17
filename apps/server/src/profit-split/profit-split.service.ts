import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const MODES = ['offline', 'online', 'bridge'] as const;
const KEY = (mode: string) => `revenue.split_percentages.${mode}`;
const DEFAULT = { studio: 50, admin: 10, cs: 5, companion: 35 };

@Injectable()
export class ProfitSplitService {
  constructor(private prisma: PrismaService) {}

  async get(mode: string) {
    if (!MODES.includes(mode as any)) throw new BadRequestException('未知分成模式');
    const cfg = await this.prisma.systemConfig.findUnique({ where: { key: KEY(mode) } });
    return (cfg?.value as any) || DEFAULT;
  }

  async save(mode: string, data: any) {
    if (!MODES.includes(mode as any)) throw new BadRequestException('未知分成模式');
    const keys = ['studio', 'admin', 'cs', 'companion'];
    const values: Record<string, number> = {};
    for (const k of keys) {
      const v = Number(data[k]);
      if (!Number.isFinite(v) || v < 0 || v > 100) throw new BadRequestException('分成比例必须在 0-100 之间');
      values[k] = v;
    }
    const total = Object.values(values).reduce((s, v) => s + v, 0);
    if (Math.abs(total - 100) > 0.001) throw new BadRequestException(`分成比例合计必须为100%，当前为${total}%`);
    await this.prisma.systemConfig.upsert({
      where: { key: KEY(mode) },
      create: { key: KEY(mode), value: values },
      update: { value: values },
    });
    return values;
  }
}
