// craftsman-ignore: TS001,TS002
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Button, Typography, Tag, Row, Col, message, Progress, Space, Badge, List, Input, Spin } from 'antd';
import { PlusOutlined, ReloadOutlined, ClockCircleOutlined, MessageOutlined } from '@ant-design/icons';
import { ordersApi } from '../api/orders';
import { companionsApi } from '../api/companions';
import { configApi } from '../api/config';
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
import { buildOrderInfoFields } from '../utils/orderPool';

const { Text } = Typography;

function isPersonnelOnline(c: any): boolean {
  if (c.lastHeartbeat) return Date.now() - new Date(c.lastHeartbeat).getTime() < 120000;
  if (c.status) return c.status !== 'OFFLINE';
  return false;
}

function displayStatus(c: any): { label: string; color: string } {
  if (!isPersonnelOnline(c)) return { label: '离线', color: 'default' };
  if (c.status && c.status !== 'OFFLINE') {
    return companionStatusConfig[c.status] || { label: c.status, color: 'default' };
  }
  return { label: '在线', color: 'green' };
}

const STATUS_DOT: Record<string, string> = {
  green: '#22C55E',
  red: '#EF4444',
  gold: '#F59E0B',
  orange: '#F97316',
  default: '#94A3B8',
};

function statusDotColor(c: any): string {
  return STATUS_DOT[displayStatus(c).color] || '#94A3B8';
}

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
  const [now, setNow] = useState(Date.now());
  const [disappearMinutes, setDisappearMinutes] = useState(10);
  const [scheduledDisappearMinutes, setScheduledDisappearMinutes] = useState(60);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    configApi
      .get(['pool.immediate_disappear_minutes', 'pool.scheduled_disappear_minutes'])
      .then(({ data }) => {
        const v = Number(data?.data?.['pool.immediate_disappear_minutes']);
        if (Number.isFinite(v) && v > 0) setDisappearMinutes(v);
        const sv = Number(data?.data?.['pool.scheduled_disappear_minutes']);
        if (Number.isFinite(sv) && sv > 0) setScheduledDisappearMinutes(sv);
      })
      .catch(() => {});
  }, []);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
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
      if (!silent) {
        console.error('Pool fetch error', e);
        message.error('加载订单池失败');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [isCompanion]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 周期轮询：普通陪玩要等延迟后订单才可见，轮询让订单自动出现，无需手动刷新
  useEffect(() => {
    const timer = setInterval(() => fetchData(true), 10000);
    return () => clearInterval(timer);
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
    const timer = setInterval(fetchCompanions, 30000);
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
        const name = c.displayName || c.username || '';
        return name.toLowerCase().includes(companionSearch.toLowerCase());
      })
    : sortedCompanions;

  // Real-time pool updates via WebSocket
  useSocket({ onOrderPoolUpdated: () => fetchData(true) });

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
    await useChatStore.getState().openConversation(
      companion.id,
      {
        userId: companion.id,
        username: companion.username || companion.id,
        displayName: companion.displayName || companion.username || companion.id,
        avatar: companion.avatar,
        role: 'COMPANION',
      },
    );
    setChatPartner({
      conversationId: companion.id,
      participant: {
        userId: companion.id,
        username: companion.username || companion.id,
        displayName: companion.displayName || companion.username || companion.id,
        avatar: companion.avatar,
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
  const renderPoolCard = (order: any, idx: number) => {
    const fields = buildOrderInfoFields(order, now, disappearMinutes, scheduledDisappearMinutes);

    return (
      <div
        key={order.id}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '9px 12px',
          background: '#fff',
          borderBottom: '1px solid #f0f0f0',
          fontSize: 13,
          color: '#1f2329',
          whiteSpace: 'nowrap',
        }}
      >
        {fields.map((t, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span style={{ color: '#c9cdd4' }}>|</span>}
            <span>{t}</span>
          </React.Fragment>
        ))}
        <span style={{ flex: 1 }} />
        {isCompanion ? (
          <Space size={8}>
            {order.companionId && <Text type="danger" style={{ fontSize: 12 }}>客服指定给你接</Text>}
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
          <Space size={8}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              发布:{order.csUser?.username || order.customFields?.createdBy || '未知'}
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>待派单</Text>
          </Space>
        )}
      </div>
    );
  };

  const renderCompanionSidebar = () => (
    <Col flex="0 0 180px">
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
              const avatarUrl = c.avatar ? `/uploads/avatars/${c.avatar}?v=${c.avatar}` : null;
              const initial = (c.displayName || c.username || '?')[0].toUpperCase();
              return (
                <List.Item
                  style={{
                    padding: '8px 10px',
                    display: 'block',
                    cursor: 'pointer',
                    margin: '2px 3px',
                    borderRadius: 8,
                    transition: 'background 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#F8FAFC';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                  onClick={() => openCompanionChat(c)}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: '50%',
                          background: avatarUrl ? `url(${avatarUrl}) center/cover` : '#2563EB',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        {!avatarUrl && <span style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>{initial}</span>}
                      </div>
                      <span
                        style={{
                          position: 'absolute',
                          right: -1,
                          bottom: -1,
                          width: 11,
                          height: 11,
                          borderRadius: '50%',
                          background: statusDotColor(c),
                          border: '2px solid #fff',
                          boxShadow: isPersonnelOnline(c) ? `0 0 0 3px ${statusDotColor(c)}22` : 'none',
                        }}
                      />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                        <span
                          style={{
                            fontWeight: 600,
                            fontSize: 13,
                            color: '#1F2937',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            flex: '0 1 auto',
                            minWidth: 0,
                          }}
                        >
                          {c.displayName || c.username || c.id}
                        </span>
                        <Button
                          size="small"
                          type="text"
                          style={{ padding: 0, fontSize: 13, color: '#2563EB', height: 22, width: 22, flexShrink: 0 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            openCompanionChat(c);
                          }}
                        >
                          💬
                        </Button>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
                        <span style={{ fontSize: 11, color: statusDotColor(c) }}>●</span>
                        <span style={{ fontSize: 11, color: '#475569' }}>{displayStatus(c).label}</span>
                      </div>
                    </div>
                  </div>
                  {c.games && c.games.length > 0 && typeof c.games[0] === 'object' && (
                    <div style={{ marginTop: 7, marginLeft: 44, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {c.games.slice(0, 2).map((g: any, i: number) => (
                        <span
                          key={i}
                          style={{
                            fontSize: 10,
                            color: '#64748B',
                            background: '#F1F5F9',
                            borderRadius: 4,
                            padding: '1px 6px',
                            lineHeight: '17px',
                          }}
                        >
                          {g.game}
                        </span>
                      ))}
                      {c.games.length > 2 && (
                        <span style={{ fontSize: 10, color: '#94A3B8', lineHeight: '17px' }}>+{c.games.length - 2}</span>
                      )}
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
            <Button icon={React.createElement(ReloadOutlined)} onClick={() => fetchData()} loading={loading}>
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
        <Col flex="1 1 auto">
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
