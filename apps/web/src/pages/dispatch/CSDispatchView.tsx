// craftsman-ignore: TS001,TS002
import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  Badge,
  Tabs,
  Divider,
} from 'antd';
import { PlusOutlined, EditOutlined } from '@ant-design/icons';
import { CompanionStatus, OrderType } from '@chunlv/shared';
import { companionsApi } from '../../api/companions';
import { ordersApi } from '../../api/orders';
import { configApi } from '../../api/config';
import { chatApi } from '../../api/chat';
import { useAuthStore } from '../../stores/authStore';
import { useChatStore } from '../../stores/chatStore';
import { useSocket } from '../../hooks/useSocket';
import UrgentOrdersPanel from '../../components/UrgentOrdersPanel';
import CsFollowupPanel from '../../components/CsFollowupPanel';
import CsConvertedPanel from '../../components/CsConvertedPanel';
import OrderRow from '../../components/OrderRow';
import CreateOrderModal from '../../components/CreateOrderModal';
import EmptyState from '../../components/EmptyState';
import TierBadge from '../../components/TierBadge';
import { DATA_FONT_SIZE, DATA_ROW_PADDING } from '../../constants/datasetColumns';
import {
  orderTypeConfig,
  companionStatusConfig,
  personnelGroupRank,
  isPersonnelOnline,
  serviceTypeConfig,
  PERSONNEL_COLUMN_WIDTH,
  QUICK_STATS_COLUMN_WIDTH,
  fixedColumnFlex,
  fixedColumnStyle,
} from '../../constants';
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
  const [poolError, setPoolError] = useState('');
  const [allOrders, setAllOrders] = useState<any[]>([]);
  const [todayNew, setTodayNew] = useState(0);
  const [todayGrabbed, setTodayGrabbed] = useState(0);
  const [loadingCompanions, setLoadingCompanions] = useState(false);
  const [loadingPool, setLoadingPool] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<any>(null);
  const [dispatchPrefill, setDispatchPrefill] = useState<any>(null);
  const [directAddMode, setDirectAddMode] = useState(false);
  const [dispatchSourceOrderId, setDispatchSourceOrderId] = useState<string | null>(null);
  const [selectedCompanion, setSelectedCompanion] = useState<Personnel | null>(null);
  const [urgencyFilter, setUrgencyFilter] = useState<string | undefined>();
  const [gameSearch, setGameSearch] = useState('');
  const [companionSearch, setCompanionSearch] = useState('');
  const [now, setNow] = useState(Date.now());
  const [disappearMinutes, setDisappearMinutes] = useState(10);
  const [scheduledDisappearMinutes, setScheduledDisappearMinutes] = useState(60);
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') === 'followup' ? 'followup' : 'dispatch';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [customerRefresh, setCustomerRefresh] = useState(0);
  useEffect(() => {
    if (searchParams.get('tab') === 'followup') setActiveTab('followup');
  }, [searchParams]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
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
  useEffect(() => {
    chatApi
      .getStudioGroup()
      .then(({ data }) => {
        if (data?.data?.id) {
          setStudioGroup({ id: data.data.id, groupName: data.data.groupName || '工作室群聊' });
        }
      })
      .catch(() => {});
  }, []);
  const [grabbing, setGrabbing] = useState<string | null>(null);
  const [grabbedOrder, setGrabbedOrder] = useState<any>(null);
  const [poolStatus, setPoolStatus] = useState<{ todayRevenue: number; threshold: number; isUnlocked: boolean } | null>(
    null,
  );
  const [studioGroup, setStudioGroup] = useState<{ id: string; groupName: string } | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchCompanions = useCallback(async () => {
    setLoadingCompanions(true);
    try {
      const { data } = await companionsApi.listPersonnel({ includeBridged: true });
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
      setPoolError('');
      // 用 allSettled，避免「订单列表」偶发超时把整个订单池一起拉崩；
      // 订单池请求成功就保留数据，失败也只提示一次，不丢上一次已加载的内容。
      const [poolRes, allRes] = await Promise.allSettled([ordersApi.pool(), ordersApi.list()]);

      if (poolRes.status === 'fulfilled') {
        setPoolOrders(poolRes.value.data.data ?? []);
      } else {
        const reason: any = poolRes.reason;
        const msg = reason?.response?.data?.message || reason?.message || '网络波动';
        setPoolError(`订单池暂时加载失败：${msg}（${new Date().toLocaleTimeString()}），正在自动重试`);
      }

      if (allRes.status === 'fulfilled') {
        const all = allRes.value.data.data ?? [];
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
      }
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

  const openStudioGroupChat = async () => {
    // 群聊和点人一样，统一走同一个聊天窗口：入口永远可点，点了就把窗口切到群聊。
    let group = studioGroup;
    if (!group?.id) {
      // 首屏拉取失败（超时/被限流）时兜底重拉一次，避免入口点了没反应。
      try {
        const { data } = await chatApi.getStudioGroup();
        if (data?.data?.id) {
          group = { id: data.data.id, groupName: data.data.groupName || '工作室群聊' };
          setStudioGroup(group);
        }
      } catch {}
    }
    if (!group?.id) {
      message.warning('工作室群聊暂时打不开，请稍后重试');
      return;
    }
    window.dispatchEvent(
      new CustomEvent('open-chat-modal', {
        detail: {
          conversationId: group.id,
          participant: {
            userId: '',
            username: group.groupName,
            displayName: group.groupName,
            role: 'GROUP',
          },
          orderInfo: null,
        },
      }),
    );
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
      customerNickname: cf.customerNickname,
      customerAccountId: cf.customerAccountId,
      customerWechat: item.customerWechat || cf.customerWechat,
      customerYy: cf.customerYy,
      customerPlatformAccount: cf.customerPlatformAccount,
      customerRoomCode: cf.customerRoomCode,
      customerWechatQr: cf.customerWechatQr,
      csCultivated: cf.csCultivated === true,
      workWechatId: cf.csWorkWechatId,
      workWechatName: cf.csWorkWechatName,
      urgency: item.isScheduled ? 'later' : 'now',
      scheduledTimeText: cf.scheduledTimeText,
    });
    setDispatchSourceOrderId(item.id);
    setEditingOrder(null);
    setModalOpen(true);
  };

  const canEditOrder = (order: any) => {
    if (!user || user.role === 'COMPANION' || order.dispatchType !== 'POOL') return false;
    if (user.role === 'CS') return order.csUserId === user.id;
    if (user.role === 'ADMIN') return order.studioId === user.studioId;
    return user.role === 'OWNER';
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
    }, 60000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchPool, fetchCompanions]);

  // Chat notification tracking
  const conversations = useChatStore((s) => s.conversations);
  // 当前聊天窗口开着谁的会话：用于人员列表里的选中高亮。
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const activeChatUserId = activeConversationId
    ? conversations[activeConversationId]?.participant?.userId
    : undefined;
  const unreadByParticipant = useMemo(() => {
    const map: Record<string, number> = {};
    for (const conv of Object.values(conversations)) {
      const participantId = conv.participant?.userId;
      if (!participantId || conv.unreadCount <= 0) continue;
      map[participantId] = (map[participantId] || 0) + conv.unreadCount;
    }
    return map;
  }, [conversations]);

  const groupConversation = studioGroup ? conversations[studioGroup.id] : undefined;
  const groupUnread = groupConversation?.unreadCount || 0;
  const groupLastMessage = groupConversation?.lastMessage || '';
  const groupLastMentions = groupConversation?.lastMentions || [];

  // 人员列表顺序：群聊（列表最上方单独渲染）→ 客服 → 店长 → 在线空闲陪玩 →
  // 在线接单中陪玩 → 在线娱乐中陪玩 → 离线人员；同一组内先看未读，再看等级/评分/昵称。
  const sortedCompanions = useMemo(
    () =>
      [...companions].sort((a, b) => {
        const aGroup = personnelGroupRank(a);
        const bGroup = personnelGroupRank(b);
        if (aGroup !== bGroup) return aGroup - bGroup;
        const aMsg = unreadByParticipant[a.id] > 0 ? 1 : 0;
        const bMsg = unreadByParticipant[b.id] > 0 ? 1 : 0;
        if (aMsg !== bMsg) return bMsg - aMsg;
        const aTier = TIER_ORDER[a.tier ?? 'MIDDLE'] ?? 1;
        const bTier = TIER_ORDER[b.tier ?? 'MIDDLE'] ?? 1;
        if (aTier !== bTier) return aTier - bTier;
        const aScore = a.rankScore ?? 0;
        const bScore = b.rankScore ?? 0;
        if (aScore !== bScore) return bScore - aScore;
        return (a.displayName || a.username || '').localeCompare(b.displayName || b.username || '', 'zh-CN');
      }),
    [companions, unreadByParticipant],
  );

  // Filter companions by name search
  const filteredCompanions = useMemo(
    () => {
      return companionSearch
        ? sortedCompanions.filter((c) => {
            const name = c.displayName || c.username || '';
            return name.toLowerCase().includes(companionSearch.toLowerCase());
          })
        : sortedCompanions;
    },
    [sortedCompanions, companionSearch],
  );

  const onlineCompanions = companions.filter((c) => isPersonnelOnline(c));
  const idleCount = onlineCompanions.filter((c) => c.status === CompanionStatus.AVAILABLE).length;
  const busyCount = onlineCompanions.filter((c) => c.status === CompanionStatus.BUSY).length;
  const entertainCount = onlineCompanions.filter((c) => c.status === CompanionStatus.ENTERTAINMENT).length;
  const restingCount = onlineCompanions.filter((c) => c.status === CompanionStatus.RESTING).length;
  const offlineCount = companions.length - onlineCompanions.length;
  const poolCount = poolOrders.length;

  // Apply filters
  const filteredOrders = useMemo(() => {
    let result = poolOrders;
    if (gameSearch) result = result.filter((o) => o.gameName?.toLowerCase().includes(gameSearch.toLowerCase()));
    if (urgencyFilter) result = result.filter((o) => (o as any).customFields?.urgency === urgencyFilter);
    // 抢单池永远是「新单在最上面」。服务端已经按发布时间倒序返回，
    // 这里再排一次是为了不依赖接口顺序：以前这页直接用服务端顺序（最老的在前），
    // 结果客服在派单工作台看到自己刚发的单掉到列表最底部。
    return [...result].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [poolOrders, gameSearch, urgencyFilter]);

  // 店长/客服在派单工作台也要能直接看到“自己发布的订单”，
  // 否则订单一被抢或超时后，主订单池里就没有了，容易被误以为丢单。
  const myOrders = useMemo(() => {
    if (!user || user.role === 'COMPANION') return [];
    return allOrders
      .filter((o) => o.csUserId === user.id)
      .sort((a, b) => new Date(b.grabbedAt || b.createdAt).getTime() - new Date(a.grabbedAt || a.createdAt).getTime());
  }, [allOrders, user]);

  return (
    <div>
      <Tabs
        activeKey={activeTab}
        animated={false}
        onChange={(key) => {
          setActiveTab(key);
          if (key === 'followup' || key === 'converted') {
            setCustomerRefresh((v) => v + 1);
          }
        }}
        items={[
          {
            key: 'dispatch',
            label: <span style={{ color: '#1677ff', fontWeight: 600 }}>派单工作台</span>,
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
                  <Space>
                    <Button type="primary" icon={React.createElement(PlusOutlined)} onClick={() => { setDirectAddMode(false); setEditingOrder(null); setModalOpen(true); }}>
                      发布订单
                    </Button>
                    <Button icon={React.createElement(PlusOutlined)} onClick={() => { setDirectAddMode(true); setEditingOrder(null); setModalOpen(true); }}>
                      直接添加客户
                    </Button>
                  </Space>
                </div>

      <Row
        gutter={6}
        style={{ background: '#F8FAFC', borderRadius: 10, padding: 8, minHeight: 'calc(100vh - 160px)' }}
      >
        {/* Left: Companion sidebar */}
        <Col flex={fixedColumnFlex(PERSONNEL_COLUMN_WIDTH)} style={fixedColumnStyle(PERSONNEL_COLUMN_WIDTH)}>
          <Card
            title={<span style={{ fontSize: 13, fontWeight: 600 }}>人员</span>}
            size="small"
            className="personnel-list-card"
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
            <div
              onClick={openStudioGroupChat}
              style={{
                padding: '8px 10px',
                margin: '2px 3px 8px',
                borderRadius: 8,
                cursor: 'pointer',
                background: groupUnread > 0 ? '#EEF2FF' : '#F8FAFC',
                border: groupUnread > 0 ? '1px solid #C7D2FE' : '1px solid transparent',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span style={{ fontSize: 18 }}>🏠</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Text strong style={{ fontSize: 13, color: '#1F2937' }}>
                    {studioGroup?.groupName || '工作室群聊'}
                  </Text>
                  {groupLastMentions.includes(user?.id || '') && (
                    <Tag color="red" style={{ margin: 0, fontSize: 10, lineHeight: '16px' }}>@</Tag>
                  )}
                  {groupUnread > 0 && (
                    <Badge count={groupUnread} size="small" overflowCount={99} style={{ marginLeft: 'auto' }} />
                  )}
                </div>
                <Text
                  style={{
                    display: 'block',
                    marginTop: 2,
                    fontSize: 11,
                    color: groupUnread > 0 ? '#475569' : '#94A3B8',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {groupLastMessage || '暂无消息'}
                </Text>
              </div>
            </div>
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
                  const isSelected = !!c.id && activeChatUserId === c.id;
                  const companionConvUnread = unreadByParticipant[c.id] || 0;
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
                        Object.values(store.conversations).forEach((conv) => {
                          if (conv.participant?.userId === c.id) {
                            store.markRead(conv.id);
                          }
                        });
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
                              orderInfo: null,
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
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                minWidth: 0,
                              }}
                            >
                              {c.displayName || c.username || c.id}
                            </span>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                              <span style={{ fontSize: 10, color: statusDotColor(c) }}>●</span>
                              <span style={{ fontSize: 11, color: '#475569' }}>{displayStatus(c).label}</span>
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
        {/* basis 必须是 0：行内容（订单信息那一长串）比列宽还宽时，flex-basis:auto
            会把这一列顶到 Row 的下一行，「订单池」整块就掉到人员列表下面去了。
            锁成 0 + minWidth:0，让它老老实实占右边剩余宽度，内容自己在内部换行。 */}
        <Col flex="1 1 0%" style={{ minWidth: 0, maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' }}>
          <div style={{ position: 'relative', marginBottom: 12 }}>
            {/* Order pool header */}
            <div
              style={{
                background: '#FFFFFF',
                borderRadius: '8px 8px 0 0',
                padding: '10px 14px',
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
              {poolError && (
                <div style={{ marginTop: 8, padding: '4px 8px', color: '#EF4444', fontSize: 12, background: '#FEF2F2', borderRadius: 6 }}>
                  {poolError}
                </div>
              )}
            </div>
            {/* Pool body */}
            <div
              style={{
                background: '#FFF',
                borderRadius: '0 0 16px 16px',
                padding: '10px 12px',
                minHeight: 0,
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
                          className="order-pool-row"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: DATA_ROW_PADDING,
                            background: '#fff',
                            borderBottom: '1px solid #f0f0f0',
                            fontSize: DATA_FONT_SIZE,
                            color: '#1f2329',
                          }}
                        >
                          {/* 字段区自己换行，不要靠 nowrap 把行撑宽（撑宽会把整列挤到下一行） */}
                          <div
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              alignItems: 'center',
                              gap: '4px 10px',
                              flex: '1 1 auto',
                              minWidth: 0,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {fields.map((t, i) => (
                              <React.Fragment key={i}>
                                {i > 0 && <span style={{ color: '#c9cdd4' }}>|</span>}
                                <span>{t}</span>
                              </React.Fragment>
                            ))}
                          </div>
                          <div style={{ flexShrink: 0 }}>
                          {user?.role === 'COMPANION' ? (
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
                          ) : (
                            canEditOrder(order) && (
                              <Space size={8}>
                                <Button
                                  size="small"
                                  icon={React.createElement(EditOutlined)}
                                  onClick={() => {
                                    setEditingOrder(order);
                                    setDispatchPrefill(null);
                                    setDirectAddMode(false);
                                    setModalOpen(false);
                                  }}
                                >
                                  修改
                                </Button>
                              </Space>
                            )
                          )}
                          </div>
                        </div>
                      </List.Item>
                    );
                  }}
                />
              )}
            </div>
          </div>

          {user && user.role !== 'COMPANION' && (
            <Card size="small" style={{ marginTop: 12 }} title={`我发布的订单（${myOrders.length}）`}>
              {myOrders.length === 0 ? (
                <EmptyState description="暂无你发布的订单" />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {myOrders.map((o, idx) => (
                    <OrderRow key={o.id} order={o} index={idx} renderActions={() => null} />
                  ))}
                </div>
              )}
            </Card>
          )}
        </Col>

        {/* Right: Stats + Chat panel */}
        <Col flex={fixedColumnFlex(QUICK_STATS_COLUMN_WIDTH)} style={fixedColumnStyle(QUICK_STATS_COLUMN_WIDTH)}>
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
        </Col>
      </Row>
              </>
            ),
          },
          {
            key: 'pending',
            label: <span style={{ color: '#1677ff', fontWeight: 600 }}>订单池流转失败明细</span>,
            children: <UrgentOrdersPanel onDispatch={handleDispatch} onGotoFollowup={() => setActiveTab('followup')} />,
          },
          {
            key: 'followup',
            label: <span style={{ color: '#16A34A', fontWeight: 600 }}>管理端直添客户跟进列表</span>,
            children: <CsFollowupPanel refreshSignal={customerRefresh} onDispatch={handleDispatch} />,
          },
          {
            key: 'converted',
            label: <span style={{ color: '#16A34A', fontWeight: 600 }}>管理端直添客户流转明细</span>,
            children: <CsConvertedPanel refreshSignal={customerRefresh} />,
          },
        ]}
      />

      <CreateOrderModal
        open={modalOpen || !!editingOrder}
        directAddMode={directAddMode}
        onClose={() => {
          setModalOpen(false);
          setDispatchPrefill(null);
          setDispatchSourceOrderId(null);
          setDirectAddMode(false);
          setEditingOrder(null);
        }}
        onCreated={() => {
          fetchPool();
          setEditingOrder(null);
          if (dispatchSourceOrderId) {
            ordersApi.markPoolHandled(dispatchSourceOrderId).catch(() => {});
            setDispatchSourceOrderId(null);
          }
        }}
        userId={useAuthStore.getState().user?.id}
        editingOrder={editingOrder || undefined}
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
