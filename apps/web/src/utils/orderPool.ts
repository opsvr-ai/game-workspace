import { orderTypeConfig, serviceTypeConfig } from '../constants/orders';

const pad2 = (n: number) => String(n).padStart(2, '0');

export const fmtClock = (v: string) => {
  const d = new Date(v);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

export const fmtSpan = (ms: number) => {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h${m % 60}m`;
  if (m > 0) return `${m}分${s % 60}秒`;
  return `${s}秒`;
};

/** 相对时间（订单列表用）：刚刚 / N分钟前 / N小时前 / N天前 */
export const fmtAgo = (ms: number) => {
  const m = Math.floor(Math.max(0, ms) / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时前`;
  return `${Math.floor(h / 24)}天前`;
};

export const fmtSeconds = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}分${sec}秒`;
};

/**
 * 「派单池 / 派单记录」的搜索：一个框同时搜客户和游戏。
 *
 * 老板 2026-09-27：「在派单池、派单记录加一个搜索功能，根据客户的微信或者小红书账号或者其他的可以搜索」。
 * 客户信息在这套系统里散在好几个地方（订单上的 `customer`、以及 `customFields` 里客服手填的一堆字段），
 * 这里把它们拼成一段文本一次搜掉，免得「微信搜得到、小红书账号搜不到」。
 *
 * 支持用空格分隔多个关键词（要**同时**命中，例如「小红书 shun」）。
 */
export function buildOrderSearchText(order: any): string {
  const cf = order?.customFields || {};
  return [
    order?.gameName,
    // 订单自带的客户信息
    order?.customer?.wechatId,
    order?.customer?.customerCode,
    order?.customer?.platform,
    // 客服发单时填的客户信息
    cf.customerWechat,
    cf.customerNickname,
    cf.customerAccountId,
    cf.customerSource, // 来源平台（小红书 / 抖音 / 快手…）
    cf.customerSourceAccount, // 来源账号（发笔记的那个号）
    cf.customerRoomCode,
    cf.customerYy,
    cf.customerPlatformAccount,
    cf.deltaNote,
    // 人和服务
    order?.csUser?.username,
    order?.csUser?.displayName,
    order?.companion?.user?.username,
    order?.companion?.user?.displayName,
    order?.coCompanion?.user?.username,
  ]
    .filter((v) => v != null && v !== '')
    .map((v) => String(v))
    .join(' ')
    .toLowerCase();
}

export function orderMatchesSearch(order: any, keyword: string): boolean {
  const tokens = String(keyword || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return true;
  const haystack = buildOrderSearchText(order);
  return tokens.every((t) => haystack.includes(t));
}

export function buildOrderInfoFields(
  order: any,
  now: number,
  disappearMinutes: number,
  scheduledDisappearMinutes: number,
  opts: { taken?: boolean } = {},
): string[] {
  const type = orderTypeConfig[order.type]?.label || order.type || '首单';
  const svc = serviceTypeConfig[order.customFields?.serviceType]?.label || '陪玩';
  const mission = order.customFields?.deltaMission || '\u00A0';
  const note = order.customFields?.deltaNote?.trim?.() || '';
  const isRound = order.customFields?.billingMode === 'round';
  const dur = isRound
    ? `${order.duration || order.customFields?.deltaCount || '?'}局`
    : `${order.duration || '?'}h`;
  const sd = order.coCompanionId || order.customFields?.deltaCount === '双' ? '双陪' : '单陪';
  const wait = now - new Date(order.createdAt).getTime();
  const scheduledTime =
    order.customFields?.urgency === 'later'
      ? order.customFields?.scheduledTimeText || '\u00A0'
      : '\u00A0';
  const disappearMins =
    order.customFields?.urgency === 'later' ? scheduledDisappearMinutes : disappearMinutes;
  const disappearIn = disappearMins * 60 * 1000 - wait;
  const disappearText = disappearIn > 0 ? fmtSpan(disappearIn) : '0秒';

  return [
    order.gameName,
    type,
    svc,
    mission,
    ...(note ? [`备注:${note.length > 14 ? `${note.slice(0, 14)}…` : note}`] : []),
    dur,
    sd,
    `${Number(order.amount || 0).toFixed(0)}元`,
    order.customFields?.urgency === 'later' ? '预约' : '立即打',
    scheduledTime,
    fmtClock(order.createdAt),
    // 已经被抢走的单（灰色记录）：不再有「等多久 / 还差多久消失」，改成什么时候被抢的。
    ...(opts.taken
      ? [`抢单 ${fmtClock(order._takenAt || order.grabbedAt || order.updatedAt || order.createdAt)}`]
      : [`已等待 ${fmtSpan(wait)}`, `距离消失 ${disappearText}`]),
  ];
}
