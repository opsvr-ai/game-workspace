import React, { useState, useEffect, useCallback } from 'react';
import { Card, Button, Typography, Tag, Row, Col, Spin, message, Empty, Progress, Space, Badge } from 'antd';
import { ClockCircleOutlined, MessageOutlined } from '@ant-design/icons';
import { ordersApi } from '../../api/orders';
import { useSocket } from '../../hooks/useSocket';
import ChatModal from '../../components/ChatModal';
import { useAuthStore } from '../../stores/authStore';

// Inject message pulse animation
if (!document.getElementById('msg-pulse-pool')) {
  const s = document.createElement('style');
  s.id = 'msg-pulse-pool';
  s.textContent = '@keyframes msg-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.1)}}';
  document.head.appendChild(s);
}

const { Text, Title } = Typography;

const orderTypeConfig: Record<string, { label: string; color: string }> = {
  NEW: { label: '首单', color: 'green' },
  RENEW: { label: '续单', color: 'orange' },
  REPURCHASE: { label: '复购', color: 'blue' },
  TIP: { label: '打赏', color: 'purple' },
};

const PoolPage: React.FC = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const user = useAuthStore(s => s.user);
  const [poolStatus, setPoolStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [grabbing, setGrabbing] = useState<string | null>(null);

  const [unreadMap, setUnreadMap] = useState<Record<string, number>>({});

  // Read unread counts from localStorage on mount + periodically
  useEffect(() => {
    const read = () => {
      const map: Record<string, number> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith('unread-')) {
          map[k.replace('unread-', '')] = parseInt(localStorage.getItem(k) || '0', 10);
        }
      }
      setUnreadMap(map);
    };
    read();
    const t = setInterval(read, 2000);
    return () => clearInterval(t);
  }, []);

  // Chat state
  const [chatPartner, setChatPartner] = useState<{ name: string; avatar?: string; companionId: string; orderInfo?: string; orderId?: string } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [poolRes, statusRes] = await Promise.all([
        ordersApi.pool(),
        ordersApi.poolStatus(),
      ]);
      setOrders(poolRes.data.data ?? []);
      setPoolStatus(statusRes.data.data);
    } catch (e) {
      console.error('Pool fetch error', e);
      message.error('加载订单池失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Real-time pool updates via WebSocket
  useSocket({ onOrderPoolUpdated: fetchData });

  const handleGrab = async (orderId: string) => {
    setGrabbing(orderId);
    try {
      await ordersApi.grab(orderId);
      message.success('抢单成功！');
      fetchData();
    } catch (e: any) {
      message.error(e?.response?.data?.message ?? '抢单失败');
    } finally {
      setGrabbing(null);
    }
  };

  // Chat handlers
  const openChat = (order: any) => {
    // Clear unread badge
    localStorage.removeItem(`unread-${user?.companionId || order.id}`);
    setUnreadMap(prev => { const { [user?.companionId || order.id]: _, ...rest } = prev; return rest; });
    setChatPartner({
      name: order.csUser?.displayName || order.csUser?.username || '未知',
      avatar: order.csUser?.avatar || null,
      companionId: order.companionId || user?.companionId || '',
      orderId: user?.companionId || order.id,
      orderInfo: [
        `📋 ${order.gameName}`,
        `${order.type === 'NEW' ? '首单' : order.type === 'RENEW' ? '续费' : order.type === 'REPURCHASE' ? '复购' : order.type}`,
        `¥${Number(order.amount).toFixed(2)}`,
        order.duration ? `${order.duration}h` : '',
        order.customFields?.billingMode ? (order.customFields.billingMode === 'round' ? '按局' : '按小时') : '',
        order.customFields?.deltaMode ? `🎯${order.customFields.deltaMode}` : '',
        order.customer?.customerCode ? `👤${order.customer.customerCode}` : '',
        order.csUser?.username ? `💬${order.csUser.username}` : '',
      ].filter(Boolean).join(' · '),
    });
  };


  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;

  const isUnlocked = poolStatus?.isUnlocked ?? false;
  const todayRevenue = poolStatus?.todayRevenue ?? 0;
  const threshold = poolStatus?.threshold ?? 100;
  const pct = Math.min(Math.round((todayRevenue / threshold) * 100), 100);

  return (
    <div>
      <Title level={4}>📦 订单池</Title>

      <Card size="small" style={{ marginBottom: 16, background: isUnlocked ? '#f6ffed' : '#fff7e6' }}>
        <Row align="middle" justify="space-between">
          <Col>
            <Text strong>
              当日流水：¥{todayRevenue} ｜ 解锁门槛：¥{threshold}
              {isUnlocked ? ' ｜ 🟢 已解锁' : ' ｜ 🔒 未解锁'}
            </Text>
          </Col>
          <Col>
            <Tag color={isUnlocked ? 'success' : 'warning'} style={{ fontSize: 14, padding: '4px 12px' }}>
              {isUnlocked ? '✅ 可抢单' : `还差 ¥${Math.round((threshold - todayRevenue) * 100) / 100}`}
            </Tag>
          </Col>
        </Row>
        {!isUnlocked && <Progress percent={pct} size="small" style={{ marginTop: 8 }} />}
      </Card>

      {orders.length === 0 && <Empty description="暂无待派订单" />}

      {/* Horizontal order rows — all info in one row */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {orders.map((order: any, idx: number) => (
          <Card key={user?.companionId || order.id} size="small"
            style={{ borderLeft: `3px solid ${orderTypeConfig[order.type]?.color || '#1677ff'}` }}>
            <Row align="middle" gutter={8} wrap={false}>
              <Col><Tag style={{ background: '#f0f0f0', color: '#666', fontWeight: 700, minWidth: 24, textAlign: 'center', margin: 0 }}>{idx + 1}</Tag></Col>
              <Col><Tag color={orderTypeConfig[order.type]?.color || 'blue'} style={{ margin: 0 }}>{orderTypeConfig[order.type]?.label || order.type}</Tag></Col>
              <Col><Text strong style={{ fontSize: 14, whiteSpace: 'nowrap' }}>{order.gameName}</Text></Col>
              <Col><Text style={{ fontSize: 14, fontWeight: 700, color: '#1677ff', whiteSpace: 'nowrap' }}>¥{Number(order.amount).toFixed(0)}</Text></Col>
              {order.customFields?.deltaMode && <Col><Tag color="cyan" style={{ margin: 0 }}>{order.customFields.deltaMode}</Tag></Col>}
              {order.customFields?.deltaMission && <Col><Tag style={{ margin: 0 }}>{order.customFields.deltaMission}</Tag></Col>}
              {order.customFields?.deltaCount && <Col><Tag style={{ margin: 0 }}>{order.customFields.deltaCount}</Tag></Col>}
              {order.customer?.customerCode && <Col><Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>👤{order.customer.customerCode}</Text></Col>}
              {(order.customFields?.customerSource || order.customer?.platform) && <Col><Tag color="orange" style={{ margin: 0 }}>📡{order.customFields?.customerSource || order.customer?.platform}</Tag></Col>}
              {order.customFields?.deltaNote && <Col><Text type="warning" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>📝{order.customFields.deltaNote}</Text></Col>}
              {order.customFields?.billingMode && <Col><Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{order.customFields.billingMode === 'round' ? '局' : '时'}</Text></Col>}
              <Col flex="auto" />
              <Col>
                <Space size={6}>
                  <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>📋{order.csUser?.username || '-'}</Text>
                  <Badge count={unreadMap[user?.companionId || order.id] || 0} size="small" offset={[-4, 0]}
                    style={{ boxShadow: '0 0 8px #FF0000' }}>
                    <Button size="small" icon={React.createElement(MessageOutlined)} onClick={() => openChat(order)}
                      style={unreadMap[user?.companionId || order.id] ? { background: '#FFF1F0', borderColor: '#FF4D4F', color: '#FF4D4F', animation: 'msg-pulse 1s ease-in-out infinite' } : undefined}>
                      沟通
                    </Button>
                  </Badge>
                  <Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{React.createElement(ClockCircleOutlined)} {new Date(order.createdAt).toLocaleTimeString()}</Text>
                  <Button type="primary" size="small" danger
                    disabled={!isUnlocked}
                    loading={grabbing === user?.companionId || order.id}
                    onClick={() => handleGrab(user?.companionId || order.id)}>
                    {isUnlocked ? '抢单' : `还差¥${Math.round((threshold - todayRevenue) * 100) / 100}`}
                  </Button>
                </Space>
              </Col>
            </Row>
          </Card>
        ))}
      </div>

      <Card size="small" style={{ marginTop: 16 }}>
        <Text type="secondary">💡 抢单后可见客户联系方式和来源账号ID</Text>
      </Card>

      {/* Chat Modal */}
      <ChatModal open={!!chatPartner} partner={chatPartner} onClose={() => setChatPartner(null)} />
    </div>
  );
};

export default PoolPage;
