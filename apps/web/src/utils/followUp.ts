/**
 * 「管理端直添客户流转明细」（原「客服跟进台账」，2026-09-30 并进那一页）和「到点提醒」
 * 共用的口径（老板 2026-09-29）。
 *
 * 规则只有一条：客户**最近一条**跟进记录里写的「下次跟进时间」已经过了 = 该跟进了。
 * 台账那一页的红字置顶、首页那条红提示，都用这里的判断，不各写一套。
 */

export interface FollowUpLike {
  content?: string | null;
  createdAt?: string | null;
  /** 下次跟进时间（记跟进时自己选的） */
  nextFollowUpAt?: string | null;
  /** 这次是用哪个客服工作微信跟的 */
  workWechatName?: string | null;
}

/** 那一行里「客户最近一条跟进记录」（接口已经按时间倒序只带了一条） */
export const lastFollowUpOf = (row: any): FollowUpLike | null =>
  ((row?.customer || {}).followUps || [])[0] || null;

/** 到点了没有：返回「下次跟进时间」的毫秒数；没写、写错、还没到 → null */
export const dueFollowUpAtOf = (row: any, now: number = Date.now()): number | null => {
  const raw = lastFollowUpOf(row)?.nextFollowUpAt;
  if (!raw) return null;
  const at = new Date(raw).getTime();
  if (Number.isNaN(at) || at > now) return null;
  return at;
};

/** 列表 / 提示里的时间：月-日 时:分（当年的年份不显示，省宽度） */
export const mmddhhmm = (value?: string | null): string => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** 一行怎么称呼这位客户（昵称优先，其次微信 / 编号） */
export const customerLabelOf = (row: any): string => {
  const cf = row?.customFields || {};
  const c = row?.customer || {};
  return cf.customerNickname || c.wechatId || (c.customerCode ? `#${c.customerCode}` : '') || '这位客户';
};
