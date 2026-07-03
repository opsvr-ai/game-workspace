import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Button,
  Typography,
  Tag,
  Row,
  Col,
  Spin,
  message,
  Empty,
  Progress,
  Space,
  Badge,
  Modal,
  Divider,
} from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  ClockCircleOutlined,
  MessageOutlined,
} from '@ant-design/icons';
import { ordersApi } from '../api/orders';
import { useSocket } from '../hooks/useSocket';
import { useAuthStore } from '../stores/authStore';
import ChatModal from '../components/ChatModal';
import CreateOrderModal from '../components/CreateOrderModal';

const { Text, Title } = Typography;

const orderTypeConfig: Record<string, { label: string; color: string }> = {
  NEW: { label: '首单', color: 'green' },
  RENEW: { label: '续单', color: 'orange' },
  REPURCHASE: { label: '复购', color: 'blue' },
  TIP: { label: '打赏', color: 'purple' },
};

const OrderPoolPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const role = user?.role;

  const isCompanion = role === 'COMPANION';
  const isAdmin = role === 'ADMIN' || role === 'OWNER';

  const [orders, setOrders] = useState<any[]>([]);
  const [poolStatus, setPoolStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [grabbing, setGrabbing] = useState<string | null>(null);
  const [grabbedOrder, setGrabbedOrder] = useState<any>(null);

  const [unreadMap, setUnreadMap] = useState<Record<string, number>>({});
  const [createOpen, setCreateOpen] = useState(false);

  // Read unread counts from localStorage on mount + periodically
  useEffect(() => {
    const read = () => {
      const map: Record<string, number> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith('unread-')) {
          map[k.replace('unread-', '')] = parseInt(
            localStorage.getItem(k) || '0',
            10,
          );
        }
      }
      setUnreadMap(map);
    };
    read();
    const t = setInterval(read, 2000);
    return () => clearInterval(t);
  }, []);

  // Chat state
  const [chatPartner, setChatPartner] = useState<{
    name: string;
    avatar?: string;
    orderId: string;
    orderInfo?: string;
  } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      if (isCompanion) {
        const [poolRes, statusRes] = await Promise.all([
          ordersApi.pool(),
          ordersApi.poolStatus(),
        ]);
        setOrders(poolRes.data.data ?? []);
        setPoolStatus(statusRes.data.data);
      } else {
        const { data } = await ordersApi.pool();
        setOrders(data.data ?? []);
      }
    } catch (e) {
      console.error('Pool fetch error', e);
      message.error('加载订单池失败');
    } finally {
      setLoading(false);
    }
  }, [isCompanion]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Assignment invitation
  const [inviteModal, setInviteModal] = useState(false);
  const [inviteOrder, setInviteOrder] = useState<any>(null);
  const inviteTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleAcceptInvite = async () => {
    if (!inviteOrder) return;
    try { await ordersApi.acceptAssignment(inviteOrder.id); message.success('已接单'); setInviteModal(false); fetchData(); }
    catch (e: any) { message.error(e?.response?.data?.message || '操作失败'); }
  };
  const handleDeclineInvite = async () => {
    if (!inviteOrder) return;
    try { await ordersApi.declineAssignment(inviteOrder.id); message.success('已拒绝'); setInviteModal(false); fetchData(); }
    catch (e: any) { message.error(e?.response?.data?.message || '操作失败'); }
  };

  // Real-time pool updates via WebSocket
  useSocket({
    onOrderPoolUpdated: fetchData,
    onOrderNew: (data: any) => {
      if (isCompanion && data._isAssignment) {
        setInviteOrder(data); setInviteModal(true);
        if (inviteTimer.current) clearTimeout(inviteTimer.current);
        inviteTimer.current = setTimeout(() => { setInviteModal(false); setInviteOrder(null); }, 15000);
      }
    },
  });

  const handleGrab = async (orderId: string) => {
    setGrabbing(orderId);
    try {
      const { data } = await ordersApi.grab(orderId);
      setGrabbedOrder(data.data);
      fetchData();
    } catch (e: any) {
      message.error(e?.response?.data?.message ?? '抢单失败');
    } finally {
      setGrabbing(null);
    }
  };

  // Chat handlers
  const openChat = (order: any) => {
    localStorage.removeItem(`unread-${order.id}`);
    localStorage.removeItem(`unread-${user?.companionId || ''}`);
    setUnreadMap((prev) => {
      const {
        [user?.companionId || order.id]: _,
        ...rest
      } = prev;
      return rest;
    });
    setChatPartner({
      name: order.csUser?.displayName || order.csUser?.username || '未知',
      avatar: order.csUser?.avatar || null,
      orderId: order.id,
      orderInfo: [
        `📋 ${order.gameName}`,
        `${
          order.type === 'NEW'
            ? '首单'
            : order.type === 'RENEW'
              ? '续费'
              : order.type === 'REPURCHASE'
                ? '复购'
                : order.type
        }`,
        `¥${Number(order.amount).toFixed(2)}`,
        order.duration ? `${order.duration}h` : '',
        order.customFields?.billingMode === 'round' ? '按局' : '',
        order.customFields?.deltaMode
          ? `🎯${order.customFields.deltaMode}`
          : '',
        order.customer?.customerCode
          ? `👤${order.customer.customerCode}`
          : '',
        order.csUser?.username ? `💬${order.csUser.username}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
    });
  };

  if (loading) {
    return (
      <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />
    );
  }

  const isUnlocked = poolStatus?.isUnlocked ?? false;
  const todayRevenue = poolStatus?.todayRevenue ?? 0;
  const threshold = poolStatus?.threshold ?? 100;
  const pct = Math.min(Math.round((todayRevenue / threshold) * 100), 100);

  // Render a single pool card row
  const renderPoolCard = (order: any, idx: number) => (
    <Card
      key={order.id}
      size="small"
      style={{
        borderLeft: `3px solid ${orderTypeConfig[order.type]?.color || '#1677ff'}`,
      }}
    >
      <Row align="middle" gutter={8} wrap={false}>
        <Col>
          <Tag
            style={{
              background: '#f0f0f0',
              color: '#666',
              fontWeight: 700,
              minWidth: 24,
              textAlign: 'center',
              margin: 0,
            }}
          >
            {idx + 1}
          </Tag>
        </Col>
        <Col>
          <Tag
            color={orderTypeConfig[order.type]?.color || 'blue'}
            style={{ margin: 0 }}
          >
            {orderTypeConfig[order.type]?.label || order.type}
          </Tag>
        </Col>
        <Col>
          <Text strong style={{ fontSize: 14, whiteSpace: 'nowrap' }}>
            {order.gameName}
          </Text>
        </Col>
        <Col>
          <Text
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: '#1677ff',
              whiteSpace: 'nowrap',
            }}
          >
            ¥{Number(order.amount).toFixed(0)}
          </Text>
        </Col>
        {order.customFields?.deltaMode && (
          <Col>
            <Tag color="cyan" style={{ margin: 0 }}>
              {order.customFields.deltaMode}
            </Tag>
          </Col>
        )}
        {order.customFields?.deltaMission && (
          <Col>
            <Tag style={{ margin: 0 }}>
              {order.customFields.deltaMission}
            </Tag>
          </Col>
        )}
        {order.customFields?.deltaCount && (
          <Col>
            <Tag style={{ margin: 0 }}>
              {order.customFields.deltaCount}
            </Tag>
          </Col>
        )}
        {order.customer?.customerCode && (
          <Col>
            <Text
              type="secondary"
              style={{ fontSize: 12, whiteSpace: 'nowrap' }}
            >
              👤{order.customer.customerCode}
            </Text>
          </Col>
        )}
        {(order.customFields?.customerSource ||
          order.customer?.platform) && (
          <Col>
            <Tag color="orange" style={{ margin: 0 }}>
              📡
              {order.customFields?.customerSource ||
                order.customer?.platform}
            </Tag>
          </Col>
        )}
        {order.customFields?.customerWechat && (
          <Col>
            <Text
              type="secondary"
              style={{ fontSize: 12, whiteSpace: 'nowrap' }}
            >
              💬{order.customFields.customerWechat}
            </Text>
          </Col>
        )}
        {order.customFields?.deltaNote && (
          <Col>
            <Text
              type="warning"
              style={{ fontSize: 11, whiteSpace: 'nowrap' }}
            >
              📝{order.customFields.deltaNote}
            </Text>
          </Col>
        )}
        {order.customFields?.urgency === 'later' && (
          <Col>
            <Tag color="purple" style={{ margin: 0 }}>
              📅预约
            </Tag>
          </Col>
        )}
        {order.customFields?.urgency !== 'later' && (
          <Col>
            <Tag color="green" style={{ margin: 0 }}>
              ⚡立即打
            </Tag>
          </Col>
        )}
        {order.customFields?.billingMode === 'round' ? (
          <Col>
            <Text
              type="secondary"
              style={{ fontSize: 13, whiteSpace: 'nowrap' }}
            >
              🎯{order.duration || order.customFields?.deltaCount || '?'}局
            </Text>
          </Col>
        ) : (
          order.duration && (
            <Col>
              <Text
                type="secondary"
                style={{ fontSize: 13, whiteSpace: 'nowrap' }}
              >
                ⏱{order.duration}h
              </Text>
            </Col>
          )
        )}
        <Col flex="auto" />
        <Col>
          {isCompanion ? (
            <Space size={6}>
              {order.companionId && (
                <Tag color="red" style={{ margin: 0, fontWeight: 600 }}>
                  该订单客服指定给你接
                </Tag>
              )}
              <Text
                type="secondary"
                style={{ fontSize: 12, whiteSpace: 'nowrap' }}
              >
                📋{order.csUser?.username || '-'}
              </Text>
              <Badge
                count={unreadMap[order.id] || 0}
                size="small"
                offset={[-4, 0]}
              >
                <Button
                  size="small"
                  icon={React.createElement(MessageOutlined)}
                  onClick={() => openChat(order)}
                  className={
                    (unreadMap[order.id] || 0) > 0 ? 'pulse-badge' : ''
                  }
                >
                  沟通
                </Button>
              </Badge>
              <Text
                type="secondary"
                style={{ fontSize: 11, whiteSpace: 'nowrap' }}
              >
                {React.createElement(ClockCircleOutlined)}{' '}
                {(() => {
                  const d = new Date(order.createdAt);
                  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                })()}
              </Text>
              <Button
                type="primary"
                size="small"
                danger
                disabled={
                  !isUnlocked && order.csUser?.role !== 'COMPANION'
                }
                loading={grabbing === order.id}
                onClick={() => handleGrab(order.id)}
              >
                {!isUnlocked && order.csUser?.role !== 'COMPANION'
                  ? `还差¥${Math.round((threshold - todayRevenue) * 100) / 100}`
                  : '抢单'}
              </Button>
            </Space>
          ) : (
            <Space size={6}>
              <Text
                type="secondary"
                style={{ fontSize: 12, whiteSpace: 'nowrap' }}
              >
                发布:
                {order.csUser?.username ||
                  order.customFields?.createdBy ||
                  '未知'}
              </Text>
              <Text
                type="secondary"
                style={{ fontSize: 11, whiteSpace: 'nowrap' }}
              >
                {React.createElement(ClockCircleOutlined)}{' '}
                {new Date(order.createdAt).toLocaleDateString('zh-CN')}{' '}
                {new Date(order.createdAt).toLocaleTimeString('zh-CN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
              <Tag color="orange">待派单</Tag>
            </Space>
          )}
        </Col>
      </Row>
    </Card>
  );

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <Title level={4} style={{ margin: 0 }}>
          📦 订单池
        </Title>
        <Space>
          {isAdmin && (
            <Button
              type="primary"
              icon={React.createElement(PlusOutlined)}
              onClick={() => setCreateOpen(true)}
            >
              发布订单
            </Button>
          )}
          <Button
            icon={React.createElement(ReloadOutlined)}
            onClick={fetchData}
            loading={loading}
          >
            刷新
          </Button>
        </Space>
      </div>

      {/* Companion: unlock threshold card */}
      {isCompanion && poolStatus && (
        <Card
          size="small"
          style={{
            marginBottom: 16,
            background: isUnlocked ? '#f6ffed' : '#fff7e6',
          }}
        >
          <Row align="middle" justify="space-between">
            <Col>
              <Text strong>
                当日流水：¥{todayRevenue} ｜ 解锁门槛：¥{threshold}
                {isUnlocked ? ' ｜ 🟢 已解锁' : ' ｜ 🔒 未解锁'}
              </Text>
            </Col>
            <Col>
              <Tag
                color={isUnlocked ? 'success' : 'warning'}
                style={{ fontSize: 14, padding: '4px 12px' }}
              >
                {isUnlocked
                  ? '✅ 可抢单'
                  : `还差 ¥${Math.round((threshold - todayRevenue) * 100) / 100}`}
              </Tag>
            </Col>
          </Row>
          {!isUnlocked && (
            <Progress percent={pct} size="small" style={{ marginTop: 8 }} />
          )}
        </Card>
      )}

      {orders.length === 0 && <Empty description="暂无待派订单" />}

      {/* Horizontal order rows — all info in one row */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {orders.map((order: any, idx: number) => renderPoolCard(order, idx))}
      </div>

      {isCompanion && (
        <Card size="small" style={{ marginTop: 16 }}>
          <Text type="secondary">
            💡 抢单后可见客户联系方式和来源账号ID
          </Text>
        </Card>
      )}

      {/* Create Order Modal */}
      <CreateOrderModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={fetchData}
        userId={(user as any)?.id}
        defaultDeltaCount="双"
      />

      {/* Grab Success Modal */}
      <Modal
        title="抢单成功"
        open={!!grabbedOrder}
        onCancel={() => setGrabbedOrder(null)}
        footer={null}
        width={480}
      >
        {grabbedOrder && (
          <div style={{ fontSize: 14, lineHeight: 2 }}>
            <div>
              📋 {grabbedOrder.gameName} ·{' '}
              {orderTypeConfig[grabbedOrder.type]?.label ||
                grabbedOrder.type}{' '}
              · ¥{Number(grabbedOrder.amount).toFixed(0)} ·{' '}
              {grabbedOrder.duration}h
            </div>
            {grabbedOrder.customer?.customerCode && (
              <div>客户编号：{grabbedOrder.customer.customerCode}</div>
            )}
            {grabbedOrder.customFields?.customerSource && (
              <div>来源：{grabbedOrder.customFields.customerSource}</div>
            )}
            {grabbedOrder.csUser?.username && (
              <div>发布者：{grabbedOrder.csUser.username}</div>
            )}
            {grabbedOrder.customFields?.urgency === 'later' && (
              <Tag color="purple">📅预约</Tag>
            )}
            {grabbedOrder.customFields?.urgency !== 'later' && (
              <Tag color="green">⚡立即打</Tag>
            )}
            {grabbedOrder.customFields?.deltaMode && (
              <div>
                模式：{grabbedOrder.customFields.deltaMode}{' '}
                {grabbedOrder.customFields.deltaMission || ''}{' '}
                {grabbedOrder.customFields.deltaCount || ''}
              </div>
            )}
            <Divider style={{ margin: '8px 0' }} />
            <div>
              <strong>📞 联系方式（可复制）：</strong>
            </div>
            {grabbedOrder.customFields?.customerWechat && (
              <div>
                微信：
                <Text copyable style={{ color: '#1677ff' }}>
                  {grabbedOrder.customFields.customerWechat}
                </Text>
              </div>
            )}
            {grabbedOrder.customFields?.customerRoomCode && (
              <div>
                房间码：
                <Text copyable style={{ color: '#1677ff' }}>
                  {grabbedOrder.customFields.customerRoomCode}
                </Text>
              </div>
            )}
            {grabbedOrder.customFields?.customerPlatformAccount && (
              <div>
                平台账号/YY/KOOK：
                <Text copyable style={{ color: '#1677ff' }}>
                  {grabbedOrder.customFields.customerPlatformAccount}
                </Text>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Chat Modal */}
      <ChatModal open={!!chatPartner} partner={chatPartner} onClose={() => setChatPartner(null)} />

      {/* Assignment Invitation — bottom-right popup */}
      {inviteOrder && (
        <div style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 1050,
          background: '#FFF', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
          padding: 20, minWidth: 320, maxWidth: 380,
          borderLeft: '4px solid #7B61FF',
        }}>
          <Text strong style={{ fontSize: 15 }}>📋 {inviteOrder._inviterName || '客服'} 邀请你共同接单</Text>
          <div style={{ marginTop: 10, lineHeight: 1.8 }}>
            <div>🎮 游戏：<Text strong>{inviteOrder.gameName}</Text> · <Text strong style={{ color: '#FF4757' }}>¥{Number(inviteOrder.amount).toFixed(0)}</Text></div>
            {inviteOrder.customFields?.deltaMode && <div>🎯 模式：{inviteOrder.customFields.deltaMode} {inviteOrder.customFields.deltaMission || ''} {inviteOrder.customFields.deltaCount || ''}</div>}
          </div>
          <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
            <Button danger size="small" onClick={handleDeclineInvite} style={{ flex: 1 }}>拒绝</Button>
            <Button type="primary" size="small" onClick={handleAcceptInvite} style={{ flex: 1 }}>接单</Button>
          </div>
          <Text type="secondary" style={{ fontSize: 10, display: 'block', marginTop: 6 }}>⏱ 15 秒后自动消失</Text>
        </div>
      )}
      {inviteModal && !inviteOrder && null}{/* keep inviteModal state for cleanup */}
    </div>
  );
};

export default OrderPoolPage;
