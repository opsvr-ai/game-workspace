import { describe, it, expect } from 'vitest';
import { CommissionService } from '../finance/commission.service';
import {
  applyCsCommissionOverride,
  csCountsForCommission,
  normalizeCsCommissionOverride,
} from '../common/cs-commission';

/**
 * 「按人一套提成」+「只算首单」（老板 2026-09-30：「我自己填写」）。
 *
 * 老板原话：「邵、孙各自底薪多少？……桥接、线上每单多少？孙也照用，还是他单独一套？」
 * 「客服提成只算首单（现在的口径），还是续单/复购也算？」
 *
 * 这份测试钉三件事：
 *  1. 一个人单独填了 = 只有他按他填的算，别人一分不变；
 *  2. **一个人不填 = 完全等于以前**（回归保护，钱一分不能变）；
 *  3. `commission.cs_include_renewal` 默认关 = 只算首单。
 */

const STUDIO = 'st-own';
const SHAO = 'cs-shao';
const SUN = 'cs-sun';
const MONTH = '2026-09';

/** 一张本店线下的成功单（陪玩点了「开始首单」，所以 status = DONE） */
const offlineOrder = (csUserId: string, over: Record<string, any> = {}) => ({
  id: `o-${csUserId}-${over.id || '1'}`,
  orderCode: `ON-${csUserId}`,
  type: 'NEW',
  status: 'DONE',
  contactStatus: 'CONTACTED',
  outcome: 'SUCCESS',
  outcomeReason: null,
  refundedAt: null,
  amount: 100,
  coAmount: null,
  duration: 1,
  coCompanionId: null,
  customFields: {},
  companionId: 'c-1',
  csUserId,
  attributedCsUserId: csUserId,
  claimedCsUserId: null,
  poolScope: 'OFFLINE_FIRST',
  createdAt: new Date(),
  companion: {
    studio: { id: STUDIO, type: 'OFFLINE' },
    user: { username: 'c1', displayName: '陪玩一' },
  },
  sessions: [{ startedAt: new Date() }],
  ...over,
});

function makeService(opts: { configs?: Record<string, any>; profiles?: any[]; orders?: any[] }) {
  const configs = opts.configs || {};
  const profiles = opts.profiles || [];
  const orders = opts.orders || [];
  const prisma: any = {
    systemConfig: {
      findMany: async ({ where }: any) =>
        Object.entries(configs)
          .filter(([k]) => ((where && where.key && where.key.in) || []).includes(k))
          .map(([key, value]) => ({ key, value })),
    },
    studioConfig: { findMany: async () => [] },
    user: {
      findMany: async () => [
        { id: SHAO, username: 'shaozh', displayName: '邵泽慧' },
        { id: SUN, username: 'sunkx', displayName: '孙可馨' },
      ],
    },
    order: {
      // 认 where 里的 OR（不然两个人会拿到同一批单，测不出「按人」）
      findMany: async ({ where }: any) => {
        const ids = ((where && where.OR) || [])
          .map((c: any) => c.attributedCsUserId || c.claimedCsUserId || c.csUserId)
          .filter(Boolean);
        let out = ids.length ? orders.filter((o) => ids.includes(o.csUserId)) : orders;
        // 「只算首单」是靠查询里的 type 过滤实现的，mock 也得认，否则测不出来
        const t = where && where.type;
        if (t && Array.isArray(t.in)) out = out.filter((o) => t.in.includes(o.type));
        else if (typeof t === 'string') out = out.filter((o) => o.type === t);
        return out;
      },
    },
    csProfile: { findMany: async () => profiles },
    payrollConfig: {
      findUnique: async () => ({ baseSalary: 2100, fullAttendanceDays: 4, lateDeduction: 0, absentDeduction: 0 }),
    },
    staffAttendance: { findMany: async () => [] },
    commissionRule: { findMany: async () => [] },
  };
  return new CommissionService(prisma);
}

describe('客服提成 · 按人一套（老板 2026-09-30）', () => {
  it('孙单独填了 2% / 保底 3 元：只有他变，邵还是本店的 1% / 保底 2 元', async () => {
    const rows = (
      await makeService({
        configs: { 'commission.cs_offline_rate_percent': 1 },
        profiles: [
          { userId: SUN, baseSalaryYuan: null, commissionConfig: { offlineRatePercent: 2, offlineFloorYuan: 3 } },
        ],
        orders: [offlineOrder(SHAO), offlineOrder(SUN)],
      }).computeCsCommission(STUDIO, MONTH)
    ).rows;

    const shao = rows.find((r) => r.userId === SHAO) as any;
    const sun = rows.find((r) => r.userId === SUN) as any;

    // 邵：100 × 1% = 1 元 → 不足保底 2 元，按保底发
    expect(shao.offlineYuan).toBe(2);
    // 孙：100 × 2% = 2 元 → 不足他自己定的保底 3 元，按 3 元发
    expect(sun.offlineYuan).toBe(3);
  });

  it('孙单独填桥接单价 4 元：邵还是本店的 1 元/单', async () => {
    const bridge = (csUserId: string) =>
      offlineOrder(csUserId, {
        companion: { studio: { id: 'st-bridge', type: 'OFFLINE' }, user: { username: 'c9', displayName: '别家陪玩' } },
      });
    const rows = (
      await makeService({
        configs: { 'commission.cs_bridge_per_order_yuan': 1 },
        profiles: [{ userId: SUN, baseSalaryYuan: null, commissionConfig: { bridgePerOrderYuan: 4 } }],
        orders: [bridge(SHAO), bridge(SUN)],
      }).computeCsCommission(STUDIO, MONTH)
    ).rows;

    expect((rows.find((r) => r.userId === SHAO) as any).bridgeYuan).toBe(1);
    expect((rows.find((r) => r.userId === SUN) as any).bridgeYuan).toBe(4);
  });

  it('一个人不填 = 完全等于以前（钱一分不变）', async () => {
    const orders = [offlineOrder(SHAO), offlineOrder(SUN)];
    const withoutProfiles = (await makeService({ configs: {}, orders }).computeCsCommission(STUDIO, MONTH)).rows;
    const withEmptyProfiles = (
      await makeService({
        configs: {},
        profiles: [
          { userId: SHAO, baseSalaryYuan: null, commissionConfig: null },
          { userId: SUN, baseSalaryYuan: null, commissionConfig: {} },
        ],
        orders,
      }).computeCsCommission(STUDIO, MONTH)
    ).rows;
    expect(withEmptyProfiles).toEqual(withoutProfiles);
  });

  it('合并规则：只填了的项覆盖，其它项还是本店的', () => {
    const base = { ratePercent: 1, floorCents: 200, bridgePerOrderCents: 100, onlineMode: 'RATE' };
    expect(applyCsCommissionOverride(base, {})).toBe(base); // 空的 = 原对象，连引用都不换
    const merged = applyCsCommissionOverride(base, { offlineFloorYuan: 3.5, onlineMode: 'PER_ORDER' });
    expect(merged.ratePercent).toBe(1); // 没填 = 本店的
    expect(merged.floorCents).toBe(350);
    expect(merged.onlineMode).toBe('PER_ORDER');
    expect(base.floorCents).toBe(200); // 不能改到本店那一份
  });

  it('写错的 / 负数的 / 空的都当没填', () => {
    expect(normalizeCsCommissionOverride({ offlineFloorYuan: -1, offlineRatePercent: 'x', bridgePerOrderYuan: '' })).toEqual({});
    expect(normalizeCsCommissionOverride({ onlineMode: 'per_order', offlineRatePercent: '2' })).toEqual({
      onlineMode: 'PER_ORDER',
      offlineRatePercent: 2,
    });
    expect(normalizeCsCommissionOverride(null)).toEqual({});
  });
});

describe('客服提成 · 只算首单（老板 2026-09-30）', () => {
  it('默认只算首单：续单不提成', async () => {
    const rows = (
      await makeService({
        configs: {},
        orders: [offlineOrder(SHAO), offlineOrder(SHAO, { id: '2', type: 'RENEW' })],
      }).computeCsCommission(STUDIO, MONTH)
    ).rows;
    expect((rows.find((r) => r.userId === SHAO) as any).offlineYuan).toBe(2); // 只算那一张首单
  });

  it('打开开关：续单 / 复购也算', async () => {
    const rows = (
      await makeService({
        configs: { 'commission.cs_include_renewal': true },
        orders: [offlineOrder(SHAO), offlineOrder(SHAO, { id: '2', type: 'RENEW' })],
      }).computeCsCommission(STUDIO, MONTH)
    ).rows;
    expect((rows.find((r) => r.userId === SHAO) as any).offlineYuan).toBe(4); // 两张单都算
    expect(csCountsForCommission({ type: 'RENEW' }, true)).toBe(true);
    expect(csCountsForCommission({ type: 'RENEW' }, false)).toBe(false);
    expect(csCountsForCommission({ type: 'NEW' }, false)).toBe(true);
  });

  it('今日看板 / 我的工资回显也带着这个开关', async () => {
    const today = await makeService({ configs: { 'commission.cs_include_renewal': true }, orders: [] }).getCsCommissionToday(STUDIO);
    expect(today.config.includeRenewal).toBe(true);
    const mine = await makeService({ configs: {}, orders: [] }).getCsMySalary(STUDIO, SHAO, MONTH);
    expect(mine.config.includeRenewal).toBe(false);
  });
});

describe('客服底薪 · 按人填（老板 2026-09-30）', () => {
  it('填了用他的，没填用「工资规则」里客服那一个数', async () => {
    const mine = await makeService({
      profiles: [{ userId: SHAO, baseSalaryYuan: 5000, commissionConfig: null }],
    }).getCsMySalary(STUDIO, SHAO, MONTH);
    expect((mine.row as any).baseSalary).toBe(5000);
    expect(mine.config.baseSalary).toBe(5000); // 界面上「底薪」显示的就是他实际那一份

    const fallback = await makeService({ profiles: [] }).getCsMySalary(STUDIO, SUN, MONTH);
    expect((fallback.row as any).baseSalary).toBe(2100);
    expect(fallback.config.baseSalary).toBe(2100);
  });
});
