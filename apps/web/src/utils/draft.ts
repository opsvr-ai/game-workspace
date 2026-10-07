/**
 * 「没提交的内容」本地存档（老板 2026-10-08）。
 *
 * 用途：**哪怕页面还是被刷掉了，正在写的东西也捡得回来**。
 *   ① 发布订单表单（CreateOrderModal）—— 窗口一刷，重开「发布订单」内容自动回填；
 *   ② 聊天输入框（ChatComposer）—— 每个会话各存各的，刷新后回来还能看见没发出去的那句话。
 *
 * 约定：
 *   * 键里带用户 id（谁的就是谁的，换个人登录不会互相串）；
 *   * 最多留 3 天，过期自动清掉；
 *   * 存不下（有函数 / File / 循环引用）就整体不存 —— 宁可不存，也不要存成坏数据把页面读崩；
 *   * 空内容（''、{}、[]）等于删除。
 */
import { useEffect } from 'react';
import { clearBusy, setBusy } from './busyGuard';

const PREFIX = 'chunlv:draft:';

/** 草稿最多留多久。 */
export const DRAFT_TTL_MS = 3 * 24 * 60 * 60 * 1000;

interface StoredDraft {
  at: number;
  v: unknown;
}

export function draftStorageKey(key: string): string {
  return PREFIX + key;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 序列化；存不下的返回 null。 */
function toJson(value: unknown): string | null {
  try {
    const json = JSON.stringify(value);
    if (json === undefined) return null;
    return json;
  } catch {
    return null;
  }
}

function hasContent(json: string | null): boolean {
  return !!json && json !== 'null' && json !== '""' && json !== '{}' && json !== '[]';
}

/** 存一份草稿。返回是否真的存下来了（空内容 = 删除）。 */
export function saveDraft(key: string | null | undefined, value: unknown, now = Date.now()): boolean {
  const ls = storage();
  if (!ls || !key) return false;
  const json = toJson(value);
  if (!hasContent(json)) {
    ls.removeItem(draftStorageKey(key));
    return false;
  }
  try {
    ls.setItem(draftStorageKey(key), JSON.stringify({ at: now, v: JSON.parse(json as string) } as StoredDraft));
    return true;
  } catch {
    return false;
  }
}

/** 取一份草稿；过期 / 坏了都返回 null（并顺手清掉）。 */
export function loadDraft<T = unknown>(key: string | null | undefined, now = Date.now()): T | null {
  const ls = storage();
  if (!ls || !key) return null;
  const raw = ls.getItem(draftStorageKey(key));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredDraft;
    if (!parsed || typeof parsed.at !== 'number') {
      ls.removeItem(draftStorageKey(key));
      return null;
    }
    if (now - parsed.at > DRAFT_TTL_MS) {
      ls.removeItem(draftStorageKey(key));
      return null;
    }
    return (parsed.v ?? null) as T;
  } catch {
    ls.removeItem(draftStorageKey(key));
    return null;
  }
}

export function clearDraft(key: string | null | undefined): void {
  const ls = storage();
  if (!ls || !key) return;
  ls.removeItem(draftStorageKey(key));
}

/** 有没有存着的草稿（会连带做过期判断）。 */
export function hasDraft(key: string | null | undefined, now = Date.now()): boolean {
  return loadDraft(key, now) != null;
}

/**
 * 一边存草稿、一边登记「我正在写」：
 *   * 内容变了 → 停手 400ms 后写一次 localStorage（打字时不反复写盘）；
 *   * 同时把这些内容登记到 busyGuard —— 有人在写的时候，自动刷新会被拦下（见 busyGuard.ts）。
 */
export function useDraftSaver(
  key: string | null | undefined,
  value: unknown,
  opts: { busy?: boolean; enabled?: boolean; debounceMs?: number } = {},
): void {
  const json = toJson(value);
  const busyId = key ? draftStorageKey(key) : '';

  useEffect(() => {
    if (!key || opts.enabled === false) return undefined;
    const timer = setTimeout(() => {
      if (hasContent(json)) saveDraft(key, value);
      else clearDraft(key);
    }, opts.debounceMs ?? 400);
    return () => clearTimeout(timer);
    // value 每次渲染都是新对象，所以用序列化后的 json 当依赖（内容没变就不重存）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, json, opts.enabled]);

  useEffect(() => {
    if (!busyId) return undefined;
    setBusy(busyId, opts.busy !== false && hasContent(json));
    return () => clearBusy(busyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busyId, json, opts.busy]);
}
