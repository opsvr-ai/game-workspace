/**
 * 左侧导航菜单的构建 —— 从 layouts/AppLayout.tsx 原样搬出，行为零变化。
 *
 * 收拢：
 *   - roleMenus 里本角色的菜单树；
 *   - 9 组角标的 decoration（表驱动 BADGE_RULES，按 label 递归挂红点 / 黄点）；
 *   - decorateMenu（模块图标色 + 业绩比例小字）、单子菜单平铺、通知未读角标（父级子树汇总）；
 *   - 「待处理」真实待办条数、标题包成可点（点一级直接进它第一个页面）；
 *   - onMenuClick：点菜单文字才跳转，顺手清对应页面角标 / 记「刚清掉什么」。
 *
 * 菜单数据本身仍来自 config/roleMenus，key / 文案 / 图标 / 跳转目标都不变。
 */
import { useMemo } from 'react';
import { Badge } from 'antd';
import type { MenuProps } from 'antd';
import type { NavigateFunction } from 'react-router-dom';
import type { UserInfo } from '@chunlv/shared';
import {
  roleMenus,
  menuBadgeLabel,
  decorateMenu,
  makeTitlesClickable,
  rolePage,
} from '../config/roleMenus';
import { noticePath } from '../stores/notifStore';
import { SEMANTIC, badgeGlow } from '../styles/tokens';
import type { MenuBadges } from './useMenuBadges';

interface Deps {
  user: UserInfo | null;
  navigate: NavigateFunction;
  directUnread: number;
  shareRatios: Record<string, number | null>;
  /** useMenuBadges 的完整返回值（角标值 / mark*Seen / 通知按路径分堆数据） */
  badges: MenuBadges;
}

export function useShellMenu({ user, navigate, directUnread, shareRatios, badges }: Deps) {
  const {
    pendingBadge,
    todosBadge,
    todosHint,
    bridgePendingBadge,
    billingBadge,
    workWechatBadge,
    reviewBadge,
    contactBadge,
    pendingStartBadge,
    outcomeReviewBadge,
    markSeen,
    markBridgeSeen,
    markBillingSeen,
    markReviewSeen,
    markContactSeen,
    markPendingStartSeen,
    unreadByPath,
    titlesByPath,
    clearNoticesByKey,
    rememberCleared,
  } = badges;

  const menuItems = useMemo(() => {
    if (!user) return [];
    const items = [...(roleMenus[user.role] || [])];
    const pCount = pendingBadge;
    const bpCount = bridgePendingBadge;
    const bCount = billingBadge;
    const cCount = contactBadge;
    const psCount = pendingStartBadge;
    const rvCount = reviewBadge;
    const orCount = outcomeReviewBadge;
    const REVIEW_LABELS = ['工作室管理', '实名审核', '陪玩实名审核'];
    // 老板 2026-10-10：左侧菜单改成按「人」分（陪玩管理 / 客服管理），原来挂在「员工管理」
    // 上的未读聊天角标跟着挪过去，两个子菜单各挂一份（同一个未读总数）。
    const CHAT_LABELS = ['工作台', '陪玩管理', '客服管理', '首页'];
    const CONTACT_LABELS = ['派单工作台'];
    const PENDING_START_LABELS = ['订单', '订单管理'];
    const OUTCOME_REVIEW_LABELS = ['成交核对'];
    // 工作抽查异常挂在「陪玩列表 / 人员管理」上（以前挂在折叠的「陪玩管理」上，点不动）。
    const REVIEW_WORK_LABELS = ['陪玩列表', '人员管理'];
    // 「陪玩工作微信」这条路由（带 type，避免和客服工作微信串台）：
    // 服务端待审数也挂到这条菜单上，漏掉 socket 消息也不会漏提示。
    const workWechatPath = noticePath(rolePage(user.role, 'work-wechats'));
    // ── 菜单角标 ──
    // 表驱动：命中 label 的菜单项就在后面挂一个红点 / 黄点（一级、二级、分组标题都能挂）。
    // 老板 2026-10-08 起左侧菜单最多两级，第三级变成不折叠的分组标题，所以这里按 label 递归找。
    const BADGE_RULES: Array<{
      labels: string[];
      count: number;
      color: string;
      /** 点掉角标时顺手标记「看过了」 */
      markSeen?: () => void;
      /** 点击时改跳哪儿（默认跳这个菜单项自己的页面） */
      to?: (key: string) => string;
      /** 点进去之前先记一笔「刚清掉了什么」（陪玩「订单管理」用） */
      onOpen?: (key: string) => void;
      title?: string;
    }> = [
      { labels: REVIEW_LABELS, count: pCount, color: SEMANTIC.danger, markSeen },
      { labels: ['工作室桥接'], count: bpCount, color: SEMANTIC.danger, markSeen: markBridgeSeen },
      { labels: ['报账系统'], count: bCount, color: SEMANTIC.danger, markSeen: markBillingSeen },
      // 工作抽查异常（/admin/review-queue-count，见上面 reviewBadge）挂在「陪玩列表」上：
      // 点进去就是陪玩列表，能看到那个人的工作记录。以前挂在折叠的「陪玩管理」上，点不动。
      { labels: REVIEW_WORK_LABELS, count: rvCount, color: SEMANTIC.warning, markSeen: markReviewSeen },
      { labels: CHAT_LABELS, count: directUnread, color: SEMANTIC.danger },
      {
        labels: CONTACT_LABELS, count: cCount, color: SEMANTIC.warning, markSeen: markContactSeen,
        // 「客服跟进台账」已并进「管理端直添客户流转明细」（老板 2026-09-30）
        to: (key) => key + '?tab=converted',
      },
      {
        labels: PENDING_START_LABELS, count: psCount, color: SEMANTIC.warning, markSeen: markPendingStartSeen,
        // 新菜单的「订单」是 5 组里的顶层，第一个子项是派单工作台；待开始角标应落到「我的订单 / 全部订单」。
        to: () => rolePage(user.role, 'orders') || '/admin/orders',
        onOpen: (key) =>
          rememberCleared(noticePath(key), [`${psCount} 张单已抢到/已确认，还没点「开始首单」`]),
      },
      {
        labels: OUTCOME_REVIEW_LABELS, count: orCount, color: SEMANTIC.danger,
        title: `${orCount} 张报「不成功」的单还没拍板 —— 去定责：谁的问题找谁`,
      },
    ];

    /** 这个菜单项点了要跳哪：自己就是页面就用自己；是分组 / 折叠项就跳进去第一个能点的页面。 */
    const jumpKeyOf = (node: any): string | null => {
      if (typeof node?.key === 'string' && node.key.startsWith('/')) return node.key;
      for (const kid of node?.children || []) {
        const found = jumpKeyOf(kid);
        if (found) return found;
      }
      return null;
    };

    const applyBadges = (list: any[]): any[] =>
      list.map((node: any) => {
        const next: any = Array.isArray(node.children) && node.children.length
          ? { ...node, children: applyBadges(node.children) }
          : { ...node };
        const rule = BADGE_RULES.find((r) => r.count > 0 && r.labels.includes(next.label));
        if (!rule) return next;
        const label = (
          <span
            onClick={(e: any) => {
              e.stopPropagation();
              rule.onOpen?.(next.key);
              rule.markSeen?.();
              const jump = jumpKeyOf(next);
              if (jump) {
                clearNoticesByKey(next.key);
                navigate(rule.to ? rule.to(jump) : jump);
              }
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}
            title={rule.title}
          >
            {next.label}
            <Badge
              count={rule.count}
              size="small"
              overflowCount={99}
              style={{ boxShadow: badgeGlow(rule.color) }}
            />
          </span>
        );
        return { ...next, label };
      });

    const badged = applyBadges(items);
    // 先把「模块图标色 + 业绩比例小字」挂好，再平铺单子菜单 ——
    // 平铺时父级的图标/文字会被搬到子项上，顺序反了颜色就丢了。
    const decorated = decorateMenu(badged, shareRatios);
    const flattened = decorated.map((item) => {
      // 单子菜单直接平铺：点击父级直接跳转，省掉再点一次二级菜单
      if (item.children && item.children.length === 1) {
        const child = item.children[0];
        return { key: child.key, icon: item.icon, label: item.label, ratioKey: (item as any).ratioKey };
      }
      return item;
    });
    // 最后一道：把「通知」未读角标挂到对应菜单项上。
    //   叶子（跟具体页面一一对应）：挂这个页面自己的未读数；
    //   父级（有子菜单）：挂**子树汇总** —— 店长把子菜单手动收起时，一级菜单上的角标照样看得到还有几条没读。
    const withNoticeBadges = (list: any[]): { items: any[]; count: number } => {
      let total = 0;
      const items = list.map((item) => {
        if (Array.isArray(item.children) && item.children.length > 0) {
          const sub = withNoticeBadges(item.children);
          total += sub.count;
          if (!sub.count) return { ...item, children: sub.items };
          // 父级（店长 / 老板收起子菜单时）：悬停写清是哪个子页面有几条。
          const parentHint = item.children
            .map((ch: any) => {
              const cp = noticePath(ch.key);
              const ts = cp ? titlesByPath[cp] || [] : [];
              // ch.label 可能已被 decorateMenu 换成节点（带业绩比例那种），只对字符串拼提示。
              const name = typeof ch.label === 'string' ? ch.label : '';
              const parts: string[] = [];
              if (ts.length) parts.push(`${ts[0]}${ts.length > 1 ? ` 等 ${ts.length} 条` : ''}`);
              if (cp && cp === workWechatPath && workWechatBadge > 0) {
                parts.push(`${workWechatBadge} 条陪玩提交的工作微信待审核`);
              }
              return parts.length ? `${name ? name + '：' : ''}${parts.join('；')}` : '';
            })
            .filter(Boolean)
            .join('\n');
          return {
            ...item,
            children: sub.items,
            label: menuBadgeLabel(item.label, sub.count, parentHint || undefined),
          };
        }
        const path = noticePath(item.key);
        const n = path ? unreadByPath[path] || 0 : 0;
        // 同一条菜单只挂一个角标：通知未读和服务端待审数取大的那个。
        const pending = path && path === workWechatPath ? workWechatBadge : 0;
        const count = Math.max(n, pending);
        total += count;
        if (!count) return item;
        const ts = (path ? titlesByPath[path] : []) || [];
        let hint = ts.slice(0, 3).join('\n') + (ts.length > 3 ? `\n… 等 ${ts.length} 条` : '');
        if (pending > n) {
          hint += (hint ? '\n' : '') + `${pending} 条陪玩提交的工作微信待审核`;
        }
        return { ...item, label: menuBadgeLabel(item.label, count, hint || undefined) };
      });
      return { items, count: total };
    };
    // 上面「徽标那一段」是拿 label 字符串比对的，所以这层装饰必须放在它之后。
    const finalItems = withNoticeBadges(flattened).items;
    // 「待处理」那一项挂真实待办条数（不是未读），鼠标停上去写清是哪几类有几条。
    const withTodosBadge = finalItems.map((it: any) =>
      it.key === '/todos' && todosBadge > 0
        ? { ...it, label: menuBadgeLabel(it.label, todosBadge, todosHint || undefined) }
        : it,
    );
    // 最后一步：把标题包成可点 —— 点一下直接进它里面第一个页面。
    //   ① 一级菜单（陪玩管理 / 客服管理…）：老板 2026-10-16「点一下，再动鼠标点右侧的二级标题，
    //      很不顺手」—— 以前点一级的文字只是展开 / 收起，得再点一次二级才进得去。
    //   ② 分组标题（type: 'group'，如「陪玩工资 70%」）：老板 2026-10-10「点不开？」，
    //      它本来只做视觉分段，但长得跟能点的菜单项一模一样。
    // 「最多两级」这条规矩不变（老板 2026-10-08），展开 / 收起改由那一行右边的箭头管。
    // 必须放在徽标 / 业绩比例之后：那些是按 label 字符串比对的，先换成节点就比不中了。
    return makeTitlesClickable(withTodosBadge, (key) => navigate(key));
  }, [user, directUnread, pendingBadge, bridgePendingBadge, billingBadge, contactBadge, pendingStartBadge, reviewBadge, outcomeReviewBadge, shareRatios, unreadByPath, titlesByPath, workWechatBadge, clearNoticesByKey, rememberCleared, navigate, markSeen, markBridgeSeen, markBillingSeen, markReviewSeen, markContactSeen, markPendingStartSeen, todosBadge, todosHint]);

  const onMenuClick: MenuProps['onClick'] = ({ key, domEvent }) => {
    // 只允许点击菜单文字触发跳转，避免点到左侧栏空白区域也误触。
    const target = domEvent.target as HTMLElement | null;
    const titleContent = target?.closest?.('.ant-menu-title-content');
    if (!titleContent) return;

    // 只清掉对应页面的角标，避免点其他菜单误清
    clearNoticesByKey(key);
    if (key.includes('/review')) markSeen();
    if (key.includes('bridges')) markBridgeSeen();
    if (key.includes('/billing')) markBillingSeen();
    if (key.includes('/orders')) {
      // 同上：从左侧栏点进来（红点没走自定义 label 那条路时）也要把「还剩几张单没开始」写进横幅。
      if (pendingStartBadge > 0) {
        rememberCleared(noticePath(key), [
          `${pendingStartBadge} 张单已抢到/已确认，还没点「开始首单」`,
        ]);
      }
      markPendingStartSeen();
    }
    navigate(key);
  };

  return { menuItems, onMenuClick };
}
