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
  Tabs,
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
import CsFollowupPanel from '../../components/CsFollowupPanel';
import CreateOrderModal from '../../components/CreateOrderModal';
import EmptyState from '../../components/EmptyState';
import TierBadge from '../../components/TierBadge';
import { orderTypeConfig, companionStatusConfig, STATUS_SORT, serviceTypeConfig } from '../../constants';
import { currentBusinessDayStart } from '../../utils/businessDay';
import { buildOrderInfoFields } from '../../utils/orderPool';

const { Text } = Typography;

interface Personnel {
  id: string;
  username: string;
  role: 'COMPANION' | 'CS' | 'ADMIN' | 'OWNER';
  displayName?: string;
  avatar?: string;
  studioName?: string | null;
  companionId?: string | null;
  status?: CompanionStatus | null;
  lastHeartbeat?: string | null;
  isExcellent?: boolean;
  tier?: 'TOP' | 'MIDDLE' | 'LOW';
  rankScore?: number;
  games?: any[];
}

const TIER_ORDER: Record<string, number> = { TOP: 0, MIDDLE: 1, LOW: 2 };

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

function isPersonnelOnline(c: Personnel): boolean {
  // 统一按最后心跳判断在线/离线（陪玩 + 客服/店长/老板），避免用 status 误判
  if (c.lastHeartbeat) {
    return Date.now() - new Date(c.lastHeartbeat).getTime() < 120000;
  }
  // 没有心跳记录时，陪玩退回到状态字段
  if (c.status) return c.status !== CompanionStatus.OFFLINE;
  return false;
}

function displayStatus(c: Personnel): { label: string; color: string } {
  if (!isPersonnelOnline(c)) return { label: '离线', color: 'default' };
  if (c.status && c.status !== CompanionStatus.OFFLINE) {
    return companionStatusConfig[c.status] || { label: c.status, color: 'default' };
  }
  return { label: '在线', color: 'green' };
}

const ROLE_TAG: Record<string, { color: string; label: string }> = {
  COMPANION: { color: 'blue', label: '陪玩' },
  CS: { color: 'cyan', label: '客服' },
  ADMIN: { color: 'orange', label: '店长' },
  OWNER: { color: 'purple', label: '老板' },
};

// 状态圆点颜色（配合头像右下角的状态点，比一排彩色 Tag 更清爽、易读）
const STATUS_DOT: Record<string, string> = {
  green: '#22C55E',
  red: '#EF4444',
  gold: '#F59E0B',
  orange: '#F97316',
  default: '#94A3B8',
};

const ROLE_TEXT_COLOR: Record<string, string> = {
  COMPANION: '#2563EB',
  CS: '#0891B2',
  ADMIN: '#EA580C',
  OWNER: '#7C3AED',
};

function statusDotColor(c: Personnel): string {
  return STATUS_DOT[displayStatus(c).color] || '#94A3B8';
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
  const [companions, setCompanions] = useState<Personnel[]>([]);
  const [poolOrders, setPoolOrders] = useState<PoolOrder[]>([]);
  const [allOrders, setAllOrders] = useState<any[]>([]);
  const [todayNew, setTodayNew] = useState(0);
  const [todayGrabbed, setTodayGrabbed] = useState(0);
  const [loadingCompanions, setLoadingCompanions] = useState(false);
  const [loadingPool, setLoadingPool] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [dispatchPrefill, setDispatchPrefill] = useState<any>(null);
  const [dispatchSourceOrderId, setDispatchSourceOrderId] = useState<string | null>(null);
  const [selectedCompanion, setSelectedCompanion] = useState<Personnel | null>(null);
  const [urgencyFilter, setUrgencyFilter] = useState<string | undefined>();
  const [gameSearch, setGameSearch] = useState('');
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
      const { data } = await companionsApi.listPersonnel();
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

  const handleDispatch = (item: any) => {
    const cf = item.customFields || {};
    setDispatchPrefill({
      gameName: item.gameName,
      amount: item.amount,
      duration: item.duration,
      serviceType: cf.serviceType,
      deltaMission: cf.deltaMission,
      deltaNote: cf.deltaNote,
      deltaCount: cf.deltaCount,
      billingMode: cf.billingMode,
      customerSource: cf.customerSource,
      customerSourceAccount: cf.customerSourceAccount,
      customerWechat: item.customerWechat || cf.customerWechat,
      customerYy: cf.customerYy,
      customerPlatformAccount: cf.customerPlatformAccount,
      customerRoomCode: cf.customerRoomCode,
      urgency: item.isScheduled ? 'later' : 'now',
      scheduledTimeText: cf.scheduledTimeText,
    });
    setDispatchSourceOrderId(item.id);
    setModalOpen(true);
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
        const aTier = TIER_ORDER[a.tier ?? 'LOW'] ?? 2;
        const bTier = TIER_ORDER[b.tier ?? 'LOW'] ?? 2;
        if (aTier !== bTier) return aTier - bTier;
        const aScore = a.rankScore ?? 0;
        const bScore = b.rankScore ?? 0;
        if (aScore !== bScore) return bScore - aScore;
        return (STATUS_SORT[a.status ?? 'OFFLINE'] ?? 9) - (STATUS_SORT[b.status ?? 'OFFLINE'] ?? 9);
      }),
    [companions, conversations],
  );

  // Filter companions by name search
  const filteredCompanions = useMemo(
    () =>
      companionSearch
        ? sortedCompanions.filter((c) => {
            const name = c.displayName || c.username || '';
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
      <Tabs
        defaultActiveKey="dispatch"
        items={[
          {
            key: 'dispatch',
            label: '派单工作台',
            children: (
              <>
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
        gutter={6}
        style={{ background: '#F8FAFC', borderRadius: 10, padding: 8, minHeight: 'calc(100vh - 160px)' }}
      >
        {/* Left: Companion sidebar */}
        <Col flex="0 0 240px">
          <Card
            title={<span style={{ fontSize: 13, fontWeight: 600 }}>人员</span>}
            size="small"
            style={{ borderRadius: 8 }}
            bodyStyle={{ padding: '8px 4px', maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}
          >
            {/* Companion search filter */}
            <Input
              size="small"
              placeholder="搜索人员..."
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
              <Text type="secondary">未找到匹配的人员</Text>
            ) : companions.length === 0 ? (
              <Text type="secondary">暂无人员</Text>
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
                        padding: '8px 10px',
                        display: 'block',
                        cursor: 'pointer',
                        margin: '2px 3px',
                        borderRadius: 8,
                        background: isSelected ? '#EEF2FF' : 'transparent',
                        border: isSelected ? '1px solid #C7D2FE' : '1px solid transparent',
                        transition: 'background 0.15s ease, border-color 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) e.currentTarget.style.background = '#F8FAFC';
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) e.currentTarget.style.background = 'transparent';
                      }}
                      onClick={() => {
                        // Mark read via chatStore instead of localStorage
                        const store = useChatStore.getState();
                        if (store.conversations[c.id]) {
                          store.markRead(c.id);
                        }
                        // Find matching order for this companion (check both pool and assigned)
                        const order = [...poolOrders, ...allOrders].find((o: any) => o.companionId === c.companionId);
                        const orderInfo = order
                          ? `${order.gameName} · ¥${Number(order.amount || 0).toFixed(0)}${order.duration ? ' · ' + order.duration + 'h' : ''}${order.customer?.customerCode ? ' · 客户' + order.customer.customerCode : ''}`
                          : undefined;
                        window.dispatchEvent(
                          new CustomEvent('open-chat-modal', {
                            detail: {
                              conversationId: c.id,
                              participant: {
                                userId: c.id,
                                username: c.username || c.id,
                                displayName: c.displayName,
                                avatar: c.avatar,
                                role: c.role,
                              },
                              orderInfo,
                            },
                          }),
                        );
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{ position: 'relative', flexShrink: 0 }}>
                          {(() => {
                            const avatarUrl = c.avatar ? `/uploads/avatars/${c.avatar}?v=${c.avatar}` : null;
                            const initial = (c.displayName || c.username || '?').slice(0, 1).toUpperCase();
                            return (
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
                                {!avatarUrl && (
                                  <span style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>{initial}</span>
                                )}
                              </div>
                            );
                          })()}
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
                            {c.role === 'COMPANION' && c.tier && (
                              <TierBadge tier={c.tier} showLabel />
                            )}
                            <span
                              style={{
                                fontWeight: 600,
                                fontSize: 13,
                                color: '#1F2937',
                                whiteSpace: 'nowrap',
                                flexShrink: 0,
                              }}
                            >
                              {c.displayName || c.username || c.id}
                            </span>
                            {hasUnread && (
                              <span
                                style={{
                                  width: 7,
                                  height: 7,
                                  borderRadius: '50%',
                                  background: '#FF4757',
                                  flexShrink: 0,
                                }}
                              />
                            )}
                            <Button
                              size="small"
                              type="text"
                              style={{ padding: 0, fontSize: 13, color: '#2563EB', height: 22, width: 22, flexShrink: 0, marginLeft: 'auto' }}
                              onClick={async (e) => {
                                e.stopPropagation();
                                await useChatStore.getState().openConversation(c.id, {
                                  userId: c.id,
                                  username: c.username || '未知',
                                  displayName: c.displayName || c.username || '未知',
                                  avatar: c.avatar,
                                  role: c.role,
                                });
                                window.dispatchEvent(
                                  new CustomEvent('open-chat-modal', {
                                    detail: {
                                      conversationId: c.id,
                                      participant: {
                                        userId: c.id,
                                        username: c.username || '未知',
                                        displayName: c.displayName || c.username || '未知',
                                        avatar: c.avatar,
                                        role: c.role,
                                      },
                                    },
                                  }),
                                );
                              }}
                            >
                              💬
                            </Button>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 10, fontWeight: 600, color: ROLE_TEXT_COLOR[c.role] || '#64748B' }}>
                              {ROLE_TAG[c.role]?.label || c.role}
                            </span>
                            {c.studioName && (
                              <span
                                style={{
                                  fontSize: 10,
                                  color: '#94A3B8',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  maxWidth: 96,
                                }}
                              >
                                {c.studioName}
                              </span>
                            )}
                            {(c as any).processStatus === 'BLOCKED' && (
                              <span style={{ fontSize: 10, color: '#EF4444', fontWeight: 600 }}>已限制</span>
                            )}
                            {(c as any).processStatus === 'WARNING' && (
                              <span style={{ fontSize: 10, color: '#F59E0B', fontWeight: 600 }}>⚠️进程异常</span>
                            )}
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
                            <span style={{ fontSize: 11, color: statusDotColor(c) }}>●</span>
                            <span style={{ fontSize: 11, color: '#475569' }}>{displayStatus(c).label}</span>
                          </div>
                        </div>

                      </div>

                      {/* Game profile */}
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

        {/* Center: Order Pool */}
        <Col flex="1 1 auto" style={{ maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' }}>
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
                    const fields = buildOrderInfoFields(order, now, disappearMinutes, scheduledDisappearMinutes);

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
        <Col flex="0 0 150px">
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
              </>
            ),
          },
          {
            key: 'pending',
            label: '客服待处理',
            children: <UrgentOrdersPanel onDispatch={handleDispatch} />,
          },
          {
            key: 'followup',
            label: '客服跟进',
            children: <CsFollowupPanel onRedispatch={handleDispatch} />,
          },
        ]}
      />

      <CreateOrderModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setDispatchPrefill(null);
          setDispatchSourceOrderId(null);
        }}
        onCreated={() => {
          fetchPool();
          if (dispatchSourceOrderId) {
            ordersApi.markPoolHandled(dispatchSourceOrderId).catch(() => {});
            setDispatchSourceOrderId(null);
          }
        }}
        userId={useAuthStore.getState().user?.id}
        initialValues={dispatchPrefill || undefined}
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
                  isPersonnelOnline(selectedCompanion) ? '0 0 16px #00E676' : 'none',
                animation:
                  isPersonnelOnline(selectedCompanion) ? 'pulse-glow 2s ease-in-out infinite' : 'none',
              }}
            />
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
              {selectedCompanion.displayName || selectedCompanion.username || selectedCompanion.id}
            </div>
            <Space size={4}>
              <Tag color={ROLE_TAG[selectedCompanion.role]?.color || 'default'}>
                {ROLE_TAG[selectedCompanion.role]?.label || selectedCompanion.role}
              </Tag>
              <Tag color={displayStatus(selectedCompanion).color}>{displayStatus(selectedCompanion).label}</Tag>
            </Space>
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
            {grabbedOrder.customFields?.customerWechatQr && (
              <div>
                微信二维码（扫码添加）：
                <img
                  src={grabbedOrder.customFields.customerWechatQr}
                  alt="客户微信二维码"
                  style={{ maxWidth: 180, borderRadius: 8, display: 'block', marginTop: 4 }}
                />
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
