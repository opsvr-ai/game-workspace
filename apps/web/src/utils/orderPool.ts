import { buildOrderFieldEntries, orderFieldLabel, type OrderFieldEntry } from '../constants/orderFields';

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

/**
 * 抢单池 / 派单工作台那一行的字段（标签 + 值）。
 *
 * 老板 2026-09-30：「从发布订单→进入抢单池/指定→订单管理→客户管理 用的都是同一条数据，
 * 你把所有的显示的标签都用一样的不行么？只是有些数据不展示给陪玩端而已」——
 * 以前这里返回的是一串**没有字段名**的纯文本（游戏 / 类型 / 服务 / 任务 / 备注 / 时长 / 单双 /
 * 金额 / 立即打 / 时间 / 已等待 / 距离消失，用灰色 `|` 隔开），同一个数据在订单管理表里有名字
 * （表头），到了抢单池就没名字了。现在直接走 constants/orderFields.ts 的唯一一份标签口径
 * （订单 / 状态 / 游戏 / 服务 / 金额 / 打单 / 来源 / 引流账号 / 客户昵称 / 客户账号ID /
 * 客户联系方式 / 备注 / 主陪 / 副陪 / 发布），陪玩端按 COMPANION_HIDDEN_FIELDS 少几项。
 */
export function buildOrderPoolFields(
  order: any,
  now: number,
  disappearMinutes: number,
  scheduledDisappearMinutes: number,
  opts: { taken?: boolean; isCompanion?: boolean } = {},
): OrderFieldEntry[] {
  const cf = order.customFields || {};
  const entries = buildOrderFieldEntries(order, { isCompanion: opts.isCompanion === true });
  // 预约单：发布订单表单里「预约时间」紧跟在「打单时间」后面，这里也补在「金额 / 打单」后面
  if (cf.urgency === 'later' && cf.scheduledTimeText) {
    const at = entries.findIndex((e) => e.key === 'amount');
    entries.splice(at < 0 ? entries.length : at + 1, 0, {
      key: 'scheduledTime',
      label: orderFieldLabel('scheduledTime'),
      text: cf.scheduledTimeText,
    });
  }
  const wait = now - new Date(order.createdAt).getTime();
  if (opts.taken) {
    // 已经被抢走的单（灰色记录）：不再有「等多久 / 还差多久消失」，改成什么时候被抢的。
    entries.push({
      key: 'takenAt',
      label: orderFieldLabel('takenAt'),
      text: fmtClock(order._takenAt || order.grabbedAt || order.updatedAt || order.createdAt),
    });
    return entries;
  }
  const disappearMins = cf.urgency === 'later' ? scheduledDisappearMinutes : disappearMinutes;
  const disappearIn = disappearMins * 60 * 1000 - wait;
  entries.push({ key: 'waited', label: orderFieldLabel('waited'), text: fmtSpan(wait) });
  entries.push({
    key: 'disappearIn',
    label: orderFieldLabel('disappearIn'),
    text: disappearIn > 0 ? fmtSpan(disappearIn) : '0秒',
  });
  return entries;
}
