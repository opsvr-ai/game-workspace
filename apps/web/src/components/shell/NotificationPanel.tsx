/**
 * 右上角铃铛面板（通知面板）—— 从 layouts/AppLayout.tsx 原样搬出，行为/样式/文案零变化。
 *
 * 开合状态（notifOpen）仍由 AppLayout 管，这里只收「面板本身怎么画」：
 *   - Popover 标题「通知」+ NoticeList（全部已读 / 清空 / 点条目跳转）；
 *   - 铃铛按钮上的未读角标 / 闪红动画；
 *   - 「工作抽查异常」老通知的跳转纠正（按标题里的名字落到那个人的工作记录）。
 *
 * 未读通知自己从 notifStore 订阅（跟原来的 AppLayout 是同一份 store，不会多拉数据）。
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Popover } from 'antd';
import { BellOutlined } from '@ant-design/icons';
import { commander } from '../../styles/commander';
import { SEMANTIC } from '../../styles/tokens';
import { NoticeList } from '../NoticeList';
import { useNotifStore, selectUnreadNotices } from '../../stores/notifStore';
import { useAuthStore } from '../../stores/authStore';

interface Props {
  /** 面板是否展开（开合状态仍由 AppLayout 管） */
  open: boolean;
  /** 开合变化回调：点铃铛 / 点面板外 / 选中一条通知后收起来 */
  onOpenChange: (open: boolean) => void;
}

const NotificationPanel: React.FC<Props> = ({ open, onOpenChange }) => {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const unreadNotices = useNotifStore(selectUnreadNotices);

  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      trigger="click"
      placement="bottomRight"
      title="通知"
      content={
        <NoticeList
          onClose={() => onOpenChange(false)}
          onNavigate={(href, item) => {
            // 「工作抽查异常」的老通知：href 里没带陪玩 id，点进去只到陪玩列表、
            // 什么都没标出来。按标题里的名字补一次，直接落到那个人的工作记录
            // （老板 2026-10-05）。
            const title = String(item?.title || '');
            const PREFIX = '工作抽查异常 · ';
            if (
              title.startsWith(PREFIX) &&
              href &&
              !href.includes('workCompanion') &&
              !href.includes('workName')
            ) {
              const name = title.slice(PREFIX.length).trim();
              if (name) {
                const base = user?.role === 'CS' ? '/cs/employees' : '/admin/companions';
                navigate(`${base}?role=COMPANION&workName=${encodeURIComponent(name)}`);
                return;
              }
            }
            navigate(href);
          }}
        />
      }
    >
      <Badge
        count={unreadNotices}
        overflowCount={99}
        size="default"
        offset={[-2, 8]}
        className={unreadNotices > 0 ? 'badge-pop-active' : undefined}
      >
        <div
          style={{
            borderRadius: 8,
            ...(unreadNotices > 0
              ? {
                  animation: 'bell-glow 2s ease-in-out infinite',
                  boxShadow: '0 0 12px rgba(255, 77, 79, 0.5)',
                }
              : {}),
          }}
        >
          <Button
            type="text"
            icon={React.createElement(BellOutlined)}
            style={{
              color: unreadNotices > 0 ? SEMANTIC.danger : commander.textSecondary,
              fontSize: 20,
            }}
            className={unreadNotices > 0 ? 'bell-glow-active' : ''}
          />
        </div>
      </Badge>
    </Popover>
  );
};

export default NotificationPanel;
