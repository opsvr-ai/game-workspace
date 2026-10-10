/**
 * 「订单管理」筛选栏 —— **每一个标签**的唯一一份筛选口径（老板 2026-10-11）。
 *
 * 老板原话：「让系统里的每一个标签都能筛选，一步到位 免得天天让你改」。
 * 所以订单表里会出现的**每一种标签**都在这里声明一次：
 *   一个维度 = 一个下拉（`placeholder` + `options`）+ 一个判定函数（`match`）。
 * 界面按这份清单自动生成下拉、筛选也按这份清单跑 ——
 * **以后加一个新标签（新状态 / 新来源 / 新任务类型…）只要在这里补一行**，
 * 下拉和筛选一起生效，不用再翻 OrdersPage 的工具条、也不会漏掉某一类。
 *
 * 只收「客户端就能判」的维度；状态（走服务端 `params.status`）、员工 / 派单人 /
 * 日期 / 关键词搜索各有各的动态取值，不在这里。
 */
import {
  contactStatusConfig,
  contactStatusOrder,
  dispatchTypeConfig,
  dispatchTypeOrder,
  orderTypeConfig,
  serviceTypeConfig,
} from './orders';
import { isOrderStuck } from './orderFields';

export interface OrderFilterOption {
  value: string;
  label: string;
}

export interface OrderFilterDimension {
  /** 稳定 key：筛选值存在 `tagFilters[key]` 里 */
  key: string;
  /** 下拉的占位符（也就是这一维度的名字） */
  placeholder: string;
  /** 下拉宽度 */
  width: number;
  options: OrderFilterOption[];
  /** 这一行匹配这个值时返回 true */
  match: (order: any, value: string) => boolean;
}

const asList = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** 客户来源：固定那几个平台 + 这一批数据里实际出现过的（免得漏掉「转介绍」这种自己填的）。 */
export const CUSTOMER_SOURCE_BASE = ['小红书', '抖音', '快手', '闲鱼', 'B站', '视频号', '转介绍', '其他'];

export function buildCustomerSourceOptions(orders: any[]): OrderFilterOption[] {
  const seen = new Set<string>(CUSTOMER_SOURCE_BASE);
  for (const o of orders) {
    const s = String(o?.customFields?.customerSource || '').trim();
    if (s) seen.add(s);
  }
  return Array.from(seen).map((v) => ({ value: v, label: v }));
}

/** 订单表里按顺序出现、且「客户端就能判」的标签维度（工具条按这个顺序排下拉）。 */
export const ORDER_FILTER_DIMENSIONS: OrderFilterDimension[] = [
  {
    key: 'type',
    placeholder: '订单类型',
    width: 100,
    options: Object.entries(orderTypeConfig).map(([value, v]) => ({ value, label: v.label })),
    match: (o, v) => (o?.type || 'NEW') === v,
  },
  {
    key: 'dispatchType',
    placeholder: '派单方式',
    width: 100,
    options: dispatchTypeOrder.map((value) => ({ value, label: dispatchTypeConfig[value]?.label ?? value })),
    match: (o, v) => o?.dispatchType === v,
  },
  {
    key: 'serviceType',
    placeholder: '服务类型',
    width: 100,
    options: Object.entries(serviceTypeConfig).map(([value, v]) => ({ value, label: v.label })),
    match: (o, v) => (o?.serviceType || 'PLAY_WITH') === v,
  },
  {
    key: 'deltaMission',
    placeholder: '任务类型',
    width: 100,
    options: [
      { value: '机密', label: '机密' },
      { value: '绝密', label: '绝密' },
    ],
    match: (o, v) => String(o?.customFields?.deltaMission || '') === v,
  },
  {
    key: 'deltaCount',
    placeholder: '单/双陪',
    width: 100,
    options: [
      { value: '单', label: '单陪' },
      { value: '双', label: '双陪' },
    ],
    match: (o, v) => (o?.customFields?.deltaCount === '双' ? '双' : '单') === v,
  },
  {
    // 订单表那一格写的是「立即打 / 预约」（constants/orderFields.ts 的 orderUrgencyText），
    // 这里跟它对齐：不带 emoji。
    key: 'urgency',
    placeholder: '打单时间',
    width: 110,
    options: [
      { value: 'now', label: '立即打' },
      { value: 'later', label: '预约' },
    ],
    match: (o, v) => (o?.customFields?.urgency === 'later' ? 'later' : 'now') === v,
  },
  {
    key: 'contactStatus',
    placeholder: '添加情况',
    width: 110,
    options: [
      ...contactStatusOrder.map((k) => ({ value: k, label: contactStatusConfig[k].label })),
      { value: 'NONE', label: '还没记' },
    ],
    match: (o, v) => (v === 'NONE' ? !o?.contactStatus : o?.contactStatus === v),
  },
  {
    key: 'outcome',
    placeholder: '报结果',
    width: 100,
    options: [
      { value: 'NONE', label: '待反馈' },
      { value: 'SUCCESS', label: '成功' },
      { value: 'FAILED', label: '不成功' },
    ],
    match: (o, v) => (v === 'NONE' ? !o?.outcome : o?.outcome === v),
  },
  {
    key: 'supplement',
    placeholder: '补单申请',
    width: 110,
    options: [
      { value: 'ANY', label: '有申请' },
      { value: 'PENDING', label: '待审核' },
      { value: 'APPROVED', label: '已同意' },
      { value: 'REJECTED', label: '已驳回' },
    ],
    match: (o, v) => {
      const reqs = asList(o?.supplementRequests);
      if (v === 'ANY') return reqs.length > 0;
      return reqs.some((r: any) => r?.status === v);
    },
  },
  {
    key: 'transfer',
    placeholder: '转让记录',
    width: 110,
    options: [
      { value: 'YES', label: '已转让' },
      { value: 'NO', label: '没转让' },
    ],
    match: (o, v) => (v === 'YES' ? asList(o?.transfers).length > 0 : asList(o?.transfers).length === 0),
  },
  {
    // 状态那一格有时写的是「无人接」（超时没人抢、已退回流转失败明细），
    // 它不是一个 `status`，所以单独当一个标签筛（判定只有一份：isOrderStuck）。
    key: 'stuck',
    placeholder: '是否无人接',
    width: 120,
    options: [
      { value: 'YES', label: '无人接' },
      { value: 'NO', label: '有人接 / 未超时' },
    ],
    match: (o, v) => (v === 'YES' ? isOrderStuck(o) : !isOrderStuck(o)),
  },
];

/** 这一批数据还要额外长出哪些维度（客户来源跟着数据走，不写死）。 */
export function buildOrderFilterDimensions(orders: any[]): OrderFilterDimension[] {
  return [
    ...ORDER_FILTER_DIMENSIONS,
    {
      key: 'customerSource',
      placeholder: '客户来源',
      width: 110,
      options: buildCustomerSourceOptions(orders),
      match: (o, v) => String(o?.customFields?.customerSource || '') === v,
    },
  ];
}

/** 按工具条上选中的每一个标签筛一遍（都满足才算命中）。 */
export function applyOrderTagFilters(
  orders: any[],
  values: Record<string, string>,
  dimensions: OrderFilterDimension[],
): any[] {
  const active = dimensions.filter((d) => values?.[d.key]);
  if (active.length === 0) return orders;
  return orders.filter((o) => active.every((d) => d.match(o, values[d.key])));
}

/** 现在一共选了几个标签（工具条上用来显示「重置筛选（N）」）。 */
export function countActiveOrderFilters(values: Record<string, string>): number {
  return Object.values(values || {}).filter(Boolean).length;
}
