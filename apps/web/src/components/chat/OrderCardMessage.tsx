// craftsman-ignore: TS001,TS002
import React from 'react';
import { RightOutlined } from '@ant-design/icons';

interface OrderCardMessageProps {
  content: string; // JSON: { orderId, gameName, amount, status, duration?, customerName? }
  isMe: boolean;
  onViewOrder?: (orderId: string) => void;
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: '待接单',
  GRABBED: '已接单',
  CONFIRMED: '已确认',
  DONE: '已完成',
  CANCELLED: '已取消',
};
const STATUS_COLORS: Record<string, string> = {
  PENDING: '#F2A900',
  GRABBED: '#2B579A',
  CONFIRMED: '#23A55A',
  DONE: '#80848F',
  CANCELLED: '#F23F42',
};

const OrderCardMessage: React.FC<OrderCardMessageProps> = ({ content, isMe, onViewOrder }) => {
  let order: any = {};
  try {
    order = JSON.parse(content);
  } catch {
    return <span>{content}</span>;
  }

  return (
    <div
      onClick={() => onViewOrder?.(order.orderId)}
      style={{
        display: 'inline-block',
        padding: '10px 14px',
        borderRadius: 12,
        background: 'linear-gradient(135deg, #FFF8E1, #FFFDE7)',
        border: '1px solid #F2A900',
        maxWidth: 300,
        cursor: onViewOrder ? 'pointer' : 'default',
        boxShadow: '0 1px 4px rgba(242,169,0,0.1)',
      }}
    >
      <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>📋 订单 #{order.orderId?.slice(-8) || '...'}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#313338' }}>{order.gameName || '游戏订单'}</div>
      <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 13, color: '#666' }}>
        <span>💰 ¥{Number(order.amount || 0).toFixed(0)}</span>
        {order.duration && <span>⏱ {order.duration}h</span>}
      </div>
      {order.customerName && <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>👤 {order.customerName}</div>}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
        <span
          style={{
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 4,
            background: `${STATUS_COLORS[order.status] || '#888'}20`,
            color: STATUS_COLORS[order.status] || '#888',
          }}
        >
          🟢 {STATUS_LABELS[order.status] || order.status}
        </span>
        {onViewOrder && (
          <span style={{ fontSize: 11, color: '#2B579A', display: 'flex', alignItems: 'center', gap: 2 }}>
            查看详情 <RightOutlined style={{ fontSize: 10 }} />
          </span>
        )}
      </div>
    </div>
  );
};

export default OrderCardMessage;
