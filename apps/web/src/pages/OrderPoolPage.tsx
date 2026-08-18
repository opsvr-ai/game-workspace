// craftsman-ignore: TS001,TS002
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Button, Typography, Tag, Row, Col, message, Progress, Space, Badge, List, Input, Spin } from 'antd';
import { PlusOutlined, ReloadOutlined, ClockCircleOutlined, MessageOutlined } from '@ant-design/icons';
import { ordersApi } from '../api/orders';
import { companionsApi } from '../api/companions';
import { useSocket } from '../hooks/useSocket';
import { useAuthStore } from '../stores/authStore';
import { useOrderStore } from '../stores/orderStore';
import { useChatStore } from '../stores/chatStore';
import ChatModal from '../components/ChatModal';
import CreateOrderModal from '../components/CreateOrderModal';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import CardSkeleton from '../components/CardSkeleton';

import { orderTypeConfig, serviceTypeConfig } from '../constants/orders';
import { companionStatusConfig, STATUS_SORT } from '../constants/companions';

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

  // Companion sidebar state (visible to companion users)
  const [companions, setCompanions] = useState<any[]>([]);
  const [loadingCompanions, setLoadingCompanions] = useState(false);
  const [companionSearch, setCompanionSearch] = useState('');

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

  const fetchCompanions = useCallback(async () => {
    if (!isCompanion) return;
    setLoadingCompanions(true);
    try {
      const { data } = await companionsApi.list();
      setCompanions(data.data ?? []);
    } catch {
      // 自动刷新失败不打断主流程
    } finally {
      setLoadingCompanions(false);
    }
  }, [isCompanion]);

  useEffect(() => {
    if (!isCompanion) return;
    fetchCompanions();
    const timer = setInterval(fetchCompanions, 10000);
    return () => clearInterval(timer);
  }, [isCompanion, fetchCompanions]);

  const sortedCompanions = useMemo(
    () =>
      [...companions].sort(
        (a, b) => (STATUS_SORT[a.status] ?? 9) - (STATUS_SORT[b.status] ?? 9),
      ),
    [companions],
  );

  const filteredCompanions = companionSearch
    ? sortedCompanions.filter((c) => {
        const name = c.user?.displayName || c.user?.username || '';
        return name.toLowerCase().includes(companionSearch.toLowerCase());
      })
    : sortedCompanions;

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

  const openCompanionChat = async (companion: any) => {
    const u = companion.user as any;
    await useChatStore.getState().openConversation(
      companion.id,
      {
        userId: u?.id || companion.id,
        username: u?.username || companion.id,
        displayName: u?.displayName || u?.username || companion.id,
        avatar: u?.avatar,
        role: 'COMPANION',
      },
    );
    setChatPartner({
      conversationId: companion.id,
      participant: {
        userId: u?.id || companion.id,
        username: u?.username || companion.id,
        displayName: u?.displayName || u?.username || companion.id,
        avatar: u?.avatar,
        role: 'COMPANION',
      },
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

  const renderCompanionSidebar = () => (
    <Col span={3}>
      <Card
        title={<span style={{ fontSize: 13, fontWeight: 600 }}>陪玩</span>}
        size="small"
        style={{ borderRadius: 8 }}
        bodyStyle={{ padding: '8px 4px', maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}
      >
        <Input
          size="small"
          placeholder="搜索陪玩..."
          value={companionSearch}
          onChange={(e) => setCompanionSearch(e.target.value)}
          allowClear
          style={{ marginBottom: 8 }}
        />
        {loadingCompanions && companions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Spin />
          </div>
        ) : filteredCompanions.length === 0 ? (
          <Text type="secondary">暂无陪玩</Text>
        ) : (
          <List
            size="small"
            dataSource={filteredCompanions}
            renderItem={(c) => {
              const u = c.user as any;
              const avatarUrl = u?.avatar ? `/uploads/avatars/${u.avatar}?v=${u.avatar}` : null;
              const initial = (u?.displayName || u?.username || '?')[0].toUpperCase();
              return (
                <List.Item
                  style={{ padding: '8px 6px', display: 'block', borderBottom: '1px solid #F1F5F9', cursor: 'pointer' }}
                  onClick={() => openCompanionChat(c)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <Space size="small">
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: '50%',
                          background: avatarUrl ? `url(${avatarUrl}) center/cover` : '#2563EB',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxShadow:
                            c.status !== 'OFFLINE'
                              ? `0 0 6px ${c.status === 'BUSY' ? '#FF4757' : c.status === 'ENTERTAINMENT' ? '#00E676' : '#FFD600'}`
                              : 'none',
                          flexShrink: 0,
                        }}
                      >
                        {!avatarUrl && <span style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>{initial}</span>}
                      </div>
                      <Text strong>{u?.displayName || u?.username || c.id}</Text>
                    </Space>
                    <Space size={4}>
                      <Tag color={companionStatusConfig[c.status]?.color || 'default'}>
                        {companionStatusConfig[c.status]?.label || c.status}
                      </Tag>
                      <Button
                        size="small"
                        type="text"
                        style={{ padding: '0 4px', fontSize: 11, color: '#2563EB', height: 22 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          openCompanionChat(c);
                        }}
                      >
                        💬
                      </Button>
                    </Space>
                  </div>
                  {c.games && c.games.length > 0 && typeof c.games[0] === 'object' && (
                    <div style={{ marginTop: 4, marginLeft: 22, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {c.games.slice(0, 3).map((g: any, i: number) => (
                        <Tag key={i} style={{ fontSize: 11, padding: '1px 6px', lineHeight: '18px', opacity: 0.85 }}>
                          {g.game} <span style={{ color: '#7C3AED' }}>{g.rank || '?'}</span>
                        </Tag>
                      ))}
                    </div>
                  )}
                </List.Item>
              );
            }}
          />
        )}
      </Card>
    </Col>
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

      <Row
        gutter={12}
        style={{ background: '#F8FAFC', borderRadius: 12, padding: 12, minHeight: 'calc(100vh - 160px)' }}
      >
        {isCompanion && renderCompanionSidebar()}
        <Col span={isCompanion ? 21 : 24}>
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
        </Col>
      </Row>

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
