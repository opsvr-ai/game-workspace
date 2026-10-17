/**
 * 横幅 / 搭档邀请 / 转让申请的「渲染」—— 从 layouts/AppLayout.tsx 原样搬出，样式/文案/交互零变化。
 *
 * 两个挂载点（位置和原来一样，只是包了一层组件）：
 *   - PartnerInvitePopover / TransferRequestPopover：顶栏铃铛右边那两个角标按钮
 *     （🤝 待处理搭档邀请 / 🔁 待我确认的转让）。**刻意拆成两个组件、由 AppLayout 分别挂载**，
 *     这样它们在 antd <Space> 里仍然各自是一个子节点（间距 / DOM 结构和原来完全一致）；
 *   - ShellBanners：全局 UrgentOrderPopup（新单 / 指定单弹窗）。
 */
import React from 'react';
import { Badge, Button, Popover, Space, Typography } from 'antd';
import { ordersApi } from '../../api/orders';
import { message } from '../../utils/feedback';
import { BORDER, SEMANTIC, TEXT } from '../../styles/tokens';
import { commander } from '../../styles/commander';
import UrgentOrderPopup from '../UrgentOrderPopup';

const { Text } = Typography;

const InviteCountdown: React.FC<{ seconds: number }> = ({ seconds }) => {
  const [left, setLeft] = React.useState(seconds);
  React.useEffect(() => {
    const t = setInterval(() => setLeft((v) => (v <= 1 ? 0 : v - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span style={{ color: SEMANTIC.danger, fontWeight: 600 }}>⏳ {left} 秒后自动取消</span>
  );
};

interface PartnerInvitePopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partnerInvites: any[];
  removePartnerInvite: (sessionId: string) => void;
}

export const PartnerInvitePopover: React.FC<PartnerInvitePopoverProps> = ({
  open,
  onOpenChange,
  partnerInvites,
  removePartnerInvite,
}) => (
  <Popover
    open={open}
    onOpenChange={onOpenChange}
    trigger="click"
    placement="bottomRight"
    title="待处理搭档邀请"
    content={
      <div style={{ width: 320 }}>
        {partnerInvites.length === 0 ? (
          <Text type="secondary">暂无待处理邀请</Text>
        ) : (
          partnerInvites.map((p) => {
            const remaining = Math.max(0, Math.ceil((p.expiresAt - Date.now()) / 1000));
            return (
              <div key={p.sessionId} style={{ padding: '8px 0', borderBottom: `1px solid ${BORDER.secondary}` }}>
                <div>
                  <Text strong>🤝 {p.inviterName} 邀请你搭档</Text>
                </div>
                <div style={{ fontSize: 12, color: TEXT.secondary }}>
                  {p.gameName || '订单'} · ¥{Number(p.amount || 0).toFixed(1)} · {p.duration || 1}h
                </div>
                <div style={{ margin: '6px 0' }}>
                  <InviteCountdown seconds={remaining} />
                </div>
                <Space size={8}>
                  <Button
                    size="small"
                    type="primary"
                    onClick={async () => {
                      try {
                        await ordersApi.acceptPartnerInvite(p.sessionId);
                        message.success('已接受搭档邀请，开始计时');
                        removePartnerInvite(p.sessionId);
                        (window as any).electronAPI?.sessionWatch?.(p.sessionId);
                        window.dispatchEvent(new Event('chunlv:service-started'));
                        onOpenChange(false);
                      } catch (e: any) {
                        message.error(e?.response?.data?.message || '接受失败');
                      }
                    }}
                  >
                    接受
                  </Button>
                  <Button
                    size="small"
                    onClick={async () => {
                      try {
                        await ordersApi.rejectPartnerInvite(p.sessionId);
                      } catch {}
                      removePartnerInvite(p.sessionId);
                    }}
                  >
                    拒绝
                  </Button>
                </Space>
              </div>
            );
          })
        )}
      </div>
    }
  >
    <Badge
      count={partnerInvites.length}
      overflowCount={99}
      size="default"
      offset={[-2, 8]}
    >
      <Button
        type="text"
        icon={<span style={{ fontSize: 18 }}>🤝</span>}
        style={{ color: partnerInvites.length > 0 ? SEMANTIC.warning : commander.textSecondary }}
      />
    </Badge>
  </Popover>
);

interface TransferRequestPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transferReqs: any[];
  acceptTransferReq: (req: any) => void;
  rejectTransferReq: (req: any) => void;
}

export const TransferRequestPopover: React.FC<TransferRequestPopoverProps> = ({
  open,
  onOpenChange,
  transferReqs,
  acceptTransferReq,
  rejectTransferReq,
}) => (
  <Popover
    open={open}
    onOpenChange={onOpenChange}
    trigger="click"
    placement="bottomRight"
    title="待我确认的转让"
    content={
      <div style={{ width: 320 }}>
        {transferReqs.length === 0 ? (
          <Text type="secondary">暂无待确认的转让</Text>
        ) : (
          transferReqs.map((p) => (
            <div key={p.requestId || p.id} style={{ padding: '8px 0', borderBottom: `1px solid ${BORDER.secondary}` }}>
              <div>
                <Text strong>🔁 {p.fromName} 想把订单转给你</Text>
              </div>
              <div style={{ fontSize: 12, color: TEXT.secondary }}>
                {p.orderCode ? `${p.orderCode} · ` : ''}
                {p.gameName || '订单'} · ¥{Number(p.amount || 0).toFixed(1)}
                {p.reason ? ` · ${p.reason}` : ''}
              </div>
              <div style={{ margin: '6px 0' }}>
                <InviteCountdown
                  seconds={Math.max(0, Math.ceil(((p.expiresAt || 0) - Date.now()) / 1000))}
                />
              </div>
              <Space size={8}>
                <Button
                  size="small"
                  type="primary"
                  onClick={async () => {
                    await acceptTransferReq(p);
                    onOpenChange(false);
                  }}
                >
                  同意
                </Button>
                <Button
                  size="small"
                  onClick={async () => {
                    await rejectTransferReq(p);
                  }}
                >
                  拒绝
                </Button>
              </Space>
            </div>
          ))
        )}
      </div>
    }
  >
    <Badge count={transferReqs.length} overflowCount={99} size="default" offset={[-2, 8]}>
      <Button
        type="text"
        icon={<span style={{ fontSize: 18 }}>🔁</span>}
        style={{ color: transferReqs.length > 0 ? SEMANTIC.warningDeep : commander.textSecondary }}
      />
    </Badge>
  </Popover>
);

interface ShellBannersProps {
  urgentOrder: any | null;
  urgentGrabbed: any | null;
  setUrgentOrder: (v: any | null) => void;
  setUrgentGrabbed: (v: any | null) => void;
}

export const ShellBanners: React.FC<ShellBannersProps> = ({
  urgentOrder,
  urgentGrabbed,
  setUrgentOrder,
  setUrgentGrabbed,
}) => (
  <UrgentOrderPopup
    urgentOrder={urgentOrder}
    urgentGrabbed={urgentGrabbed}
    setUrgentOrder={setUrgentOrder}
    setUrgentGrabbed={setUrgentGrabbed}
  />
);
