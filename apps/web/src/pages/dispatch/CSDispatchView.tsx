// craftsman-ignore: TS001,TS002
import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Row,
  Col,
  Card,
  Button,
  Modal,
  Select,
  Tag,
  Typography,
  Space,
  message,
  List,
  Spin,
  Input,
  Divider,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { CompanionStatus, OrderType } from '@chunlv/shared';
import { companionsApi } from '../../api/companions';
import { ordersApi } from '../../api/orders';
import { configApi } from '../../api/config';
import { useAuthStore } from '../../stores/authStore';
import { useChatStore } from '../../stores/chatStore';
import { useSocket } from '../../hooks/useSocket';
import { EmbeddedChatPanel } from '../../components/chat';
import UrgentOrdersPanel from '../../components/UrgentOrdersPanel';
import CreateOrderModal from '../../components/CreateOrderModal';
import EmptyState from '../../components/EmptyState';
import { orderTypeConfig, companionStatusConfig, STATUS_SORT, serviceTypeConfig } from '../../constants';
import { currentBusinessDayStart } from '../../utils/businessDay';

const { Text } = Typography;

const pad2 = (n: number) => String(n).padStart(2, '0');
const fmtClock = (v: string) => {
  const d = new Date(v);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
const fmtSpan = (ms: number) => {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h${m % 60}m`;
  if (m > 0) return `${m}分${s % 60}秒`;
  return `${s}秒`;
};

interface Companion {
  id: string;
  user?: { username: string };
  status: CompanionStatus;
  games?: any[];
}

interface PoolOrder {
  id: string;
  gameName: string;
  amount: number;
  type: OrderType;
  dispatchType: string;
  duration?: number;
  status: string;
  createdAt: string;
  coCompanionId?: string;
  scheduledAt?: string;
  customFields?: any;
  customer?: { wechatId: string; customerCode?: string };
  csUser?: { id?: string; username: string };
}

const CSDispatchView: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const ordersPath =
    user?.role === 'COMPANION'
      ? '/companion/orders'
      : user?.role === 'CS'
        ? '/cs/orders'
        : user?.role === 'ADMIN'
          ? '/admin/orders'
          : '/owner/orders';
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [poolOrders, setPoolOrders] = useState<PoolOrder[]>([]);
  const [allOrders, setAllOrders] = useState<any[]>([]);
  const [todayNew, setTodayNew] = useState(0);
  const [todayGrabbed, setTodayGrabbed] = useState(0);
  const [loadingCompanions, setLoadingCompanions] = useState(false);
  const [loadingPool, setLoadingPool] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedCompanion, setSelectedCompanion] = useState<Companion | null>(null);
  const [urgencyFilter, setUrgencyFilter] = useState<string | undefined>();
  const [gameSearch, setGameSearch] = useState('');
  const [companionSearch, setCompanionSearch] = useState('');
  const [now, setNow] = useState(Date.now());
  const [disappearMinutes, setDisappearMinutes] = useState(10);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    configApi
      .get(['pool.immediate_disappear_minutes'])
      .then(({ data }) => {
        const v = Number(data?.data?.['pool.immediate_disappear_minutes']);
        if (Number.isFinite(v) && v > 0) setDisappearMinutes(v);
      })
      .catch(() => {});
  }, []);
  const [grabbing, setGrabbing] = useState<string | null>(null);
  const [grabbedOrder, setGrabbedOrder] = useState<any>(null);
  const [claimingOrder, setClaimingOrder] = useState<any>(null);
  const [claimWechatId, setClaimWechatId] = useState<string | null>(null);
  const [workWechats, setWorkWechats] = useState<any[]>([]);
  const [poolStatus, setPoolStatus] = useState<{ todayRevenue: number; threshold: number; isUnlocked: boolean } | null>(
    null,
  );
  const [selectedCompanionId, setSelectedCompanionId] = useState<string | null>(null);
  const [chatPanelWidth, setChatPanelWidth] = useState(() => {
    try {
      const saved = localStorage.getItem('chat-panel-width');
      return saved ? parseInt(saved, 10) : 320;
    } catch {
      return 380;
    }
  });
  // Persist panel width on change (debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      localStorage.setItem('chat-panel-width', String(chatPanelWidth));
    }, 500);
    return () => clearTimeout(t);
  }, [chatPanelWidth]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null);

  const fetchCompanions = useCallback(async () => {
    setLoadingCompanions(true);
    try {
      const { data } = await companionsApi.list();
      setCompanions(data.data ?? []);
    } catch {
      // silent fail on auto-refresh
    } finally {
      setLoadingCompanions(false);
    }
  }, []);

  const fetchPool = useCallback(async () => {
    setLoadingPool(true);
    try {
      const [poolRes, allRes] = await Promise.all([ordersApi.pool(), ordersApi.list()]);
      setPoolOrders(poolRes.data.data ?? []);
      const all = allRes.data.data ?? [];
      setAllOrders(all);
      const bizStart = currentBusinessDayStart().getTime();
      setTodayNew(all.filter((o: any) => new Date(o.createdAt).getTime() >= bizStart).length);
      setTodayGrabbed(
        all.filter(
          (o: any) =>
            (o.status === 'GRABBED' || o.status === 'CONFIRMED') &&
            new Date(o.grabbedAt || o.createdAt).getTime() >= bizStart,
        ).length,
      );
    } catch {
      // silent fail on auto-refresh
    } finally {
      setLoadingPool(false);
    }
  }, []);

  const fetchPoolStatus = useCallback(async () => {
    try {
      const { data } = await ordersApi.poolStatus();
      setPoolStatus(data.data);
    } catch {
      /* silent */
    }
  }, []);

  const handleGrab = async (orderId: string) => {
    setGrabbing(orderId);
    try {
      const res = await ordersApi.grab(orderId);
      setGrabbedOrder(res.data.data);
      fetchPool();
      fetchPoolStatus();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '抢单失败');
    } finally {
      setGrabbing(null);
    }
  };

  const openClaim = async (order: any) => {
    setClaimingOrder(order);
    setClaimWechatId(null);
    try {
      const { data } = await companionsApi.listWorkWechats();
      setWorkWechats(data?.data || []);
    } catch {
      setWorkWechats([]);
    }
  };

  const submitClaim = async () => {
    if (!claimingOrder) return;
    const wechat = workWechats.find((w: any) => w.id === claimWechatId);
    try {
      await ordersApi.claim(claimingOrder.id, {
        workWechatId: claimWechatId || undefined,
        workWechatName: wechat?.wechatId || undefined,
      });
      message.success('已认领，订单暂存为待跟进');
      setClaimingOrder(null);
      setClaimWechatId(null);
      fetchPool();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '认领失败');
    }
  };

  // Initial load
  useEffect(() => {
    fetchCompanions();
    fetchPool();
  }, [fetchCompanions, fetchPool]);

  useEffect(() => {
    if (user?.role === 'COMPANION') fetchPoolStatus();
  }, [user?.role, fetchPoolStatus]);

  // WebSocket real-time: refresh pool on order updates
  useSocket({
    onOrderPoolUpdated: () => fetchPool(),
    onOrderGrabbed: (data: any) => {
      message.info(data?.message || '有陪玩抢了订单');
      fetchPool();
    },
    onChatNotify: () => {},
  });

  // Fallback polling every 10s
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      fetchPool();
      fetchCompanions();
    }, 10000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchPool, fetchCompanions]);

  // Chat notification tracking
  const conversations = useChatStore((s) => s.conversations);

  // Stats — sort: messages first, then by status
  const sortedCompanions = useMemo(
    () =>
      [...companions].sort((a, b) => {
        const aMsg = conversations[a.id]?.unreadCount > 0 ? 1 : 0;
        const bMsg = conversations[b.id]?.unreadCount > 0 ? 1 : 0;
        if (aMsg !== bMsg) return bMsg - aMsg;
        return (STATUS_SORT[a.status] ?? 9) - (STATUS_SORT[b.status] ?? 9);
      }),
    [companions, conversations],
  );

  // Filter companions by name search
  const filteredCompanions = useMemo(
    () =>
      companionSearch
        ? sortedCompanions.filter((c) => {
            const name = (c.user as any)?.displayName || c.user?.username || '';
            return name.toLowerCase().includes(companionSearch.toLowerCase());
          })
        : sortedCompanions,
    [sortedCompanions, companionSearch],
  );

  const idleCount = companions.filter((c) => c.status === CompanionStatus.AVAILABLE).length;
  const busyCount = companions.filter((c) => c.status === CompanionStatus.BUSY).length;
  const entertainCount = companions.filter((c) => c.status === CompanionStatus.ENTERTAINMENT).length;
  const restingCount = companions.filter((c) => c.status === CompanionStatus.RESTING).length;
  const offlineCount = companions.filter((c) => c.status === CompanionStatus.OFFLINE).length;
  const poolCount = poolOrders.length;

  // Apply filters
  const filteredOrders = useMemo(() => {
    let result = poolOrders;
    if (gameSearch) result = result.filter((o) => o.gameName?.toLowerCase().includes(gameSearch.toLowerCase()));
    if (urgencyFilter) result = result.filter((o) => (o as any).customFields?.urgency === urgencyFilter);
    return result;
  }, [poolOrders, gameSearch, urgencyFilter]);

  return (
    <div>
      <UrgentOrdersPanel />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <div />
        <Button type="primary" icon={React.createElement(PlusOutlined)} onClick={() => setModalOpen(true)}>
          发布订单
        </Button>
      </div>

      <Row
        gutter={12}
        style={{ background: '#F8FAFC', borderRadius: 12, padding: 12, minHeight: 'calc(100vh - 160px)' }}
      >
        {/* Left: Companion sidebar */}
        <Col span={3}>
          <Card
            title={<span style={{ fontSize: 13, fontWeight: 600 }}>陪玩</span>}
            size="small"
            style={{ borderRadius: 8 }}
            bodyStyle={{ padding: '8px 4px', maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}
          >
            {/* Companion search filter */}
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
            ) : filteredCompanions.length === 0 && companionSearch ? (
              <Text type="secondary">未找到匹配的陪玩</Text>
            ) : companions.length === 0 ? (
              <Text type="secondary">暂无陪玩</Text>
            ) : (
              <List
                size="small"
                dataSource={filteredCompanions}
                renderItem={(c) => {
                  const isSelected = selectedCompanionId === c.id;
                  const companionConvUnread = useChatStore.getState().conversations[c.id]?.unreadCount || 0;
                  const hasUnread = companionConvUnread > 0;
                  return (
                    <List.Item
                      style={{
                        padding: '8px 6px',
                        display: 'block',
                        cursor: 'pointer',
                        borderLeft: isSelected ? '3px solid #2563EB' : '3px solid transparent',
                        paddingLeft: isSelected ? 10 : 10,
                        borderRadius: '0 6px 6px 0',
                        transition: 'transform 0.15s ease, background 0.15s ease',
                        background: isSelected ? '#EFF6FF' : 'transparent',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateX(2px)';
                        e.currentTarget.style.background = 'rgba(0,212,255,0.04)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateX(0)';
                        if (!isSelected) e.currentTarget.style.background = 'transparent';
                      }}
                      onClick={() => {
                        // Mark read via chatStore instead of localStorage
                        const store = useChatStore.getState();
                        if (store.conversations[c.id]) {
                          store.markRead(c.id);
                        }
                        const u = c.user as any;
                        // Find matching order for this companion (check both pool and assigned)
                        const order = [...poolOrders, ...allOrders].find((o: any) => o.companionId === c.id);
                        const orderInfo = order
                          ? `${order.gameName} · ¥${Number(order.amount || 0).toFixed(0)}${order.duration ? ' · ' + order.duration + 'h' : ''}${order.customer?.customerCode ? ' · 客户' + order.customer.customerCode : ''}`
                          : undefined;
                        window.dispatchEvent(
                          new CustomEvent('open-chat-modal', {
                            detail: {
                              conversationId: c.id,
                              participant: {
                                userId: u?.id || c.id,
                                username: u?.username || c.id,
                                displayName: u?.displayName,
                                avatar: u?.avatar,
                                role: 'COMPANION',
                              },
                              orderInfo,
                            },
                          }),
                        );
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          width: '100%',
                        }}
                      >
                        <Space size="small">
                          {(() => {
                            const u = c.user as any;
                            const avatarUrl = u?.avatar ? `/uploads/avatars/${u.avatar}?v=${u.avatar}` : null;
                            const initial = (u?.displayName || u?.username || '?')[0].toUpperCase();
                            return (
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
                                    c.status !== CompanionStatus.OFFLINE
                                      ? `0 0 6px ${c.status === CompanionStatus.BUSY ? '#FF4757' : c.status === CompanionStatus.ENTERTAINMENT ? '#00E676' : '#FFD600'}`
                                      : 'none',
                                  flexShrink: 0,
                                }}
                              >
                                {!avatarUrl && (
                                  <span style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>{initial}</span>
                                )}
                              </div>
                            );
                          })()}
                          <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            {/* Unread dot */}
                            {hasUnread && (
                              <span
                                style={{
                                  width: 8,
                                  height: 8,
                                  borderRadius: '50%',
                                  background: '#FF4757',
                                  flexShrink: 0,
                                  boxShadow: '0 0 4px #FF4757',
                                }}
                              />
                            )}
                            <Text strong>{(c.user as any)?.displayName || c.user?.username || c.id}</Text>
                            {(c as any).processStatus === 'BLOCKED' && (
                              <Tag color="red" style={{ fontSize: 11, padding: '1px 6px', lineHeight: '20px' }}>
                                已限制
                              </Tag>
                            )}
                            {(c as any).processStatus === 'WARNING' && (
                              <Tag color="orange" style={{ fontSize: 11, padding: '1px 6px', lineHeight: '20px' }}>
                                ⚠️ 进程异常
                              </Tag>
                            )}
                          </span>
                        </Space>
                        <Space size={4}>
                          <Tag color={companionStatusConfig[c.status]?.color || 'default'}>
                            {companionStatusConfig[c.status]?.label || c.status}
                          </Tag>
                          <Button
                            size="small"
                            type="text"
                            style={{ padding: '0 4px', fontSize: 11, color: '#2563EB', height: 22 }}
                            onClick={async (e) => {
                              e.stopPropagation();
                              const u = c.user as any;
                              await useChatStore.getState().openConversation(c.id, {
                                userId: u?.id || c.id,
                                username: u?.username || '未知',
                                displayName: u?.displayName || u?.username || '未知',
                                avatar: u?.avatar,
                                role: 'COMPANION',
                              });
                              window.dispatchEvent(
                                new CustomEvent('open-chat-modal', {
                                  detail: {
                                    conversationId: c.id,
                                    participant: {
                                      userId: u?.id || c.id,
                                      username: u?.username || '未知',
                                      displayName: u?.displayName || u?.username || '未知',
                                      avatar: u?.avatar,
                                      role: 'COMPANION',
                                    },
                                  },
                                }),
                              );
                            }}
                          >
                            💬
                          </Button>
                        </Space>
                      </div>
                      {/* Game profile */}
                      {c.games && c.games.length > 0 && typeof c.games[0] === 'object' && (
                        <div style={{ marginTop: 4, marginLeft: 22, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {c.games.slice(0, 3).map((g: any, i: number) => (
                            <Tag
                              key={i}
                              style={{ fontSize: 11, padding: '1px 6px', lineHeight: '18px', opacity: 0.85 }}
                            >
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

        {/* Center: Order Pool */}
        <Col span={19} style={{ maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' }}>
          <div style={{ position: 'relative', marginBottom: 12 }}>
            {/* Order pool header */}
            <div
              style={{
                background: '#FFFFFF',
                borderRadius: '8px 8px 0 0',
                padding: '16px 24px',
                borderBottom: '1px solid #E2E8F0',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Space>
                  <Text strong style={{ color: '#1E293B', fontSize: 16 }}>
                    订单池
                  </Text>
                  <Tag color="purple" style={{ borderRadius: 10, fontWeight: 700 }}>
                    {poolCount} 单待派
                  </Tag>
                </Space>
                <Space size={16}>
                  <span style={{ color: '#64748B', fontSize: 12 }}>
                    今日新增 <b style={{ color: '#3B82F6' }}>{todayNew}</b>
                  </span>
                  <span style={{ color: '#64748B', fontSize: 12 }}>
                    已抢 <b style={{ color: '#10B981' }}>{todayGrabbed}</b>
                  </span>
                  <span style={{ color: '#64748B', fontSize: 12 }}>
                    待抢 <b style={{ color: '#F59E0B' }}>{poolCount}</b>
                  </span>
                </Space>
              </div>
            </div>
            {/* Pool body */}
            <div
              style={{
                background: '#FFF',
                borderRadius: '0 0 16px 16px',
                padding: '16px 20px',
                minHeight: 400,
                boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
              }}
            >
              {/* Filter bar */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <Input.Search
                  placeholder="搜索游戏名"
                  value={gameSearch}
                  onChange={(e) => setGameSearch(e.target.value)}
                  allowClear
                  style={{ width: 200 }}
                  size="small"
                />
                <Select
                  placeholder="紧急程度"
                  value={urgencyFilter}
                  onChange={setUrgencyFilter}
                  allowClear
                  style={{ width: 120 }}
                  size="small"
                >
                  <Select.Option value="now">立即打</Select.Option>
                  <Select.Option value="later">预约</Select.Option>
                  <Select.Option value="urgent">急单</Select.Option>
                </Select>
                {(gameSearch || urgencyFilter) && (
                  <Text type="secondary" style={{ fontSize: 12, lineHeight: '24px' }}>
                    筛选结果: {filteredOrders.length}/{poolCount}
                  </Text>
                )}
              </div>
              {loadingPool && poolOrders.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 48 }}>
                  <Spin size="large" />
                </div>
              ) : poolOrders.length === 0 ? (
                <EmptyState description="暂无待派订单" />
              ) : (
                <List
                  grid={{ gutter: [0, 8], column: 1 }}
                  dataSource={filteredOrders}
                  renderItem={(order, idx) => {
                    const type = orderTypeConfig[order.type]?.label || order.type || '首单';
                    const svc = serviceTypeConfig[order.customFields?.serviceType]?.label || '陪玩';
                    const mission = order.customFields?.deltaMission || '\u00A0';
                    const isRound = order.customFields?.billingMode === 'round';
                    const dur = isRound
                      ? `${order.duration || order.customFields?.deltaCount || '?'}局`
                      : `${order.duration || '?'}h`;
                    const sd = order.coCompanionId || order.customFields?.deltaCount === '双' ? '双陪' : '单陪';
                    const wait = now - new Date(order.createdAt).getTime();
                    const scheduledTime =
                      order.customFields?.urgency === 'later'
                        ? order.customFields?.scheduledTimeText || '\u00A0'
                        : '\u00A0';
                    let disappearIn;
                    if (order.customFields?.urgency === 'later' && order.scheduledAt) {
                      disappearIn = new Date(order.scheduledAt).getTime() - now;
                    } else {
                      disappearIn = disappearMinutes * 60 * 1000 - wait;
                    }
                    const disappearText = disappearIn > 0 ? fmtSpan(disappearIn) : '0秒';
                    const fields = [
                      order.gameName,
                      type,
                      svc,
                      mission,
                      dur,
                      sd,
                      `${Number(order.amount || 0).toFixed(0)}元`,
                      order.customFields?.urgency === 'later' ? '预约' : '立即打',
                      scheduledTime,
                      fmtClock(order.createdAt),
                      `已等待 ${fmtSpan(wait)}`,
                      `距离消失 ${disappearText}`,
                    ];

                    return (
                      <List.Item style={{ marginBottom: 0 }}>
                        <div
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
                          {(user?.role === 'CS' || user?.role === 'ADMIN' || user?.role === 'OWNER') && (
                            <Button
                              size="small"
                              type="primary"
                              style={{ background: '#7C3AED', borderColor: '#7C3AED' }}
                              loading={claimingOrder?.id === order.id}
                              onClick={() => openClaim(order)}
                            >
                              自己抢单
                            </Button>
                          )}
                          {user?.role === 'COMPANION' && (
                            <Space size={8}>
                              <Button
                                size="small"
                                type="primary"
                                loading={grabbing === order.id}
                                disabled={!poolStatus?.isUnlocked}
                                onClick={() => handleGrab(order.id)}
                              >
                                {!poolStatus?.isUnlocked
                                  ? `还差¥${Math.round((poolStatus?.threshold || 0) - (poolStatus?.todayRevenue || 0))}`
                                  : '抢单'}
                              </Button>
                              {order.csUser?.id && (
                                <Button
                                  size="small"
                                  onClick={async () => {
                                    const csId = order.csUser!.id!;
                                    const convId = await useChatStore
                                      .getState()
                                      .openConversation(
                                        csId,
                                        {
                                          userId: csId,
                                          username: order.csUser?.username || '客服',
                                          role: 'CS',
                                        },
                                        order.gameName ? `${order.gameName} · ¥${order.amount}` : undefined,
                                      );
                                    window.dispatchEvent(
                                      new CustomEvent('open-chat-modal', {
                                        detail: {
                                          conversationId: convId,
                                          participant: {
                                            userId: csId,
                                            username: order.csUser?.username || '客服',
                                            role: 'CS',
                                          },
                                          orderInfo: order.gameName
                                            ? `${order.gameName} · ¥${order.amount}`
                                            : undefined,
                                        },
                                      }),
                                    );
                                  }}
                                >
                                  沟通
                                </Button>
                              )}
                            </Space>
                          )}
                        </div>
                      </List.Item>
                    );
                  }}
                />
              )}
            </div>
          </div>
        </Col>

        {/* Right: Stats + Chat panel */}
        <Col span={2}>
          <Card size="small" style={{ borderRadius: 8 }} bodyStyle={{ padding: '6px 8px' }}>
            <div style={{ textAlign: 'right', lineHeight: 2, fontSize: 13 }}>
              <div>
                🟢 空闲 <b>{idleCount}</b>
              </div>
              <div>
                🔴 接单 <b>{busyCount}</b>
              </div>
              <div>
                🟡 娱乐 <b>{entertainCount}</b>
              </div>
              <div>
                🟠 休息 <b>{restingCount}</b>
              </div>
              <div>
                ⚪ 离线 <b>{offlineCount}</b>
              </div>
              <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: 4 }}>
                📦 待派 <b>{poolCount}</b>
              </div>
            </div>
          </Card>
          {/* Chat panel below stats */}
          {selectedCompanionId && (
            <div style={{ marginTop: 8 }}>
              <div
                onMouseDown={(e) => {
                  e.preventDefault();
                  resizeRef.current = { startX: e.clientX, startW: chatPanelWidth };
                  const onMove = (ev: MouseEvent) => {
                    if (!resizeRef.current) return;
                    const delta = resizeRef.current.startX - ev.clientX;
                    setChatPanelWidth(Math.min(600, Math.max(300, resizeRef.current.startW + delta)));
                  };
                  const onUp = () => {
                    resizeRef.current = null;
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                  };
                  document.addEventListener('mousemove', onMove);
                  document.addEventListener('mouseup', onUp);
                }}
                style={{
                  width: 4,
                  cursor: 'col-resize',
                  flexShrink: 0,
                  background: 'transparent',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => {
                  (e.target as HTMLElement).style.background = '#E0E2E5';
                }}
                onMouseLeave={(e) => {
                  (e.target as HTMLElement).style.background = 'transparent';
                }}
              />
              <div
                style={{
                  background: '#FFF',
                  borderRadius: 10,
                  boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
                  width: chatPanelWidth,
                  minWidth: 300,
                  maxWidth: 600,
                  height: 500,
                  minHeight: 360,
                  maxHeight: 'calc(100vh - 140px)',
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                <EmbeddedChatPanel
                  onClose={() => {
                    useChatStore.getState().closeConversation();
                    setSelectedCompanionId(null);
                  }}
                />
              </div>
            </div>
          )}
        </Col>
      </Row>

      <CreateOrderModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={fetchPool}
        userId={useAuthStore.getState().user?.id}
      />

      {/* Companion detail modal */}
      <Modal
        title={null}
        open={!!selectedCompanion}
        onCancel={() => setSelectedCompanion(null)}
        footer={null}
        width={420}
        style={{ top: 60 }}
      >
        {selectedCompanion && (
          <div style={{ textAlign: 'center' }}>
            <span
              style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                display: 'inline-block',
                marginBottom: 8,
                background:
                  selectedCompanion.status === CompanionStatus.BUSY
                    ? '#FF4757'
                    : selectedCompanion.status === CompanionStatus.ENTERTAINMENT
                      ? '#00E676'
                      : selectedCompanion.status === CompanionStatus.AVAILABLE
                        ? '#FFD600'
                        : '#94A3B8',
                boxShadow:
                  selectedCompanion.status !== CompanionStatus.OFFLINE
                    ? `0 0 16px ${selectedCompanion.status === CompanionStatus.BUSY ? '#FF4757' : selectedCompanion.status === CompanionStatus.ENTERTAINMENT ? '#00E676' : '#FFD600'}`
                    : 'none',
                animation:
                  selectedCompanion.status !== CompanionStatus.OFFLINE ? 'pulse-glow 2s ease-in-out infinite' : 'none',
              }}
            />
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
              {selectedCompanion.user?.username ?? selectedCompanion.id}
            </div>
            <Tag color={companionStatusConfig[selectedCompanion.status]?.color || 'default'}>
              {companionStatusConfig[selectedCompanion.status]?.label || selectedCompanion.status}
            </Tag>
            <div style={{ marginTop: 16, textAlign: 'left', background: '#F8FAFC', borderRadius: 10, padding: 14 }}>
              {selectedCompanion.games &&
              selectedCompanion.games.length > 0 &&
              typeof selectedCompanion.games[0] === 'object' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {selectedCompanion.games.map((g: any, i: number) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span>🎮 {g.game}</span>
                      <span style={{ color: '#7C3AED', fontWeight: 600 }}>{g.rank || '?'}</span>
                      <span style={{ color: g.hasAccount ? '#34C759' : '#94A3B8' }}>
                        {g.hasAccount ? '有号' : '无号'}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <Text type="secondary">未设置游戏资料</Text>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* CS Claim Modal */}
      <Modal
        title="🙋 客服自己抢单"
        open={!!claimingOrder}
        onCancel={() => {
          setClaimingOrder(null);
          setClaimWechatId(null);
        }}
        onOk={submitClaim}
        okText="确认认领"
        cancelText="取消"
        width={460}
      >
        {claimingOrder && (
          <div style={{ fontSize: 14, lineHeight: 2 }}>
            <div>
              📋 {claimingOrder.gameName}
              <Tag color="green" style={{ marginLeft: 8 }}>
                ¥{Number(claimingOrder.amount).toFixed(0)}
              </Tag>
            </div>
            <Text type="secondary">认领后该订单会暂离抢单池，等客户要打时再放回。</Text>
            <Divider style={{ margin: '10px 0' }} />
            <div>
              <strong>📱 选择加客户使用的工作微信：</strong>
            </div>
            <Select
              placeholder="选择工作微信"
              value={claimWechatId || undefined}
              onChange={(v) => setClaimWechatId(v)}
              style={{ width: '100%', marginTop: 8 }}
              allowClear
            >
              {workWechats.map((w: any) => (
                <Select.Option key={w.id} value={w.id}>
                  {w.wechatId}
                  {w.companion ? ` (${w.companion?.user?.username || w.companionId})` : ''}
                </Select.Option>
              ))}
            </Select>
          </div>
        )}
      </Modal>

      {/* Grab Success Modal */}
      <Modal
        title="🎉 抢单成功"
        open={!!grabbedOrder}
        onCancel={() => {
          setGrabbedOrder(null);
          navigate(ordersPath);
        }}
        footer={null}
        width={480}
      >
        {grabbedOrder && (
          <div style={{ fontSize: 14, lineHeight: 2 }}>
            <div>
              📋 {grabbedOrder.gameName}
              <Tag color="blue" style={{ marginLeft: 8 }}>
                {grabbedOrder.type}
              </Tag>
              <Tag color="green">¥{Number(grabbedOrder.amount).toFixed(0)}</Tag>
              {grabbedOrder.duration ? <Tag>{grabbedOrder.duration}h</Tag> : null}
            </div>
            {grabbedOrder.customFields?.customerSource && (
              <div>📡 来源：{grabbedOrder.customFields.customerSource}</div>
            )}
            {grabbedOrder.customFields?.urgency === 'later' ? (
              <Tag color="purple">📅预约</Tag>
            ) : (
              <Tag color="green">⚡立即打</Tag>
            )}
            {grabbedOrder.customFields?.deltaMode && (
              <div>
                🎯 模式：{grabbedOrder.customFields.deltaMode} {grabbedOrder.customFields.deltaMission || ''}{' '}
                {grabbedOrder.customFields.deltaCount || ''}
              </div>
            )}
            {grabbedOrder.customFields?.billingMode && (
              <div>💰 计费：{grabbedOrder.customFields.billingMode === 'round' ? '按局' : '按小时'}</div>
            )}
            {grabbedOrder.customFields?.deltaNote && (
              <div style={{ color: '#F59E0B' }}>📝 {grabbedOrder.customFields.deltaNote}</div>
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
            {grabbedOrder.customFields?.customerYy && (
              <div>
                YY：
                <Text copyable style={{ color: '#1677ff' }}>
                  {grabbedOrder.customFields.customerYy}
                </Text>
              </div>
            )}
            {grabbedOrder.customFields?.customerSourceAccount && (
              <div>
                来源账号：
                <Text copyable style={{ color: '#1677ff' }}>
                  {grabbedOrder.customFields.customerSourceAccount}
                </Text>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default CSDispatchView;
