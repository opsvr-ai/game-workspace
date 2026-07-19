// craftsman-ignore: TS001,TS002
import React from 'react';
import { Modal, Input, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';

const { Text } = Typography;

const flatRoutes: { key: string; label: string }[] = [
  { key: '/admin', label: '数据看板' },
  { key: '/admin/dispatch', label: '派单管理' },
  { key: '/admin/orders', label: '订单管理' },
  { key: '/admin/employees', label: '员工管理' },
  { key: '/admin/customers', label: '客户管理' },
  { key: '/admin/traffic', label: '订单池' },
  { key: '/admin/billing', label: '报账系统' },
  { key: '/admin/pc-control', label: '远程控制' },
  { key: '/admin/blacklist', label: '进程黑名单' },
  { key: '/admin/whitelist', label: '进程白名单' },
  { key: '/admin/process-kill-log', label: '杀进程日志' },
  { key: '/admin/attendance', label: '考勤管理' },
  { key: '/admin/review', label: '实名审核' },
  { key: '/admin/settings', label: '系统设置' },
  { key: '/cs/dispatch', label: '派单工作台' },
  { key: '/cs/billing', label: '报账系统' },
  { key: '/cs/orders', label: '订单管理' },
  { key: '/cs/employees', label: '陪玩管理' },
  { key: '/companion', label: '首页' },
  { key: '/companion/pool', label: '订单池' },
  { key: '/companion/billing', label: '报账系统' },
  { key: '/companion/customers', label: '客户管理' },
  { key: '/companion/orders', label: '接单记录' },
  { key: '/companion/dispatch', label: '派单记录' },
  { key: '/owner/orders', label: '订单管理' },
  { key: '/owner/customers', label: '客户管理' },
  { key: '/owner/employees', label: '员工管理' },
  { key: '/owner/review', label: '实名审核' },
  { key: '/owner/studios', label: '工作室管理' },
  { key: '/owner/authorizations', label: '客户端授权' },
  { key: '/owner/settings', label: '系统设置' },
  { key: '/profile', label: '个人设置' },
];

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onClose }) => {
  const navigate = useNavigate();

  return (
    <Modal open={open} onCancel={onClose} footer={null} title="命令面板" width={480} aria-label="命令面板">
      <Input.Search
        placeholder="搜索页面..."
        autoFocus
        onSearch={(v) => {
          const match = flatRoutes.find(
            (m) => m.label.toLowerCase().includes(v.toLowerCase()) || m.key.toLowerCase().includes(v.toLowerCase()),
          );
          if (match) {
            navigate(match.key);
            onClose();
          }
        }}
      />
      <div style={{ marginTop: 12 }}>
        {flatRoutes.slice(0, 15).map((m) => (
          <div
            key={m.key}
            role="button"
            tabIndex={0}
            aria-label={`导航到${m.label}`}
            style={{ padding: '6px 8px', cursor: 'pointer', borderRadius: 6 }}
            onClick={() => {
              navigate(m.key);
              onClose();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                navigate(m.key);
                onClose();
              }
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#f0f0f0')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
          >
            <Text>{m.label}</Text>
          </div>
        ))}
      </div>
    </Modal>
  );
};

export default CommandPalette;
