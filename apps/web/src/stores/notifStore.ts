import { create } from 'zustand';

/**
 * 通知中心 —— 右上角铃铛里显示的**非聊天**提醒。
 *
 * 老板 2026-09-30：「铃铛那里去除聊天的信息，只保留其他的通知」。
 * 以前点开铃铛就是一份聊天会话列表，和聊天本身重复；现在铃铛只放通知：
 * 新订单 / 订单转让 / 催单 / 搭档邀请 / 账目异常 / 审核结果 ……
 * 聊天消息一律不进这里 —— 私聊未读在左侧消息面板、导航角标上，另外还有提示音 +
 * Windows 系统通知兜底（接单提醒能力一点没少）。
 *
 * 通知按登录用户分别存在 localStorage，换人/换电脑互不串台，最多留最近 100 条。
 */

export type NoticeKind = 'order' | 'invite' | 'finance' | 'audit' | 'system';

export interface NoticeItem {
  id: string;
  kind: NoticeKind;
  icon: string;
  title: string;
  desc?: string;
  /** 点这条通知跳到哪；没给就是纯记录（点不动） */
  href?: string;
  at: number;
  read: boolean;
  /** 去重键：同一件事短时间内重复推只留一条 */
  dedupeKey?: string;
}

export interface PushNoticeInput {
  kind?: NoticeKind;
  icon?: string;
  title: string;
  desc?: string;
  href?: string;
  dedupeKey?: string;
  /** 配合 dedupeKey：这段时间内同键的重复通知直接丢掉（毫秒） */
  dedupeMs?: number;
}

const MAX_ITEMS = 100;
const STORAGE_PREFIX = 'chunlv:notices:';

const KIND_ICON: Record<NoticeKind, string> = {
  order: '🔔',
  invite: '🤝',
  finance: '💰',
  audit: '🛡️',
  system: '📢',
};

const storageKey = (userId: string) => STORAGE_PREFIX + userId;

function readStored(userId: string | null): NoticeItem[] {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .filter((it: any) => it && typeof it.title === 'string' && typeof it.at === 'number')
      .slice(0, MAX_ITEMS)
      .map((it: any) => {
        const kind = (it.kind || 'system') as NoticeKind;
        return {
          id: String(it.id || it.at),
          kind,
          icon: String(it.icon || KIND_ICON[kind] || '📢'),
          title: String(it.title),
          desc: it.desc ? String(it.desc) : undefined,
          href: it.href ? String(it.href) : undefined,
          at: Number(it.at),
          read: !!it.read,
          dedupeKey: it.dedupeKey ? String(it.dedupeKey) : undefined,
        };
      });
  } catch {
    return [];
  }
}

function writeStored(userId: string | null, items: NoticeItem[]) {
  if (!userId) return;
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(items.slice(0, MAX_ITEMS)));
  } catch {
    /* 存不下就算了，内存里那份还在 */
  }
}

interface NotifState {
  userId: string | null;
  items: NoticeItem[];
  /** 登录后调用一次：换用户就把那份通知读出来 */
  hydrate: (userId?: string | null) => void;
  push: (input: PushNoticeInput) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clear: () => void;
}

export const useNotifStore = create<NotifState>((set, get) => ({
  userId: null,
  items: [],

  hydrate: (userId) => {
    if (!userId) {
      set({ userId: null, items: [] });
      return;
    }
    if (get().userId === userId) return;
    set({ userId, items: readStored(userId) });
  },

  push: (input) => {
    if (!input || !input.title) return;
    const { userId, items } = get();
    const dedupeMs = input.dedupeMs || 0;
    if (input.dedupeKey && dedupeMs > 0) {
      const dup = items.find((it) => it.dedupeKey === input.dedupeKey && Date.now() - it.at < dedupeMs);
      if (dup) return;
    }
    const kind = input.kind || 'system';
    const item: NoticeItem = {
      id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8),
      kind,
      icon: input.icon || KIND_ICON[kind],
      title: input.title,
      desc: input.desc,
      href: input.href,
      at: Date.now(),
      read: false,
      dedupeKey: input.dedupeKey,
    };
    const next = [item, ...items].slice(0, MAX_ITEMS);
    set({ items: next });
    writeStored(userId, next);
  },

  markRead: (id) => {
    const { userId, items } = get();
    const next = items.map((it) => (it.id === id ? { ...it, read: true } : it));
    set({ items: next });
    writeStored(userId, next);
  },

  markAllRead: () => {
    const { userId, items } = get();
    const next = items.map((it) => (it.read ? it : { ...it, read: true }));
    set({ items: next });
    writeStored(userId, next);
  },

  clear: () => {
    const { userId } = get();
    set({ items: [] });
    writeStored(userId, []);
  },
}));

/** 铃铛角标 = 未读通知条数（现在不含任何聊天未读） */
export const selectUnreadNotices = (s: NotifState) =>
  s.items.reduce((n, it) => (it.read ? n : n + 1), 0);
