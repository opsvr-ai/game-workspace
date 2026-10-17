/**
 * 内容区顶头的「这个页面挂着几条提醒」横幅 —— 从 layouts/AppLayout.tsx 原样搬出。
 *
 * 老板 2026-10-05：「有未读，点进去发现没任何变化」——进到这一页顶头就直接写清
 * 这条路由上挂着几条提醒、分别是什么。
 *   ① 还有没读的：蓝色横幅 + 「全部已读」（角标 / 铃铛同步）；
 *   ② 刚从左侧栏点进来、角标已经被点掉的：橙色横幅把「刚才清掉的是哪几条」再写一遍，
 *      数字一没也知道刚才那条提醒是啥（点「知道了」才收）。
 *
 * 通知数据 / 「刚才清掉」的记账都在 useMenuBadges 里，这里只负责渲染。
 */
import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Alert, Button, Space } from 'antd';
import { rolePage } from '../../config/roleMenus';
import { noticePath, type NoticeItem } from '../../stores/notifStore';
import { CLEARED_TTL_MS, type ClearedNotices } from '../../hooks/useMenuBadges';

interface Props {
  /** 当前登录角色（决定「补单审核」入口 / 工作记录页） */
  role?: string;
  /** 归一化路径 → 未读通知标题 */
  titlesByPath: Record<string, string[]>;
  /** 刚点掉、还没过期的提醒 */
  clearedNotices: ClearedNotices;
  /** 全部通知（按标题找「工作抽查异常」那几条） */
  notifItems: NoticeItem[];
  onRememberCleared: (path: string, titles: string[]) => void;
  onForgetCleared: (path: string) => void;
  onMarkNoticesReadByPath: (path: string) => void;
  onMarkNoticeRead: (id: string) => void;
  workAlertHref: (name: string) => string;
}

const NoticePathBanner: React.FC<Props> = ({
  role,
  titlesByPath,
  clearedNotices,
  notifItems,
  onRememberCleared,
  onForgetCleared,
  onMarkNoticesReadByPath,
  onMarkNoticeRead,
  workAlertHref,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  // 必须带上 query：`陪玩工作微信` / `客服工作微信` 是**同一个路径**下按
  // `type` 区分的两个菜单，只看 pathname 的话这两页的横幅永远匹配不上（老板 2026-10-05）。
  const curPath = noticePath(location.pathname + (location.search || ''));
  if (!curPath) return null;
  const titles = titlesByPath[curPath] || [];
  const just = clearedNotices[curPath];
  const justTitles = just && Date.now() - just.at < CLEARED_TTL_MS ? just.titles : [];
  if (!titles.length && !justTitles.length) return null;
  const unread = titles.length > 0;
  const list = unread ? titles : justTitles;
  // 「订单管理」这一页的提醒八成是「待审核：补单申请」——给个按钮直接打开补单审核，
  // 别让老板在一长串订单里自己找（那个按钮在订单页右上角）。
  const ordersPath = rolePage(role, 'orders');
  const canGoSupplement =
    role !== 'COMPANION' &&
    !!ordersPath &&
    curPath === noticePath(ordersPath) &&
    list.some((t) => t.includes('补单'));
  // 「工作抽查异常」的横幅里直接把人的名字做成按钮 —— 点一下就到他的工作记录，
  // 不用再让人从一长串提醒里猜「具体是哪一条」（老板 2026-10-05）。
  const workNames = Array.from(
    new Set(
      list
        .filter((t) => t.startsWith('工作抽查异常 · '))
        .map((t) => t.slice('工作抽查异常 · '.length).trim())
        .filter(Boolean),
    ),
  );
  return (
    <Alert
      type={unread ? 'info' : 'warning'}
      showIcon
      style={{ marginBottom: 12 }}
      message={
        unread
          ? `这里还有 ${titles.length} 条未读提醒`
          : `刚才这里清掉了 ${justTitles.length} 条提醒（已标已读）`
      }
      description={`${list.slice(0, 5).join(' · ')}${
        list.length > 5 ? ` … 等 ${list.length} 条` : ''
      }`}
      action={
        <Space size={8}>
          {workNames.slice(0, 3).map((n) => (
            <Button
              key={n}
              size="small"
              danger
              onClick={() => {
                notifItems
                  .filter((it) => !it.read && String(it.title).slice('工作抽查异常 · '.length).trim() === n && String(it.title).startsWith('工作抽查异常 · '))
                  .forEach((it) => onMarkNoticeRead(it.id));
                navigate(workAlertHref(n));
              }}
            >
              🔎 {n} 的工作记录
            </Button>
          ))}
          {canGoSupplement && (
            <Button
              size="small"
              onClick={() => window.dispatchEvent(new CustomEvent('supplement:open'))}
            >
              🧾 去补单审核
            </Button>
          )}
          {unread ? (
            <Button
              size="small"
              onClick={() => {
                onRememberCleared(curPath, titles);
                onMarkNoticesReadByPath(curPath);
              }}
            >
              全部已读
            </Button>
          ) : (
            <Button size="small" onClick={() => onForgetCleared(curPath)}>
              知道了
            </Button>
          )}
        </Space>
      }
    />
  );
};

export default NoticePathBanner;
