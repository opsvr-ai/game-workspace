// craftsman-ignore: TS001,TS002
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Button, Typography, Tag, Row, Col, message, Progress, Space, Badge } from 'antd';
import { PlusOutlined, ReloadOutlined, ClockCircleOutlined, MessageOutlined } from '@ant-design/icons';
import { ordersApi } from '../api/orders';
import { useSocket } from '../hooks/useSocket';
import { useAuthStore } from '../stores/authStore';
import { useOrderStore } from '../stores/orderStore';
import ChatModal from '../components/ChatModal';
import CreateOrderModal from '../components/CreateOrderModal';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import CardSkeleton from '../components/CardSkeleton';

import { orderTypeConfig, serviceTypeConfig } from '../constants/orders';

const { Text } = Typography;

const OrderPoolPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const role = user?.role;

  const isCompanion = role === 'COMPANION';
  const navigate = useNavigate();

  const [orders, setOrders] = useState<any[]>([]);
  const [poolStatus, setPoolStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [grabbing, setGrabbing] = useState<string | null>(null);

  // Order-level unread tracking (populated via WebSocket order events, not localStorage)
  const [unreadMap, setUnreadMap] = useState<Record<string, number>>({});
  const [createOpen, setCreateOpen] = useState(false);

  // Chat state
  const [chatPartner, setChatPartner] = useState<any>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      if (isCompanion) {
        const [poolRes, statusRes] = await Promise.all([ordersApi.pool(), ordersApi.poolStatus()]);
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

  // Real-time pool updates via WebSocket
  useSocket({ onOrderPoolUpdated: fetchData });

  const handleGrab = async (orderId: string) => {
    setGrabbing(orderId);
    try {
      const { data } = await ordersApi.grab(orderId);
      useOrderStore.getState().setGrabbedOrder(data.data);
      fetchData();
      if (isCompanion) navigate('/companion/orders');
    } catch (e: any) {
      message.error(e?.response?.data?.message ?? '抢单失败');
    } finally {
      setGrabbing(null);
    }
  };

  // Chat handlers
  const openChat = (order: any) => {
    setUnreadMap((prev) => {
      const key = user?.companionId || order.id;
      const { [key]: _, ...rest } = prev;
      return rest;
    });
    setChatPartner({
      conversationId: order.csUserId,
      participant: {
        userId: order.csUserId,
        username: order.csUser?.username || '未知',
        displayName: order.csUser?.displayName,
        avatar: order.csUser?.avatar || undefined,
        role: 'CS',
      },
      orderInfo: `${order.gameName} · ¥${Number(order.amount || 0).toFixed(0)}${order.duration ? ' · ' + order.duration + 'h' : ''}`,
    });
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="📦 订单池" />
        <CardSkeleton lines={6} />
      </div>
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
          <Tag color={orderTypeConfig[order.type]?.color || 'blue'} style={{ margin: 0 }}>
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
        {order.customFields?.deltaMission && (
          <Col>
            <Tag style={{ margin: 0 }}>{order.customFields.deltaMission}</Tag>
          </Col>
        )}
        {order.customFields?.deltaCount && (
          <Col>
            <Tag style={{ margin: 0 }}>{order.customFields.deltaCount}</Tag>
          </Col>
        )}
        {order.customFields?.serviceType && (
          <Col>
            <Tag color={serviceTypeConfig[order.customFields.serviceType]?.color} style={{ margin: 0 }}>
              {serviceTypeConfig[order.customFields.serviceType]?.label || order.customFields.serviceType}
            </Tag>
          </Col>
        )}
        {order.customFields?.gameMode && (
          <Col>
            <Tag color="geekblue" style={{ margin: 0 }}>
              {order.customFields.gameMode}
            </Tag>
          </Col>
        )}
        {order.customer?.customerCode && (
          <Col>
            <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
              👤{order.customer.customerCode}
            </Text>
          </Col>
        )}
        {(order.customFields?.customerSource || order.customer?.platform) && (
          <Col>
            <Tag color="orange" style={{ margin: 0 }}>
              📡
              {order.customFields?.customerSource || order.customer?.platform}
            </Tag>
          </Col>
        )}
        {order.customFields?.customerWechat && (
          <Col>
            <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
              💬{order.customFields.customerWechat}
            </Text>
          </Col>
        )}
        {order.customFields?.deltaNote && (
          <Col>
            <Text type="warning" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
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
            <Text type="secondary" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
              🎯{order.duration || order.customFields?.deltaCount || '?'}局
            </Text>
          </Col>
        ) : (
          order.duration && (
            <Col>
              <Text type="secondary" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
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
              <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                📋{order.csUser?.username || '-'}
              </Text>
              <Badge count={unreadMap[order.id] || 0} size="small" offset={[-4, 0]}>
                <Button
                  size="small"
                  icon={React.createElement(MessageOutlined)}
                  onClick={() => openChat(order)}
                  className={(unreadMap[order.id] || 0) > 0 ? 'pulse-badge' : ''}
                >
                  沟通
                </Button>
              </Badge>
              <Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
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
                disabled={!isUnlocked && order.csUser?.role !== 'COMPANION'}
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
              <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                发布:
                {order.csUser?.username || order.customFields?.createdBy || '未知'}
              </Text>
              <Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                {React.createElement(ClockCircleOutlined)} {new Date(order.createdAt).toLocaleDateString('zh-CN')}{' '}
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
      <PageHeader
        title="📦 订单池"
        extra={
          <Space>
            <Button type="primary" icon={React.createElement(PlusOutlined)} onClick={() => setCreateOpen(true)}>
              发布订单
            </Button>
            <Button icon={React.createElement(ReloadOutlined)} onClick={fetchData} loading={loading}>
              刷新
            </Button>
          </Space>
        }
      />

      {/* Companion: unlock threshold card */}
      {isCompanion && poolStatus && (
        <Card
          size="small"
          style={{
            marginBottom: 12,
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
              <Tag color={isUnlocked ? 'success' : 'warning'} style={{ fontSize: 14, padding: '4px 12px' }}>
                {isUnlocked ? '✅ 可抢单' : `还差 ¥${Math.round((threshold - todayRevenue) * 100) / 100}`}
              </Tag>
            </Col>
          </Row>
          {!isUnlocked && <Progress percent={pct} size="small" style={{ marginTop: 8 }} />}
        </Card>
      )}

      {orders.length === 0 && <EmptyState description="暂无待派订单" />}

      {/* Horizontal order rows — all info in one row */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {orders.map((order: any, idx: number) => renderPoolCard(order, idx))}
      </div>

      {isCompanion && (
        <Card size="small" style={{ marginTop: 16 }}>
          <Text type="secondary">💡 抢单后可见客户联系方式和来源账号ID</Text>
        </Card>
      )}

      {/* Create Order Modal */}
      <CreateOrderModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={fetchData}
        userId={(user as any)?.id}
      />

      {/* Chat Modal */}
      <ChatModal open={!!chatPartner} partner={chatPartner} onClose={() => setChatPartner(null)} />
    </div>
  );
};

export default OrderPoolPage;
