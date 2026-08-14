import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MODE_PRICE_RULES, floorPriceYuan } from '../common/price-rules';
import { yuanToCents, centsToYuan } from '../common/money';

export type PriceOrderType = 'FIRST' | 'RENEW';

export interface PriceRuleInput {
  gameName: string;
  serviceType?: string;
  mode: string;
  orderType?: PriceOrderType;
  floorPriceYuan: number;
  maxPriceYuan?: number | null;
  isActive?: boolean;
}

@Injectable()
export class PriceRuleService {
  constructor(private readonly prisma: PrismaService) {}

  /** 取某游戏/模式的底价（分）。优先工作室自定义规则，否则回退内置常量。 */
  async getFloorPriceCents(
    studioId: string | null,
    gameName: string,
    mode: string,
    orderType: PriceOrderType,
  ): Promise<number | null> {
    const rule = await this.prisma.priceRule.findFirst({
      where: { OR: [{ studioId }, { studioId: null }], gameName, mode, orderType, isActive: true },
      orderBy: { studioId: 'desc' },
    });
    if (rule) return rule.floorPrice;

    const yuan = floorPriceYuan(mode, orderType === 'RENEW');
    return yuan != null ? yuanToCents(yuan) : null;
  }

  async list(studioId: string) {
    const rules = await this.prisma.priceRule.findMany({
      where: { OR: [{ studioId }, { studioId: null }] },
      orderBy: [{ studioId: 'desc' }, { gameName: 'asc' }, { mode: 'asc' }, { orderType: 'asc' }],
    });
    return rules.map((r) => ({
      id: r.id,
      studioId: r.studioId,
      gameName: r.gameName,
      serviceType: r.serviceType,
      mode: r.mode,
      orderType: r.orderType,
      floorPriceYuan: centsToYuan(r.floorPrice),
      maxPriceYuan: r.maxPrice != null ? centsToYuan(r.maxPrice) : null,
      isActive: r.isActive,
    }));
  }

  async create(studioId: string, dto: PriceRuleInput) {
    return this.prisma.priceRule.create({
      data: {
        studioId,
        gameName: dto.gameName,
        serviceType: dto.serviceType ?? 'PLAY_WITH',
        mode: dto.mode,
        orderType: dto.orderType ?? 'FIRST',
        floorPrice: yuanToCents(dto.floorPriceYuan),
        maxPrice: dto.maxPriceYuan != null ? yuanToCents(dto.maxPriceYuan) : null,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(id: string, dto: Partial<PriceRuleInput>) {
    const data: Record<string, unknown> = {};
    if (dto.gameName !== undefined) data.gameName = dto.gameName;
    if (dto.serviceType !== undefined) data.serviceType = dto.serviceType;
    if (dto.mode !== undefined) data.mode = dto.mode;
    if (dto.orderType !== undefined) data.orderType = dto.orderType;
    if (dto.floorPriceYuan !== undefined) data.floorPrice = yuanToCents(dto.floorPriceYuan);
    if (dto.maxPriceYuan !== undefined) data.maxPrice = dto.maxPriceYuan != null ? yuanToCents(dto.maxPriceYuan) : null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    return this.prisma.priceRule.update({ where: { id }, data });
  }

  builtinModes() {
    return Object.entries(MODE_PRICE_RULES).map(([mode, rule]) => ({ mode, ...rule }));
  }
}
