/**
 * 左侧菜单的 9 组角标 + 「通知 → 菜单角标」数据（从 layouts/AppLayout.tsx 原样搬出）。
 *
 * 搬运原则：**行为等价**，一个数字、一个间隔、一个可见性判断都不改。
 * 这里只收「state + 拉取 + 轮询 + 事件触发刷新 + 点过就消的记账」，
 * 菜单树怎么挂角标（JSX / 跳转）仍然留在 AppLayout。
 *
 * 角标清单（老板陆续提的 9 组）：
 *   待处理 / 待办 / 桥接 / 报账 / 工作微信 / 工作抽查审核 / 联系 / 待开始 / 结果复核。
 *
 * 依赖的「外壳其它逻辑」通过参数传进来：
 *   - user（角色 + id）：决定哪些角标要拉、localStorage 的 seen 键；
 *   - 其余（路由跳转、菜单结构）不在这里 —— 本文件不 import AppLayout，避免循环依赖。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { UserInfo } from '@chunlv/shared';
import http from '../api/client';
import { message } from '../utils/feedback';
import { useNotifStore, noticePath, type NoticeItem } from '../stores/notifStore';

/** 「刚点掉的提醒」在页面顶头再写一遍的保留时长（老板 2026-10-05） */
export const CLEARED_TTL_MS = 10 * 60 * 1000;

export interface ClearedNoticeEntry {
  titles: string[];
  at: number;
}

export type ClearedNotices = Record<string, ClearedNoticeEntry>;

/** 读本地记下的「这个角标已经看到第几条了」，读不到就当 0 */
function loadSeenCount(key: string): number {
  try {
    const v = parseInt(localStorage.getItem(key) || '0', 10);
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

export interface MenuBadges {
  /** 待处理：注册 / 实名审核等「等管理端点一下」的条数（点过就消） */
  pendingBadge: number;
  /** 待处理总数：真实待办条数（不是未读，活儿没干完数字就一直在） */
  todosBadge: number;
  todosHint: string;
  /** 桥接待处理（仅店长 ADMIN） */
  bridgePendingBadge: number;
  /** 报账审核 + 支出审批 + 支取审批 */
  billingBadge: number;
  /** 陪玩提交的工作微信待审数 */
  workWechatBadge: number;
  /** 工作抽查异常（挂「陪玩列表 / 人员管理」） */
  reviewBadge: number;
  /** 联系状态待处理 */
  contactBadge: number;
  /** 陪玩：已抢单 / 已确认但还没点首单的订单数 */
  pendingStartBadge: number;
  /** 成交核对：待店长拍板的失败单 */
  outcomeReviewBadge: number;

  /** socket 收到工作抽查异常时直接把红点 +1（AppLayout 的实时回调里用） */
  setReviewBadge: Dispatch<SetStateAction<number>>;

  // 「点过就消」的记账（点菜单时调）
  markSeen: () => void;
  markBridgeSeen: () => void;
  markBillingSeen: () => void;
  markReviewSeen: () => void;
  markContactSeen: () => void;
  markPendingStartSeen: () => void;

  // ── 通知中心 → 菜单角标 / 页面顶头横幅 ──
  /** 全部通知（未读 + 已读），横幅要按标题找「工作抽查异常」那几条 */
  notifItems: NoticeItem[];
  /** 归一化路径 → 未读通知条数（菜单红点） */
  unreadByPath: Record<string, number>;
  /** 归一化路径 → 未读通知标题（悬停提示 + 顶头横幅） */
  titlesByPath: Record<string, string[]>;
  /** 刚从左侧栏点掉、还在 10 分钟内的提醒（顶头橙色横幅） */
  clearedNotices: ClearedNotices;
  /** 点某个菜单 key：把指向这个页面的未读通知全标已读（并记下刚清掉的是哪几条） */
  clearNoticesByKey: (key: string) => void;
  rememberCleared: (path: string, titles: string[]) => void;
  forgetCleared: (path: string) => void;
  markNoticesReadByPath: (path: string) => void;
  markNoticeRead: (id: string) => void;
  /** 「工作抽查异常 · 某人」→ 落到那个人的工作记录页 */
  workAlertHref: (name: string) => string;
}

/**
 * 9 组菜单角标 + 通知角标数据。
 * 必须无条件调用（hooks 规则）；角色不符时各 effect 内部自己直接 return（和原来一致）。
 */
export function useMenuBadges(user: UserInfo | null | undefined): MenuBadges {
  const role = user?.role;
  const userId = user?.id;
  const seenSuffix = userId || 'anon';

  // Badge: raw count from API, with seen-tracking via ref (not state)
  const [pendingBadge, setPendingBadge] = useState(0);
  const seenRef = useRef(0);

  useEffect(() => {
    if (role !== 'OWNER' && role !== 'ADMIN') return;
    const seenKey = `pending-seen-${seenSuffix}`;
    seenRef.current = loadSeenCount(seenKey);
    const doFetch = async () => {
      try {
        const { data } = await http.get('/users/pending-review');
        const total = (data.data || []).length;
        if (seenRef.current > total) {
          seenRef.current = total;
          localStorage.setItem(seenKey, String(total));
        }
        setPendingBadge(Math.max(0, total - seenRef.current));
      } catch {}
    };
    doFetch();
    const t = setInterval(() => { if (document.visibilityState === 'visible') doFetch(); }, 120000);
    return () => clearInterval(t);
  }, [role, userId]);

  // 待处理总数（老板 2026-10-06）：店长 / 老板 / 客服上班先看这个数。
  // 跟别的角标不一样 —— 这个是**真实待办条数**，不是「点过就消」的未读：活儿没干完数字就一直在。
  const [todosBadge, setTodosBadge] = useState(0);
  const [todosHint, setTodosHint] = useState('');
  useEffect(() => {
    if (role !== 'OWNER' && role !== 'ADMIN' && role !== 'CS') return;
    let alive = true;
    const doFetch = async () => {
      try {
        const { data } = await http.get('/todos');
        if (!alive) return;
        const d = data?.data || {};
        setTodosBadge(Number(d.total) || 0);
        setTodosHint(
          (Array.isArray(d.groups) ? d.groups : [])
            .slice(0, 4)
            .map((g: any) => `${g.label}：${g.count} 条`)
            .join('\n'),
        );
      } catch {}
    };
    doFetch();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') doFetch();
    }, 120000);
    return () => { alive = false; clearInterval(t); };
  }, [role, userId]);

  // Bridge pending badge for ADMIN (same pattern as pendingBadge above)
  const [bridgePendingBadge, setBridgePendingBadge] = useState(0);
  const bridgeSeenRef = useRef(0);

  useEffect(() => {
    if (role !== 'ADMIN') return;
    const seenKey = `bridge-pending-seen-${seenSuffix}`;
    bridgeSeenRef.current = loadSeenCount(seenKey);
    const doFetch = async () => {
      try {
        const { data } = await http.get('/bridges');
        const pending = data.data?.pending || [];
        const total = pending.length;
        if (bridgeSeenRef.current > total) {
          bridgeSeenRef.current = total;
          localStorage.setItem(seenKey, String(total));
        }
        setBridgePendingBadge(Math.max(0, total - bridgeSeenRef.current));
      } catch {}
    };
    doFetch();
    const t = setInterval(() => { if (document.visibilityState === 'visible') doFetch(); }, 120000);
    return () => clearInterval(t);
  }, [role, userId]);

  // Billing pending badge (报账审核 + 支出审批 + 支取审批)
  const [billingBadge, setBillingBadge] = useState(0);
  const billingSeenRef = useRef(0);

  useEffect(() => {
    if (role !== 'OWNER' && role !== 'ADMIN' && role !== 'CS') return;
    const seenKey = `billing-pending-seen-${seenSuffix}`;
    billingSeenRef.current = loadSeenCount(seenKey);
    const doFetch = async () => {
      try {
        const { data } = await http.get('/billing/pending-count');
        const total = data.data?.total || 0;
        if (billingSeenRef.current > total) {
          billingSeenRef.current = total;
          localStorage.setItem(seenKey, String(total));
        }
        setBillingBadge(Math.max(0, total - billingSeenRef.current));
      } catch {}
    };
    doFetch();
    const t = setInterval(() => { if (document.visibilityState === 'visible') doFetch(); }, 120000);
    return () => clearInterval(t);
  }, [role, userId]);

  // 工作微信待审 badge（老板 2026-10-17）：
  // 以前只靠 socket 那一条实时通知挂左侧角标；客户端刚好在重连 / 刷新 / 没在线时，
  // 这条消息就永久丢了（页面自己 30 秒轮询又不会点亮菜单），hanlei2 的徐瑜申请就是这样。
  // 这里直接问服务端「现在还有几条待审」，实时事件只负责让数字立刻刷新。
  const [workWechatBadge, setWorkWechatBadge] = useState(0);
  useEffect(() => {
    if (role !== 'OWNER' && role !== 'ADMIN' && role !== 'CS') return;
    let alive = true;
    const doFetch = async () => {
      try {
        const { data } = await http.get('/companions/work-wechat-requests/pending-count');
        if (!alive) return;
        setWorkWechatBadge(Number(data?.data?.count) || 0);
      } catch {}
    };
    doFetch();
    // 和页面自己的轮询对齐：30 秒内一定能亮，不依赖那一条 socket 消息。
    const t = setInterval(() => { if (document.visibilityState === 'visible') doFetch(); }, 30000);
    const onRefresh = () => { void doFetch(); };
    window.addEventListener('chunlv:work-wechat-refresh', onRefresh);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener('chunlv:work-wechat-refresh', onRefresh);
    };
  }, [role, userId]);

  // 工作抽查 badge（ADMIN/OWNER）
  const [reviewBadge, setReviewBadge] = useState(0);
  const reviewSeenRef = useRef(0);
  useEffect(() => {
    if (role !== 'OWNER' && role !== 'ADMIN') return;
    const doFetch = async () => {
      try {
        const { data } = await http.get('/admin/review-queue-count');
        const count = data.data?.count || 0;
        if (reviewSeenRef.current > count) {
          reviewSeenRef.current = count;
        }
        setReviewBadge(Math.max(0, count - reviewSeenRef.current));
      } catch {}
    };
    doFetch();
    const t = setInterval(() => { if (document.visibilityState === 'visible') doFetch(); }, 120000);
    return () => clearInterval(t);
  }, [role]);

  const markReviewSeen = () => {
    setReviewBadge((prev) => {
      const total = prev + reviewSeenRef.current;
      reviewSeenRef.current = total;
      return 0;
    });
  };

  const markBillingSeen = () => {
    const seenKey = `billing-pending-seen-${seenSuffix}`;
    setBillingBadge((prev) => {
      const total = prev + billingSeenRef.current;
      billingSeenRef.current = total;
      localStorage.setItem(seenKey, String(total));
      return 0;
    });
  };

  const markBridgeSeen = () => {
    const seenKey = `bridge-pending-seen-${seenSuffix}`;
    setBridgePendingBadge((prev) => {
      const total = prev + bridgeSeenRef.current;
      bridgeSeenRef.current = total;
      localStorage.setItem(seenKey, String(total));
      return 0;
    });
  };

  const markSeen = () => {
    // Read current total from state to set seen
    const seenKey = `pending-seen-${seenSuffix}`;
    setPendingBadge((prev) => {
      const total = prev + seenRef.current; // reconstruct: badge + seen = total
      seenRef.current = total;
      localStorage.setItem(seenKey, String(total));
      return 0;
    });
  };

  // Contact pending badge (联系状态待处理 — for CS/ADMIN/OWNER)
  const [contactBadge, setContactBadge] = useState(0);
  const contactSeenRef = useRef(0);

  useEffect(() => {
    if (role !== 'OWNER' && role !== 'ADMIN' && role !== 'CS') return;
    const seenKey = `contact-pending-seen-${seenSuffix}`;
    contactSeenRef.current = loadSeenCount(seenKey);
    const doFetch = async () => {
      try {
        const { data } = await http.get('/orders/pending-contact-count');
        const total = data?.data || 0;
        if (contactSeenRef.current > total) {
          contactSeenRef.current = total;
          localStorage.setItem(seenKey, String(total));
        }
        setContactBadge(Math.max(0, total - contactSeenRef.current));
      } catch {}
    };
    doFetch();
    const t = setInterval(() => { if (document.visibilityState === 'visible') doFetch(); }, 120000);
    return () => clearInterval(t);
  }, [role, userId]);

  const markContactSeen = () => {
    const seenKey = `contact-pending-seen-${seenSuffix}`;
    setContactBadge((prev) => {
      const total = prev + contactSeenRef.current;
      contactSeenRef.current = total;
      localStorage.setItem(seenKey, String(total));
      return 0;
    });
  };

  // 陪玩待开始订单角标：已抢单/已确认但还没点首单的订单数（订单管理菜单红点）
  const [pendingStartBadge, setPendingStartBadge] = useState(0);
  const pendingStartSeenRef = useRef(0);

  useEffect(() => {
    if (role !== 'COMPANION') return;
    const seenKey = `pending-start-seen-${seenSuffix}`;
    pendingStartSeenRef.current = loadSeenCount(seenKey);
    const doFetch = async () => {
      try {
        const { data } = await http.get('/orders/pending-start');
        const total = (data?.data || []).length;
        if (pendingStartSeenRef.current > total) {
          pendingStartSeenRef.current = total;
          localStorage.setItem(seenKey, String(total));
        }
        setPendingStartBadge(Math.max(0, total - pendingStartSeenRef.current));
      } catch {}
    };
    doFetch();
    const t = setInterval(() => { if (document.visibilityState === 'visible') doFetch(); }, 60000);
    return () => clearInterval(t);
  }, [role, userId]);

  const markPendingStartSeen = () => {
    const seenKey = `pending-start-seen-${seenSuffix}`;
    setPendingStartBadge((prev) => {
      const total = prev + pendingStartSeenRef.current;
      pendingStartSeenRef.current = total;
      localStorage.setItem(seenKey, String(total));
      return 0;
    });
  };

  /**
   * 「成交核对」角标（老板 2026-10-06）：「最好每天要求管理端去核对」——
   * 客服 / 店长 / 老板的「订单管理 → 成交核对」上挂一个红数字，就是**待店长拍板的失败单**有几张。
   * 这不是「看过就消」的通知角标，而是真有一张没拍板就一直在（拍完自动消失）。
   */
  const [outcomeReviewBadge, setOutcomeReviewBadge] = useState(0);
  useEffect(() => {
    if (!user || !['OWNER', 'ADMIN', 'CS'].includes(role || '')) return;
    const doFetch = async () => {
      try {
        const { data } = await http.get('/orders/reviews/summary');
        setOutcomeReviewBadge(Number(data?.data?.waiting || 0));
      } catch {
        /* 拿不到就当作没有，别把菜单弄崩 */
      }
    };
    doFetch();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') doFetch();
    }, 60000);
    return () => clearInterval(t);
  }, [role, userId]);

  // ── 通知中心 → 菜单角标 ──
  useEffect(() => {
    useNotifStore.getState().hydrate(userId || null);
  }, [userId]);
  // 老板 2026-10-04：提醒除了「右下角弹窗 + 右上角铃铛」，左侧栏对应菜单也要挂角标。
  // 每条通知都指着一个页面（href），按归一化路径分堆，菜单项就按自己的路由领角标。
  const notifItems = useNotifStore((s) => s.items);
  const markNoticesReadByPath = useNotifStore((s) => s.markReadByPath);
  const { unreadByPath, titlesByPath } = useMemo(() => {
    const map: Record<string, number> = {};
    const titles: Record<string, string[]> = {};
    for (const it of notifItems) {
      if (it.read) continue;
      const path = noticePath(it.href);
      if (!path) continue;
      map[path] = (map[path] || 0) + 1;
      (titles[path] || (titles[path] = [])).push(it.title);
    }
    return { unreadByPath: map, titlesByPath: titles };
  }, [notifItems]);
  // 老板 2026-10-05：「工作抽查异常」的通知点进「陪玩管理」什么都没有。
  // 根因：这类通知早先的跳转地址指向泛泛的审核页（老板账号是 /owner/review），
  // 左侧栏角标和页面横幅自然都挂在那张页面上，人却按提示去「陪玩管理」找。
  // 这里按标题里的名字，把这一类老通知的 href 校正到「陪玩管理 → 这个人的工作记录」。
  const patchNotice = useNotifStore((s) => s.patch);
  const markNoticeRead = useNotifStore((s) => s.markRead);
  const workAlertBase = role === 'CS' ? '/cs/employees' : '/admin/companions';
  const workAlertHref = (name: string) =>
    `${workAlertBase}?role=COMPANION&workName=${encodeURIComponent(name)}`;
  useEffect(() => {
    for (const it of notifItems) {
      const title = String(it.title || '');
      if (!title.startsWith('工作抽查异常 · ')) continue;
      if (it.href && (it.href.includes('workName') || it.href.includes('workCompanion'))) continue;
      const name = title.slice('工作抽查异常 · '.length).trim();
      if (!name) continue;
      patchNotice(it.id, { href: workAlertHref(name) });
    }
    // 校正过一条 href 就带 workName 了，下一轮不会再匹配 —— 不会打转。
  }, [notifItems, patchNotice, workAlertBase]);
  // 老板 2026-10-05：「订单管理有未读，我点进去也没看到什么变化」——
  // 点菜单只把角标数字清掉、页面里什么都不留，人根本不知道刚才那几条提醒是什么。
  // 所以「刚点掉的是哪几条」按页面路径记在这，进到那一页顶头再写一遍（见内容区横幅）。
  const [clearedNotices, setClearedNotices] = useState<ClearedNotices>({});
  const rememberCleared = useCallback((path: string, titles: string[]) => {
    if (!path || !titles.length) return;
    setClearedNotices((prev) => {
      const old = prev[path];
      const fresh = old && Date.now() - old.at < CLEARED_TTL_MS ? old.titles : [];
      // 合并去重：点菜单时通知角标和「待开始订单」角标可能一起被清掉，两条提示都要留着。
      const merged = Array.from(new Set([...fresh, ...titles]));
      return { ...prev, [path]: { titles: merged, at: Date.now() } };
    });
  }, []);
  const forgetCleared = useCallback((path: string) => {
    setClearedNotices((prev) => {
      if (!prev[path]) return prev;
      const next = { ...prev };
      delete next[path];
      return next;
    });
  }, []);

  // 点左侧栏那一项 = 把指向这个页面的未读通知都消掉（跟点铃铛条目、点弹窗一个效果）。
  const clearNoticesByKey = useCallback(
    (key: string) => {
      const path = noticePath(key);
      if (!path) return;
      // 老板 2026-10-05：「点进去发现没任何变化」——角标一点就消、又不说是什么，人会懵。
      // 一边把刚标为已读的是哪几条记下来（页面顶头横幅再写一遍，不会被一闪而过的提示漏看），
      // 一边用一条轻提示念出来兜底。
      const titles = titlesByPath[path] || [];
      if (titles.length) {
        rememberCleared(path, titles);
        message.info(
          `这里刚才有 ${titles.length} 条提醒（已标已读）：${titles.slice(0, 2).join(' · ')}${
            titles.length > 2 ? ` 等 ${titles.length} 条` : ''
          }`,
          6,
        );
      }
      markNoticesReadByPath(path);
    },
    [markNoticesReadByPath, titlesByPath, rememberCleared],
  );

  return {
    pendingBadge,
    todosBadge,
    todosHint,
    bridgePendingBadge,
    billingBadge,
    workWechatBadge,
    reviewBadge,
    setReviewBadge,
    contactBadge,
    pendingStartBadge,
    outcomeReviewBadge,
    markSeen,
    markBridgeSeen,
    markBillingSeen,
    markReviewSeen,
    markContactSeen,
    markPendingStartSeen,
    notifItems,
    unreadByPath,
    titlesByPath,
    clearedNotices,
    clearNoticesByKey,
    rememberCleared,
    forgetCleared,
    markNoticesReadByPath,
    markNoticeRead,
    workAlertHref,
  };
}
