import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Button, Typography, Tag, Row, Col, Select, Spin, message, Empty, Progress, Space, Badge, Modal, Divider } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { ClockCircleOutlined, MessageOutlined } from '@ant-design/icons';
import { ordersApi } from '../../api/orders';
import { companionsApi } from '../../api/companions';
import { useSocket } from '../../hooks/useSocket';
import ChatModal from '../../components/ChatModal';
import CreateOrderModal from '../../components/CreateOrderModal';
import { useAuthStore } from '../../stores/authStore';

import { orderTypeConfig } from '../../constants/orders';

const { Text, Title } = Typography;

const PoolPage: React.FC = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const user = useAuthStore(s => s.user);
  const navigate = useNavigate();
  const [poolStatus, setPoolStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [grabbing, setGrabbing] = useState<string | null>(null);
  const [grabbedOrder, setGrabbedOrder] = useState<any>(null);
  const [workWechats, setWorkWechats] = useState<any[]>([]);
  const [selectedWechat, setSelectedWechat] = useState<string>('');

  const [unreadMap, setUnreadMap] = useState<Record<string, number>>({});
  const [createOpen, setCreateOpen] = useState(false);

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
  const [chatPartner, setChatPartner] = useState<{ name: string; avatar?: string; orderId: string; orderInfo?: string } | null>(null);

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
      const { data } = await ordersApi.grab(orderId);
      useAuthStore.getState().setGrabbedOrder(data.data);
      navigate('/companion/orders');
      // Fetch work wechats
      try { const { data: wx } = await companionsApi.listWorkWechats() || {}; setWorkWechats(wx?.data || []); } catch { setWorkWechats([]); }
      fetchData();
    } catch (e: any) {
      message.error(e?.response?.data?.message ?? '抢单失败');
    } finally {
      setGrabbing(null);
    }
  };

  // Chat handlers
  const openChat = (order: any) => {
    // Clear unread badge — both per-order and companion-level
    localStorage.removeItem(`unread-${order.id}`);
    localStorage.removeItem(`unread-${user?.companionId || ''}`);
    setUnreadMap(prev => { const { [user?.companionId || order.id]: _, ...rest } = prev; return rest; });
    setChatPartner({
      name: order.csUser?.displayName || order.csUser?.username || '未知',
      avatar: order.csUser?.avatar || null,
      orderId: order.id,
      orderInfo: [
        `📋 ${order.gameName}`,
        `${order.type === 'NEW' ? '首单' : order.type === 'RENEW' ? '续费' : order.type === 'REPURCHASE' ? '复购' : order.type}`,
        `¥${Number(order.amount).toFixed(2)}`,
        order.duration ? `${order.duration}h` : '',
        order.customFields?.billingMode === 'round' ? '按局' : '',
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Title level={4} style={{ margin: 0 }}>📦 订单池</Title>
        <Button type="primary" icon={React.createElement(PlusOutlined)} onClick={() => setCreateOpen(true)}>发布订单</Button>
      </div>

      <Card size="small" style={{ marginBottom: 12, background: isUnlocked ? '#f6ffed' : '#fff7e6' }}>
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
              {order.customFields?.deltaMission && <Col><Tag style={{ margin: 0 }}>{order.customFields.deltaMission}</Tag></Col>}
              {order.customFields?.deltaCount && <Col><Tag style={{ margin: 0 }}>{order.customFields.deltaCount}</Tag></Col>}
              {order.customer?.customerCode && <Col><Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>👤{order.customer.customerCode}</Text></Col>}
              {(order.customFields?.customerSource || order.customer?.platform) && <Col><Tag color="orange" style={{ margin: 0 }}>📡{order.customFields?.customerSource || order.customer?.platform}</Tag></Col>}
              {order.customFields?.deltaNote && <Col><Text type="warning" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>📝{order.customFields.deltaNote}</Text></Col>}
              {order.customFields?.urgency === 'later' && <Col><Tag color="purple" style={{ margin: 0 }}>📅预约</Tag></Col>}
              {order.customFields?.urgency !== 'later' && <Col><Tag color="green" style={{ margin: 0 }}>⚡立即打</Tag></Col>}
              <Col><Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>发布:{order.csUser?.username || order.customFields?.createdBy || '未知'}</Text></Col>
              {order.companionId && <Col><Tag color="red" style={{ margin: 0, fontWeight: 600 }}>该订单客服指定给你接</Tag></Col>}
              {order.customFields?.billingMode === 'round'
                ? <Col><Text type="secondary" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>🎯{order.duration || order.customFields?.deltaCount || '?'}局</Text></Col>
                : order.duration && <Col><Text type="secondary" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>⏱{order.duration}h</Text></Col>
              }
              <Col flex="auto" />
              <Col>
                <Space size={6}>
                  <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>📋{order.csUser?.username || '-'}</Text>
                  <Badge count={unreadMap[order.id] || 0} size="small" offset={[-4, 0]}>
                    <Button size="small" icon={React.createElement(MessageOutlined)} onClick={() => openChat(order)}
                      className={(unreadMap[order.id] || 0) > 0 ? 'pulse-badge' : ''}>
                      沟通
                    </Button>
                  </Badge>
                  <Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{React.createElement(ClockCircleOutlined)} {(()=>{const d=new Date(order.createdAt);return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`})()}</Text>
                  <Button type="primary" size="small" danger
                    disabled={!isUnlocked && order.csUser?.role !== 'COMPANION'}
                    loading={grabbing === order.id}
                    onClick={() => handleGrab(order.id)}>
                    {(!isUnlocked && order.csUser?.role !== 'COMPANION') ? `还差¥${Math.round((threshold - todayRevenue) * 100) / 100}` : '抢单'}
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

      <CreateOrderModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={fetchData} userId={(user as any)?.id}/>
      {/* Grab Success Modal */}
      <Modal title="抢单成功" open={!!grabbedOrder} onCancel={() => setGrabbedOrder(null)} footer={null} width={480}>
        {grabbedOrder && <div style={{ fontSize: 14, lineHeight: 2 }}>
          <div>📋 {grabbedOrder.gameName} · {orderTypeConfig[grabbedOrder.type]?.label || grabbedOrder.type} · ¥{Number(grabbedOrder.amount).toFixed(0)} · {grabbedOrder.duration}h</div>
          {grabbedOrder.customer?.customerCode && <div>客户编号：{grabbedOrder.customer.customerCode}</div>}
          {grabbedOrder.customFields?.customerSource && <div>来源：{grabbedOrder.customFields.customerSource}</div>}
          {grabbedOrder.csUser?.username && <div>发布者：{grabbedOrder.csUser.username}</div>}
          {grabbedOrder.customFields?.urgency === 'later' && <Tag color="purple">📅预约</Tag>}
          {grabbedOrder.customFields?.urgency !== 'later' && <Tag color="green">⚡立即打</Tag>}
          <Divider style={{ margin: '8px 0' }} />
          <div><strong>📞 联系方式（可复制）：</strong></div>
          {grabbedOrder.customFields?.customerWechat && <div>微信：<Text copyable style={{ color: '#1677ff' }}>{grabbedOrder.customFields.customerWechat}</Text></div>}
          {grabbedOrder.customFields?.customerRoomCode && <div>房间码：<Text copyable style={{ color: '#1677ff' }}>{grabbedOrder.customFields.customerRoomCode}</Text></div>}
          {grabbedOrder.customFields?.customerPlatformAccount && <div>平台账号/YY/KOOK：<Text copyable style={{ color: '#1677ff' }}>{grabbedOrder.customFields.customerPlatformAccount}</Text></div>}
          <Divider style={{ margin: '8px 0' }} />
          <div><strong>📱 选择加客户使用的工作微信：</strong></div>
          <Select placeholder="选择工作微信" value={selectedWechat || undefined} onChange={(v) => setSelectedWechat(v)} style={{ width: '100%', marginTop: 8 }} allowClear>
            {workWechats.map((w: any) => <Select.Option key={w.id} value={w.id}>{w.wechatId}{w.companion ? ` (${w.companion?.user?.username || w.companionId})` : ''}</Select.Option>)}
          </Select>
          <Button type="primary" block style={{ marginTop: 12 }} disabled={!selectedWechat} onClick={async () => {
            if (!selectedWechat) return;
            try {
              const wxInfo = workWechats.find((w: any) => w.id === selectedWechat);
              await ordersApi.updateContact(grabbedOrder.id, { workWechatId: selectedWechat, workWechatName: wxInfo?.wechatId || '' });
              const wx = workWechats.find((w: any) => w.id === selectedWechat);
              message.success(`已标记使用微信: ${wx?.wechatId || selectedWechat}`);
            } catch { message.error('保存失败'); }
            setGrabbedOrder(null);
          }}>确认使用该微信</Button>
        </div>}
      </Modal>
      {/* Chat Modal */}
      <ChatModal open={!!chatPartner} partner={chatPartner} onClose={() => setChatPartner(null)} />
    </div>
  );
};

export default PoolPage;
