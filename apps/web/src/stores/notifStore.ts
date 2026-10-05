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

/**
 * 通知 href → 归一化路径（去掉 ?query / #hash，末尾斜杠也去掉）。
 *
 * 左侧栏要靠它把「通知」和「菜单」对上：通知 href 和菜单 key 用的是同一套路由，
 * 但有的带 query（如 /admin/companions?role=COMPANION），所以比对前先归一化。
 * 老板 2026-10-04：弹窗 + 右上角铃铛 + 左侧栏对应位置三处都要提醒，点任意一处都消。
 */
/** 归一化后要**保留**的 query 参数：只有它们能区分「同一个路径下的不同菜单」。 */
const KEEP_QUERY_KEYS = ['type', 'role'];

export function noticePath(href?: string | null): string {
  if (!href) return '';
  const s = String(href).trim();
  if (!s) return '';
  const hashAt = s.indexOf('#');
  const noHash = hashAt >= 0 ? s.slice(0, hashAt) : s;
  const qAt = noHash.indexOf('?');
  let path = qAt >= 0 ? noHash.slice(0, qAt) : noHash;
  if (path.length > 1) path = path.replace(/\/+$/, '');
  // 老板 2026-10-05：「客服管理有未读，点进去发现没任何变化」——
  // 根因：`/owner/work-wechats` 这一个路径下挂着两个菜单（陪玩工作微信 type=COMPANION /
  // 客服工作微信 type=STUDIO），只留路径会让两条通知串台：陪玩提交的微信号把「客服工作微信」
  // 连同父级「客服管理」也点亮了，点进去那条待审核行按 type 被过滤掉，自然什么都看不到。
  // 所以带上语义参数（只留 type / role 白名单，其余照旧丢掉），两边各归各的角标。
  let kept = '';
  if (qAt >= 0) {
    const params = new URLSearchParams(noHash.slice(qAt + 1));
    const parts: string[] = [];
    for (const key of KEEP_QUERY_KEYS) {
      const v = params.get(key);
      if (v) parts.push(`${key}=${v}`);
    }
    if (parts.length) kept = '?' + parts.join('&');
  }
  return path + kept;
}

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
  push: (input: PushNoticeInput) => string | undefined;
  markRead: (id: string) => void;
  /** 把「指向这个页面」的未读通知全部标为已读（左侧栏点对应菜单时用） */
  markReadByPath: (path: string) => void;
  /** 就地改一条通知的字段（把老通知的跳转地址校正到正确页面时用） */
  patch: (id: string, partial: Partial<Pick<NoticeItem, 'href' | 'title' | 'desc'>>) => void;
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
    if (!input || !input.title) return undefined;
    const { userId, items } = get();
    const dedupeMs = input.dedupeMs || 0;
    if (input.dedupeKey && dedupeMs > 0) {
      const dup = items.find((it) => it.dedupeKey === input.dedupeKey && Date.now() - it.at < dedupeMs);
      // 去重命中：不重复入列，但把已有那条的 id 交回去 —— 弹窗点一下还是要能把它标已读。
      if (dup) return dup.id;
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
    return item.id;
  },

  markRead: (id) => {
    const { userId, items } = get();
    const next = items.map((it) => (it.id === id ? { ...it, read: true } : it));
    set({ items: next });
    writeStored(userId, next);
  },

  markReadByPath: (path) => {
    const target = noticePath(path);
    if (!target) return;
    const { userId, items } = get();
    const next = items.map((it) =>
      !it.read && noticePath(it.href) === target ? { ...it, read: true } : it,
    );
    set({ items: next });
    writeStored(userId, next);
  },

  patch: (id, partial) => {
    const { userId, items } = get();
    let hit = false;
    const next = items.map((it) => {
      if (it.id !== id) return it;
      hit = true;
      return { ...it, ...partial };
    });
    if (!hit) return;
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
