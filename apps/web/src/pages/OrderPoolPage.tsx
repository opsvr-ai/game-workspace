// craftsman-ignore: TS001,TS002
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Button, Typography, Tag, Row, Col, message, Progress, Space, Badge, List, Input, Spin } from 'antd';
import { PlusOutlined, ReloadOutlined, ClockCircleOutlined, MessageOutlined, EditOutlined } from '@ant-design/icons';
import { ordersApi } from '../api/orders';
import { companionsApi } from '../api/companions';
import { configApi } from '../api/config';
import { chatApi } from '../api/chat';
import { useAuthStore } from '../stores/authStore';
import { useOrderStore } from '../stores/orderStore';
import { useChatStore } from '../stores/chatStore';
import ChatModal from '../components/ChatModal';
import CreateOrderModal from '../components/CreateOrderModal';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import CardSkeleton from '../components/CardSkeleton';
import TierBadge from '../components/TierBadge';

import { orderTypeConfig, serviceTypeConfig } from '../constants/orders';
import { personnelGroupRank, isPersonnelOnline, displayStatus, statusDotColor } from '../constants/companions';
import { PERSONNEL_COLUMN_WIDTH, fixedColumnFlex, fixedColumnStyle } from '../constants/layout';
import { buildOrderInfoFields, fmtClock } from '../utils/orderPool';
import {
  DATA_FONT_SIZE,
  DATA_ROW_PADDING,
  DATA_SUB_FONT_SIZE,
  DATA_TAG_FONT_SIZE,
} from '../constants/datasetColumns';
import { visibleInterval } from '../hooks/usePolling';

const { Text } = Typography;

/** 已被抢走的单在灰色记录里显示的进度文案（老板 2026-09-21） */
const TAKEN_STATUS_LABEL: Record<string, string> = {
  GRABBED: '已被抢',
  CLAIMED: '客服处理中',
  CONFIRMED: '服务中',
  DONE: '已完成',
  CANCELLED: '已取消',
};

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
  const [editingOrder, setEditingOrder] = useState<any>(null);

  // Chat state
  const [chatPartner, setChatPartner] = useState<any>(null);
  const conversations = useChatStore((s) => s.conversations);

  // Companion sidebar state (visible to companion users)
  const [companions, setCompanions] = useState<any[]>([]);
  const [loadingCompanions, setLoadingCompanions] = useState(false);
  const [companionSearch, setCompanionSearch] = useState('');
  const [studioGroup, setStudioGroup] = useState<{ id: string; groupName: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [disappearMinutes, setDisappearMinutes] = useState(10);
  const [scheduledDisappearMinutes, setScheduledDisappearMinutes] = useState(60);

  // 人员列表收起 / 展开：陪玩的头等大事是抢单，宽度该留给订单池。
  // 记住选择，下次打开保持上次的样子，不用每次都点。
  const [personnelCollapsed, setPersonnelCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('chunlv.pool.personnelCollapsed') === '1';
    } catch {
      return false;
    }
  });
  const togglePersonnel = () => {
    setPersonnelCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem('chunlv.pool.personnelCollapsed', next ? '1' : '0');
      } catch {
        /* 隐私模式下写不了就当没记 */
      }
      return next;
    });
  };

  useEffect(() => {
    // 订单池倒计时和“已等待”展示需要刷新，但不用太频繁；15 秒足够顺滑。
    const t = setInterval(() => setNow(Date.now()), 15000);
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

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      if (isCompanion) {
        // 状态接口失败不应把订单列表一起丢掉；订单列表成功就正常显示。
        const [poolRes, statusRes] = await Promise.allSettled([ordersApi.pool(), ordersApi.poolStatus()]);
        if (poolRes.status === 'fulfilled') {
          setOrders(poolRes.value.data.data ?? []);
        }
        if (statusRes.status === 'fulfilled') {
          setPoolStatus(statusRes.value.data.data);
        }
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

  // 周期轮询：中等马/下等马要等延迟后订单才可见，轮询让订单自动出现，无需手动刷新。
  // 之前改成 60 秒导致「闪现后消失、迟迟不出现」；这里恢复为 15 秒，兼顾实时性与带宽。
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') fetchData(true);
    }, 15000);
    return () => clearInterval(timer);
  }, [fetchData]);

  const fetchCompanions = useCallback(async () => {
    if (!isCompanion) return;
    setLoadingCompanions(true);
    try {
      const { data } = await companionsApi.listPersonnel({ includeBridged: true });
      // 订单池左侧人员列表统一显示所有角色（陪玩/客服/店长/老板），不因心跳过期而隐藏。
      const personnel = (data.data ?? []).map((c: any) => ({
        ...c,
        user: {
          id: c.id,
          username: c.username,
          displayName: c.displayName,
          avatar: c.avatar,
        },
      }));
      setCompanions(personnel);
    } catch {
      // 自动刷新失败不打断主流程
    } finally {
      setLoadingCompanions(false);
    }
  }, [isCompanion]);

  useEffect(() => {
    if (!isCompanion) return;
    fetchCompanions();
    const timer = visibleInterval(fetchCompanions, 120000);
    return () => clearInterval(timer);
  }, [isCompanion, fetchCompanions]);

  const sortedCompanions = useMemo(
    () =>
      [...companions].sort((a, b) => {
        // 群聊固定在最上方单独渲染，这里只排人员：客服 → 店长 → 在线空闲陪玩 →
        // 在线接单中陪玩 → 在线娱乐中陪玩 → 离线人员；同组内按昵称排。
        const aGroup = personnelGroupRank(a);
        const bGroup = personnelGroupRank(b);
        if (aGroup !== bGroup) return aGroup - bGroup;
        const aName = a.user?.displayName || a.user?.username || '';
        const bName = b.user?.displayName || b.user?.username || '';
        return aName.localeCompare(bName, 'zh-CN');
      }),
    [companions],
  );

  const filteredCompanions = companionSearch
    ? sortedCompanions
        .filter((c) => {
          const name = c.user?.displayName || c.user?.username || '';
          return name.toLowerCase().includes(companionSearch.toLowerCase());
        })
    : sortedCompanions;

  // 订单池实时刷新统一由 AppLayout 的全局 Socket 触发。
  // urgent 弹窗出现的同时会派发该事件，避免页面级 Socket 和全局 Socket 状态不一致。
  useEffect(() => {
    const refreshPool = () => fetchData(true);
    window.addEventListener('chunlv:order-pool-updated', refreshPool);
    return () => window.removeEventListener('chunlv:order-pool-updated', refreshPool);
  }, [fetchData]);

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

  // 陪玩端小窗口里，新发布的订单应该出现在最上面，而不是滚到底部才看到。
  const sortedOrders = useMemo(
    () =>
      [...orders].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [orders],
  );

  // 老板 2026-09-21：订单池以前只显示「还没被抢走」的单，陪玩一忙 / 一看视频就以为
  // 工作室没单，其实是被别人抢走了。现在把今天已经发出去、已经被抢的单也显示出来
  // （灰色、不可抢），大家一眼能看到「今天发过这些单」。
  const availableOrders = useMemo(() => sortedOrders.filter((o: any) => !o._taken), [sortedOrders]);
  const takenOrders = useMemo(() => sortedOrders.filter((o: any) => o._taken), [sortedOrders]);

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
    // 语音通话/聊天都需要真实 userId（JWT 里的 sub），而不是 companionId。
    // /companions 接口里 user.id 才是 User id，companion.id 是 Companion 模型 id。
    const targetUserId = companion.user?.id || companion.id;
    await useChatStore.getState().openConversation(
      companion.id,
      {
        userId: targetUserId,
        username: companion.user?.username || companion.id,
        displayName: companion.user?.displayName || companion.user?.username || companion.id,
        avatar: companion.user?.avatar,
        role: 'COMPANION',
      },
    );
    setChatPartner({
      conversationId: companion.id,
      participant: {
        userId: targetUserId,
        username: companion.user?.username || companion.id,
        displayName: companion.user?.displayName || companion.user?.username || companion.id,
        avatar: companion.user?.avatar,
        role: 'COMPANION',
      },
    });
  };

  const openStudioGroupChat = async () => {
    // 首屏拉取失败（超时/被限流）时兜底重拉一次，避免群聊入口点了没反应。
    let group = studioGroup;
    if (!group?.id) {
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
    setChatPartner({
      conversationId: group.id,
      participant: {
        userId: '',
        username: group.groupName,
        displayName: group.groupName,
        role: 'GROUP',
      },
    });
  };

  const groupConversation = studioGroup ? conversations[studioGroup.id] : undefined;
  const groupUnread = groupConversation?.unreadCount || 0;
  const groupLastMessage = groupConversation?.lastMessage || '';
  const groupLastMessageAt = groupConversation?.lastMessageAt || 0;
  const groupLastMentions = groupConversation?.lastMentions || [];

  if (loading) {
    return (
      <div>
        <PageHeader title="📦 订单池" />
        <CardSkeleton lines={6} />
      </div>
    );
  }

  // 每日「立即打」名额（老板 2026-09-20：取代原来的流水门槛）
  const quotaRemaining = Number(poolStatus?.remaining ?? 0);
  const quotaLimit = Number(poolStatus?.dailyLimit ?? 0);
  const quotaUsedToday = Number(poolStatus?.usedToday ?? 0);

  const canEditOrder = (order: any) => {
    if (!role || role === 'COMPANION' || order.dispatchType !== 'POOL') return false;
    if (role === 'CS') return order.csUserId === user?.id;
    if (role === 'ADMIN') return order.studioId === user?.studioId;
    return role === 'OWNER';
  };

  // Render a single pool card row
  const renderPoolCard = (order: any, idx: number) => {
    // 已被抢走的单：整行灰掉、不能点、右侧只说明「被谁抢走了 / 什么时候」。
    const taken = !!order._taken;
    const fields = buildOrderInfoFields(order, now, disappearMinutes, scheduledDisappearMinutes, {
      taken,
    });

    return (
      <div
        key={order.id}
        className="order-pool-row"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: DATA_ROW_PADDING,
          background: taken ? '#FAFAFA' : '#fff',
          borderBottom: '1px solid #f0f0f0',
          borderLeft: taken ? '3px solid #E2E8F0' : '3px solid transparent',
          fontSize: DATA_FONT_SIZE,
          color: taken ? '#9AA3AF' : '#1f2329',
        }}
      >
        {/* 订单信息太长时只让这一块横向滚动，抢单按钮永远钉在最右侧，不被挤出屏幕 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flex: '1 1 auto',
            minWidth: 0,
            overflowX: 'auto',
            whiteSpace: 'nowrap',
            scrollbarWidth: 'thin',
          }}
        >
          {fields.map((t, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span style={{ color: '#c9cdd4' }}>|</span>}
              <span>{t}</span>
            </React.Fragment>
          ))}
          {order.customFields?.csCultivated === true && (
            <Tag color="cyan" style={{ margin: 0, fontSize: DATA_TAG_FONT_SIZE }}>
              ✅ 客服已加过微信，请知悉
            </Tag>
          )}
        </div>
        <div style={{ flexShrink: 0 }}>
        {taken ? (
          <Space size={8}>
            <Tag
              style={{
                margin: 0,
                fontSize: DATA_TAG_FONT_SIZE,
                color: order._takenByMe ? '#16A34A' : '#64748B',
                background: order._takenByMe ? '#F0FDF4' : '#EEF2F6',
                borderColor: order._takenByMe ? '#BBF7D0' : '#E2E8F0',
              }}
            >
              {order._takenByMe ? '✅ 你已抢到这单' : `已被 ${order._takenByName || '其他陪玩'} 抢走`}
            </Tag>
            {/* 「已被 XX 抢走」已经写明白了，这里只在后面还有进展（服务中/已完成）时才补一句 */}
            {order.status !== 'GRABBED' && (
              <Text type="secondary" style={{ fontSize: DATA_SUB_FONT_SIZE }}>
                {TAKEN_STATUS_LABEL[order.status] || order.status}
              </Text>
            )}
          </Space>
        ) : isCompanion ? (
          <Space size={8}>
            {order.companionId && <Text type="danger" style={{ fontSize: DATA_SUB_FONT_SIZE }}>客服指定给你接</Text>}
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
              loading={grabbing === order.id}
              onClick={() => handleGrab(order.id)}
            >
              抢单
            </Button>
          </Space>
        ) : (
          <Space size={8}>
            <Text type="secondary" style={{ fontSize: DATA_SUB_FONT_SIZE }}>
              发布:{order.csUser?.username || order.customFields?.createdBy || '未知'}
            </Text>
            {canEditOrder(order) && (
              <Button
                size="small"
                icon={React.createElement(EditOutlined)}
                onClick={() => setEditingOrder(order)}
              >
                修改
              </Button>
            )}
            <Text type="secondary" style={{ fontSize: DATA_SUB_FONT_SIZE }}>待派单</Text>
          </Space>
        )}
        </div>
      </div>
    );
  };

  const renderCompanionSidebar = () => (
    <Col flex={fixedColumnFlex(PERSONNEL_COLUMN_WIDTH)} style={fixedColumnStyle(PERSONNEL_COLUMN_WIDTH)}>
      <Card
        title={<span style={{ fontSize: DATA_FONT_SIZE, fontWeight: 600 }}>人员</span>}
        size="small"
        className="personnel-list-card"
        style={{ borderRadius: 8 }}
        bodyStyle={{ padding: '8px 4px', maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}
      >
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
              <Text strong style={{ fontSize: DATA_FONT_SIZE, color: '#1F2937' }}>
                {studioGroup?.groupName || '工作室群聊'}
              </Text>
              {groupLastMentions.includes(user?.id || '') && (
                <Tag color="red" style={{ margin: 0, fontSize: DATA_TAG_FONT_SIZE, lineHeight: '16px' }}>@</Tag>
              )}
              {groupUnread > 0 && (
                <Badge count={groupUnread} size="small" overflowCount={99} style={{ marginLeft: 'auto' }} />
              )}
            </div>
            <Text
              style={{
                display: 'block',
                marginTop: 2,
                fontSize: DATA_SUB_FONT_SIZE,
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
        ) : filteredCompanions.length === 0 ? (
          <Text type="secondary">暂无陪玩</Text>
        ) : (
          <List
            size="small"
            dataSource={filteredCompanions}
            renderItem={(c) => {
              const avatarUrl = c.user?.avatar ? `/uploads/avatars/${c.user.avatar}?v=${c.user.avatar}` : null;
              const initial = (c.user?.displayName || c.user?.username || '?').slice(0, 1).toUpperCase();
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
                      {/* 第 1 行只放「段位 + 名字 + 聊天按钮」。
                          老板 2026-09-24：以前名字和状态挤在同一行，246px 的列表里
                          段位（50px）+ 状态（36px）+ 按钮（22px）把名字压到只剩 25px，
                          三个字的名字被截成「陈…」。状态挪到第 2 行，名字独占剩余宽度。 */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                        <TierBadge tier={c.tier} showLabel />
                        <span
                          title={c.user?.displayName || c.user?.username || c.id}
                          style={{
                            fontWeight: 600,
                            fontSize: DATA_FONT_SIZE,
                            color: '#1F2937',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            flex: '1 1 auto',
                            minWidth: 0,
                          }}
                        >
                          {c.user?.displayName || c.user?.username || c.id}
                        </span>
                        <Button
                          size="small"
                          type="text"
                          style={{ padding: 0, fontSize: DATA_FONT_SIZE, color: '#2563EB', height: 22, width: 22, flexShrink: 0 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            openCompanionChat(c);
                          }}
                        >
                          💬
                        </Button>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2, minWidth: 0, flexWrap: 'wrap' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                          <span style={{ fontSize: DATA_TAG_FONT_SIZE, color: statusDotColor(c) }}>●</span>
                          <span style={{ fontSize: DATA_SUB_FONT_SIZE, color: '#475569' }}>{displayStatus(c).label}</span>
                        </span>
                        {c.currentOrder && (
                          <span
                            style={{
                              fontSize: DATA_SUB_FONT_SIZE,
                              color: '#1677ff',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {orderTypeConfig[c.currentOrder.type]?.label || c.currentOrder.type} · {c.currentOrder.gameName}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
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
            {isCompanion && (
              <Button onClick={togglePersonnel}>{personnelCollapsed ? '显示人员' : '隐藏人员'}</Button>
            )}
            <Button type="primary" icon={React.createElement(PlusOutlined)} onClick={() => { setEditingOrder(null); setCreateOpen(true); }}>
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
        {isCompanion && !personnelCollapsed && renderCompanionSidebar()}
        {/* 同上：basis 0 + minWidth 0，避免订单内容太宽把整列挤到人员列表下面 */}
        <Col flex="1 1 0%" style={{ minWidth: 0 }}>
          {orders.length === 0 && (
            <EmptyState
              compact
              description="暂无待派订单 · 有新单会自动出现在这里（最新发布的排最上面）"
            />
          )}
          {availableOrders.length === 0 && takenOrders.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <EmptyState
                compact
                description="暂时没有可抢的新单 · 下面是今天已经发出去、已经被抢走的单（灰色）"
              />
            </div>
          )}

          {/* Horizontal order rows — all info in one row */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {availableOrders.map((order: any, idx: number) => renderPoolCard(order, idx))}
          </div>

          {takenOrders.length > 0 && (
            <>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginTop: 16,
                  marginBottom: 6,
                }}
              >
                <Text strong style={{ fontSize: DATA_FONT_SIZE, color: '#64748B' }}>
                  今天已发过的单（灰色 = 已被抢走）
                </Text>
                <Tag style={{ margin: 0, fontSize: DATA_TAG_FONT_SIZE }}>{takenOrders.length} 单</Tag>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {takenOrders.map((order: any, idx: number) => renderPoolCard(order, idx))}
              </div>
            </>
          )}

          {isCompanion && (
            <Card size="small" style={{ marginTop: 16 }}>
              <Text type="secondary">💡 抢单后可见客户联系方式和来源账号ID</Text>
            </Card>
          )}

          {/* 陪玩：今日「立即打」名额（含没抢完累计下来的） */}
          {isCompanion && poolStatus && (
            <Card
              size="small"
              style={{
                marginTop: 12,
                background: quotaRemaining > 0 ? '#f6ffed' : '#fff7e6',
              }}
            >
              <Row align="middle" justify="space-between">
                <Col>
                  <Text strong style={{ fontSize: DATA_FONT_SIZE }}>
                    今日名额 {quotaUsedToday}/{quotaLimit} 已用 ｜ 可用（含累计结余）{quotaRemaining} 个
                  </Text>
                </Col>
                <Col>
                  <Tag
                    color={quotaRemaining > 0 ? 'success' : 'warning'}
                    style={{ fontSize: DATA_TAG_FONT_SIZE, padding: '2px 10px' }}
                  >
                    {quotaRemaining > 0 ? `✅ 还能抢 ${quotaRemaining} 个立即打` : '名额用完了，明天自动补'}
                  </Tag>
                </Col>
              </Row>
            </Card>
          )}
        </Col>
      </Row>

      {/* Create Order Modal */}
      <CreateOrderModal
        open={createOpen || !!editingOrder}
        onClose={() => {
          setCreateOpen(false);
          setEditingOrder(null);
        }}
        onCreated={fetchData}
        userId={(user as any)?.id}
        editingOrder={editingOrder || undefined}
      />

      {/* Chat Modal */}
      <ChatModal open={!!chatPartner} partner={chatPartner} onClose={() => setChatPartner(null)} />
    </div>
  );
};

export default OrderPoolPage;
