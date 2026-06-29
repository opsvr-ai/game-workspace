import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Button, Typography, Tag, Row, Col, Spin, message, Empty, Progress, Space, Modal, Input } from 'antd';
import { ClockCircleOutlined, MessageOutlined } from '@ant-design/icons';
import { ordersApi } from '../../api/orders';
import http from '../../api/client';
import { useAuthStore } from '../../stores/authStore';

const { Text, Title } = Typography;

const orderTypeConfig: Record<string, { label: string; color: string }> = {
  NEW: { label: '新单', color: 'green' },
  RENEW: { label: '续单', color: 'orange' },
  REPURCHASE: { label: '复购', color: 'blue' },
  TIP: { label: '打赏', color: 'purple' },
};

const PoolPage: React.FC = () => {
  const user = useAuthStore(s => s.user);
  const [orders, setOrders] = useState<any[]>([]);
  const [poolStatus, setPoolStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [grabbing, setGrabbing] = useState<string | null>(null);
  const [grabbedOrder, setGrabbedOrder] = useState<any>(null);
  const [grabbedModal, setGrabbedModal] = useState(false);

  // Chat state
  const [chatOrder, setChatOrder] = useState<any>(null);
  const [chatMessages, setChatMessages] = useState<{ text: string; time: string; from: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const chatRef = useRef<HTMLDivElement>(null);

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

  const handleGrab = async (orderId: string) => {
    setGrabbing(orderId);
    try {
      const { data } = await ordersApi.grab(orderId);
      // Show grabbed order detail modal with contact info
      setGrabbedOrder(data.data);
      setGrabbedModal(true);
      fetchData();
    } catch (e: any) {
      message.error(e?.response?.data?.message ?? '抢单失败');
    } finally {
      setGrabbing(null);
    }
  };

  // Chat handlers
  const openChat = (order: any) => {
    setChatOrder(order);
    setChatMessages([]);
    setChatInput('');
    useAuthStore.getState().setChatActive(true);
  };

  const closeChat = () => {
    setChatOrder(null);
    setChatMessages([]);
    setChatInput('');
    useAuthStore.getState().setChatActive(false);
  };

  const sendChat = async () => {
    const val = chatInput.trim();
    if (!val) return;
    const now = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    setChatMessages(prev => [...prev, { text: val, time: now, from: 'me' }]);
    setChatInput('');
    if (chatOrder?.id) {
      http.post('/companions/chat-notify', { orderId: chatOrder.id, message: val }).catch(() => {});
    }
    setTimeout(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, 50);
  };

  // Poll chat from CS
  useEffect(() => {
    if (!chatOrder?.id) return;
    const timer = setInterval(async () => {
      try {
        const { data } = await http.get(`/companions/chat-pending?orderId=${chatOrder.id}`);
        const msgs = data.data ?? [];
        if (Array.isArray(msgs) && msgs.length > 0) {
          setChatMessages(prev => {
            const existing = new Set(prev.map(m => m.text + m.time));
            const news = msgs.filter((m: any) => !existing.has(m.text + m.time));
            if (news.length === 0) return prev;
            return [...prev, ...news.map((m: any) => ({ text: m.text || m.message, time: m.time || new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }), from: 'them' }))];
          });
          setTimeout(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, 50);
        }
      } catch {}
    }, 3000);
    return () => clearInterval(timer);
  }, [chatOrder?.id]);

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
          <Card key={order.id} size="small"
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
                  <Button size="small" icon={React.createElement(MessageOutlined)} onClick={() => openChat(order)}>沟通</Button>
                  <Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{React.createElement(ClockCircleOutlined)} {new Date(order.createdAt).toLocaleTimeString()}</Text>
                  <Button type="primary" size="small" danger
                    disabled={!isUnlocked}
                    loading={grabbing === order.id}
                    onClick={() => handleGrab(order.id)}>
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
      <Modal title={null} open={!!chatOrder} onCancel={closeChat} footer={null}
        width={440} style={{ top: 20 }} bodyStyle={{ padding: 0 }}>
        {chatOrder && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '65vh', maxHeight: 550 }}>
            <div style={{ background: '#EDEDED', padding: '10px 16px', borderBottom: '1px solid #D9D9D9' }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#1E293B', textAlign: 'center' }}>
                💬 {chatOrder.csUser?.username || '客服'}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', fontSize: 11, color: '#8E8E93', marginTop: 4, justifyContent: 'center' }}>
                <span>📋 {chatOrder.gameName}</span>
                <span>· {orderTypeConfig[chatOrder.type]?.label}</span>
                <span>· ¥{Number(chatOrder.amount).toFixed(2)}</span>
                <span>· ⏱{chatOrder.duration || '-'}h</span>
                {chatOrder.customFields?.deltaMode && <span>· {chatOrder.customFields.deltaMode}</span>}
                {chatOrder.customFields?.deltaMission && <span>· {chatOrder.customFields.deltaMission}</span>}
                {chatOrder.customFields?.deltaCount && <span>· {chatOrder.customFields.deltaCount}</span>}
                {chatOrder.customFields?.deltaNote && <span>· 📝{chatOrder.customFields.deltaNote}</span>}
              </div>
            </div>
            <div ref={chatRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', background: '#EDEDED' }}>
              {chatMessages.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#8E8E93', fontSize: 13, marginTop: 60 }}>
                  发送消息开始对话
                </div>
              ) : (
                chatMessages.map((msg, i) => {
                  const isMe = msg.from === 'me';
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 12,
                      flexDirection: isMe ? 'row-reverse' : 'row' }}>
                      <div style={{ width: 32, height: 32, borderRadius: 4, flexShrink: 0,
                        background: isMe ? '#95EC69' : '#FFF', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: 700, color: isMe ? '#FFF' : '#07C160',
                        marginLeft: isMe ? 8 : 0, marginRight: isMe ? 0 : 8 }}>
                        {(isMe ? (user?.username || '我') : (chatOrder.csUser?.username || '?')).charAt(0).toUpperCase()}
                      </div>
                      <div style={{ maxWidth: '70%' }}>
                        <div style={{ fontSize: 10, color: '#B0B0B0', marginBottom: 2, textAlign: isMe ? 'right' : 'left' }}>{msg.time}</div>
                        <div style={{ padding: '8px 12px', borderRadius: 4, fontSize: 14, lineHeight: 1.4, wordBreak: 'break-word',
                          background: isMe ? '#95EC69' : '#FFF', color: '#1E293B' }}>{msg.text}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div style={{ borderTop: '1px solid #D9D9D9', padding: '8px 12px', display: 'flex', gap: 8, background: '#F5F5F5' }}>
              <Input value={chatInput} onChange={e => setChatInput(e.target.value)}
                onPressEnter={sendChat} placeholder="输入消息..."
                style={{ borderRadius: 4 }} />
              <Button type="primary" onClick={sendChat}>发送</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Grabbed Order Success Modal */}
      <Modal title="✅ 抢单成功" open={grabbedModal} onCancel={() => setGrabbedModal(false)}
        footer={<Button type="primary" size="large" onClick={() => {
          const info = [`微信：${grabbedOrder?.customFields?.customerWechat || '暂无'}`,
            `客户编号：${grabbedOrder?.customer?.customerCode || ''}`,
            `来源：${grabbedOrder?.customFields?.customerSource || ''} ${grabbedOrder?.customFields?.customerPlatformAccount || ''}`,
            grabbedOrder?.customFields?.customerRoomCode ? `房间码：${grabbedOrder.customFields.customerRoomCode}` : '',
            `游戏：${grabbedOrder?.gameName} ¥${Number(grabbedOrder?.amount).toFixed(0)}`];
          navigator.clipboard.writeText(info.filter(Boolean).join('\n')).then(() => {
            message.success('客户信息已复制到剪贴板 ✅');
          }).catch(() => {
            message.info('请手动记录客户信息');
          });
          setGrabbedModal(false);
        }}>知道了，马上去联系</Button>} width={440}>
        {grabbedOrder && (
          <div style={{ fontSize: 14, lineHeight: 2.2 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1E293B', marginBottom: 8 }}>
              {grabbedOrder.gameName} ｜ ¥{Number(grabbedOrder.amount).toFixed(0)}
            </div>
            <Row gutter={8}>
              <Col><Tag color={orderTypeConfig[grabbedOrder.type]?.color || 'blue'}>{orderTypeConfig[grabbedOrder.type]?.label || grabbedOrder.type}</Tag></Col>
              {grabbedOrder.customFields?.deltaMode && <Col><Tag color="cyan">{grabbedOrder.customFields.deltaMode}</Tag></Col>}
              {grabbedOrder.customFields?.deltaMission && <Col><Tag>{grabbedOrder.customFields.deltaMission}</Tag></Col>}
              {grabbedOrder.customFields?.deltaCount && <Col><Tag>{grabbedOrder.customFields.deltaCount}</Tag></Col>}
              {grabbedOrder.customFields?.billingMode && <Col><Text type="secondary" style={{ fontSize: 12 }}>{grabbedOrder.customFields.billingMode === 'round' ? '按局' : '按小时'}</Text></Col>}
            </Row>
            {grabbedOrder.customFields?.deltaNote && (
              <div style={{ marginTop: 8 }}><Text type="warning">📝 {grabbedOrder.customFields.deltaNote}</Text></div>
            )}
            <div style={{ background: '#FFF7E6', padding: '10px 14px', borderRadius: 8, margin: '10px 0' }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>📱 联系方式</div>
              <div>微信：<Text strong style={{ fontSize: 16 }}>{grabbedOrder.customFields?.customerWechat || '暂无'}</Text></div>
              {grabbedOrder.customer?.customerCode && <div>客户编号：{grabbedOrder.customer.customerCode}</div>}
              {grabbedOrder.customFields?.customerSource && <div>来源：{grabbedOrder.customFields.customerSource}{grabbedOrder.customFields?.customerPlatformAccount ? ` (${grabbedOrder.customFields.customerPlatformAccount})` : ''}</div>}
              {grabbedOrder.customFields?.customerRoomCode && <div>房间码：{grabbedOrder.customFields.customerRoomCode}</div>}
            </div>
            <Text type="secondary">⏰ 抢单时间：{new Date().toLocaleTimeString()} ｜ 🎮 添加微信后即可开始服务</Text>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default PoolPage;
