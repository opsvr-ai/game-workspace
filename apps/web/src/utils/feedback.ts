import { message as antdMessage } from 'antd';

/**
 * 统一提示出口（重构方案 P2-8「反馈层无统一出口」）。
 *
 * 为什么要有它：全站 600 多处提示以前都是 import { message } from 'antd' 直接调 ——
 * 谁都能弹、弹完就走，于是三件事没法统一：
 *   ① 同一句话连着弹：双击保存 / 接口重试 / socket 重连 / 一个页面里两处 catch 撞一起，
 *      用户看到两条一模一样的红条；
 *   ② 想改提示的位置 / 时长 / 要不要进通知中心，得全局搜 600 处；
 *   ③ 想统计「到底弹了多少条」也没地方下手。
 *
 * 现在所有提示都从这里出去（守卫 scripts/_check_feedback_layer.mjs：谁再从 'antd' 直接
 * import message，CI 直接红）。调用点一个字不用改，只把 import 换成本文件即可：
 *   import { message } from '<相对路径>/utils/feedback';
 *
 * 相比原地调 antd，唯一的区别是：同一级别 + 同一句话，在 FEEDBACK_DEDUP_MS 内只弹一次。
 * 认不出文案（传的是 ReactNode）或文案是空的，就不去重 —— 宁可多弹，也别把该看到的吞掉。
 *
 * 以后要加「合并 / 优先级 / 轮询静音 / 失败进通知中心」，都只改这一个文件。
 */

/** 同一句话在这个窗口内只弹一次（毫秒）。 */
export const FEEDBACK_DEDUP_MS = 2500;

/** 上次弹出的时间：key = 级别::文案。 */
const lastShownAt = new Map<string, number>();

type Kind = 'success' | 'error' | 'warning' | 'info';
type Args = Parameters<typeof antdMessage.error>;

/** 从 antd 的两种写法里取出「这句话是什么」：message.error('x') 或 message.error({ content: 'x' })。 */
function textOf(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (typeof arg === 'number') return String(arg);
  if (arg && typeof arg === 'object' && 'content' in (arg as Record<string, unknown>)) {
    const c = (arg as { content?: unknown }).content;
    if (typeof c === 'string') return c;
    if (typeof c === 'number') return String(c);
  }
  return '';
}

function isDuplicate(kind: Kind, arg: unknown): boolean {
  const text = textOf(arg);
  if (!text) return false;
  const key = kind + '::' + text;
  const now = Date.now();
  const prev = lastShownAt.get(key);
  if (prev !== undefined && now - prev < FEEDBACK_DEDUP_MS) return true;
  lastShownAt.set(key, now);
  return false;
}

function emit(kind: Kind, args: Args) {
  if (isDuplicate(kind, args[0])) return;
  switch (kind) {
    case 'success':
      return antdMessage.success(...args);
    case 'error':
      return antdMessage.error(...args);
    case 'warning':
      return antdMessage.warning(...args);
    case 'info':
      return antdMessage.info(...args);
  }
}

/** 清掉去重记忆（测试用；也可在「用户主动刷新」后调用）。 */
export function resetFeedbackDedup() {
  lastShownAt.clear();
}

/**
 * 和 antd 的 message 同名同形状 —— 调用点不用改。
 * 需要「每次都弹、绝不去重」时用 message.raw（极少，先想清楚再来拿）。
 */
export const message = {
  success: (...args: Args) => emit('success', args),
  error: (...args: Args) => emit('error', args),
  warning: (...args: Args) => emit('warning', args),
  info: (...args: Args) => emit('info', args),
  raw: antdMessage,
};

export default message;
