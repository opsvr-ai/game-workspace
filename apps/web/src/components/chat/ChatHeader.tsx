// craftsman-ignore: TS001,TS002
import React from 'react';
import { Button, Space, Tag, Typography } from 'antd';
import { PushpinOutlined, PushpinFilled, CloseOutlined, PhoneOutlined, MinusOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useVoiceCallStore } from '../../stores/voiceCallStore';
import { useAuthStore } from '../../stores/authStore';
import { ordersPathWithOrder, parseOrderInfo, orderInfoVisible, ORDER_INFO_TTL_MS } from '../../utils/chatOrder';

const { Text } = Typography;

interface ChatHeaderProps {
  name: string;
  role: string;
  userId?: string;
  avatarUrl?: string;
  orderInfo?: string | null;
  pinned?: boolean;
  onTogglePin?: () => void;
  /** 最小化成右下角一条小窗（再点一下还原） */
  onMinimize?: () => void;
  onClose?: () => void;
  onCallClick?: () => void;
  /** 群聊里可见：客服/店长发广播（弹到每个陪玩电脑右下角） */
  onBroadcast?: () => void;
}

const ROLE_LABELS: Record<string, string> = {
  COMPANION: '陪玩',
  CS: '客服',
  ADMIN: '管理员',
  OWNER: '老板',
  GROUP: '群聊',
};

function formatCallDuration(seconds?: number) {
  if (!seconds) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const ChatHeader: React.FC<ChatHeaderProps> = ({ name, role, userId, avatarUrl, orderInfo, pinned, onTogglePin, onMinimize, onClose, onCallClick, onBroadcast }) => {
  const call = useVoiceCallStore((s) => s.call);
  const inCall = call.status === 'connected' && !!userId && call.peerId === userId;
  const navigate = useNavigate();
  const myRole = useAuthStore((s) => s.user?.role);
  // 聊天框顶上那行「这一单」（老板 2026-09-30）：带着订单 id 就能点，点一下跳到订单管理
  // 并把这一单的详情弹窗打开；老会话只存了一句文本，照旧只显示、不给点。
  const orderRef = parseOrderInfo(orderInfo);
  // 「这一单」只在顶上挂 10 分钟，到点自己消失（老板 2026-10-05：「从沟通点聊天订单消息
  // 只显示 10 分钟，10 分钟后自动消失」）。老会话（没有时间戳）直接不显示。
  // 到点要自己消失就得挂个定时器重画一次，否则这一页不重渲染的话那行字会一直留在那儿。
  const orderAt = orderRef?.at;
  const [orderExpired, setOrderExpired] = React.useState(() => !orderInfoVisible(orderInfo));
  React.useEffect(() => {
    if (!orderAt) {
      setOrderExpired(true);
      return;
    }
    const left = orderAt + ORDER_INFO_TTL_MS - Date.now();
    if (left <= 0) {
      setOrderExpired(true);
      return;
    }
    setOrderExpired(false);
    const t = setTimeout(() => setOrderExpired(true), left);
    return () => clearTimeout(t);
  }, [orderInfo, orderAt]);
  const showOrder = !!orderRef && !orderExpired;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        borderBottom: '1px solid #E8E9EB',
        background: '#FFF',
        minHeight: 56,
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <div style={{ position: 'relative', width: 36, height: 36, flexShrink: 0 }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%', background: '#CBD5E1',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#FFF', fontSize: 14, fontWeight: 700,
            position: 'absolute', top: 0, left: 0,
          }}>
            {name[0]?.toUpperCase()}
          </div>
          {avatarUrl && (
            <img src={avatarUrl} alt="" style={{
              width: 36, height: 36, borderRadius: '50%', objectFit: 'cover',
              position: 'absolute', top: 0, left: 0,
            }} />
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <Space size={8}>
            <Text strong style={{ fontSize: 15, color: '#313338' }}>
              {name}
            </Text>
            <Tag style={{ fontSize: 11, padding: '0 6px', lineHeight: '18px' }}>{ROLE_LABELS[role] || role}</Tag>
          </Space>
        {showOrder && orderRef &&
          (orderRef.orderId ? (
            <span
              role="button"
              onClick={() => navigate(ordersPathWithOrder(myRole, orderRef.orderId!))}
              title="点这里打开这一单：来源 / 引流账号 / 客户昵称 / 客户账号ID / 客户联系方式 / 备注 都在订单详情里"
              style={{
                fontSize: 12,
                marginTop: 1,
                color: '#2563EB',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                maxWidth: '100%',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {orderRef.text || '这一单'}
              </span>
              <span style={{ flexShrink: 0, textDecoration: 'underline' }}>查看订单 ›</span>
            </span>
          ) : (
            <Text type="secondary" style={{ fontSize: 12, marginTop: 1 }}>
              {orderRef.text}
            </Text>
          ))}
        {inCall && (
          <span
            style={{
              fontSize: 12,
              color: '#16A34A',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              marginTop: 2,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#16A34A', display: 'inline-block', animation: 'pulse-glow 1.5s ease-in-out infinite' }} />
            正在语音通话 {formatCallDuration(call.duration)}
          </span>
        )}
      </div>
      </div>
      <Space size={4}>
        {onBroadcast && (
          <Button size="small" type="text" onClick={onBroadcast} style={{ padding: '0 6px', color: '#FF4757', fontWeight: 600 }} title="发广播（每个陪玩电脑右下角弹出提醒）">
            📢 广播
          </Button>
        )}
        {onCallClick && (
          <PhoneOutlined onClick={onCallClick} style={{ cursor: 'pointer', color: '#52c41a', padding: 4, fontSize: 16 }} title="语音通话" />
        )}
        {onTogglePin && (
          <span
            onClick={onTogglePin}
            title={pinned ? '已置顶 · 点一下取消置顶' : '置顶到「消息」列表最上面'}
            style={{ cursor: 'pointer', padding: 4, color: pinned ? '#F0B232' : '#949BA4' }}
          >
            {pinned ? <PushpinFilled /> : <PushpinOutlined />}
          </span>
        )}
        {onMinimize && (
          <MinusOutlined onClick={onMinimize} style={{ cursor: 'pointer', color: '#949BA4', padding: 4, fontSize: 14 }} title="最小化（收到新消息会自动提醒）" />
        )}
        {onClose && (
          <CloseOutlined onClick={onClose} style={{ cursor: 'pointer', color: '#949BA4', padding: 4, fontSize: 14 }} title="关闭" />
        )}
      </Space>
    </div>
  );
};

export default React.memo(ChatHeader);
