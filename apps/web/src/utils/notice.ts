import { notification } from 'antd';
import { useNotifStore, type PushNoticeInput } from '../stores/notifStore';

export interface NotifyNoticeInput extends PushNoticeInput {
  /** 角标提示样式；给 'none' 就只记进通知中心（原来已经有别处提醒时用这个，行为不变） */
  toast?: 'info' | 'success' | 'warning' | 'error' | 'none';
  duration?: number;
}

/**
 * 记一条通知 + 弹右下角提示。
 * 老板 2026-09-30：铃铛只留非聊天通知，所以生产通知的地方统一走这里 ——
 * 弹窗还是原来的弹窗，同时铃铛里留一份（弹窗关了也能回头翻）。
 */
export function notifyNotice(input: NotifyNoticeInput) {
  useNotifStore.getState().push(input);
  const toast = input.toast || 'info';
  if (toast === 'none') return;
  const cfg = {
    message: input.title,
    description: input.desc,
    placement: 'bottomRight' as const,
    duration: input.duration || 6,
  };
  if (toast === 'success') notification.success(cfg);
  else if (toast === 'warning') notification.warning(cfg);
  else if (toast === 'error') notification.error(cfg);
  else notification.info(cfg);
}

/** 只记进通知中心，不另外弹提示（原来已经有 message / Windows 通知的地方用这个） */
export function recordNotice(input: PushNoticeInput) {
  useNotifStore.getState().push(input);
}
