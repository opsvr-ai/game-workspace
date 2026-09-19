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

export function buildOrderInfoFields(
  order: any,
  now: number,
  disappearMinutes: number,
  scheduledDisappearMinutes: number,
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
    `已等待 ${fmtSpan(wait)}`,
    `距离消失 ${disappearText}`,
  ];
}
