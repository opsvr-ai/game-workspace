// craftsman-ignore: TS001,TS002
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Card, Button, Typography, Tag, Row, Col, message, Progress, Space, Badge, List, Input, Spin, Modal } from 'antd';
import { PlusOutlined, ReloadOutlined, ClockCircleOutlined, MessageOutlined, EditOutlined } from '@ant-design/icons';
import { ordersApi } from '../api/orders';
import { companionsApi } from '../api/companions';
import { configApi } from '../api/config';
import { chatApi } from '../api/chat';
import { useAuthStore } from '../stores/authStore';
import { useOrderStore } from '../stores/orderStore';
import { useChatStore } from '../stores/chatStore';
import CreateOrderModal from '../components/CreateOrderModal';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import CardSkeleton from '../components/CardSkeleton';
import TierBadge from '../components/TierBadge';
import { encodeOrderInfo, orderInfoTextOf } from '../utils/chatOrder';

import { orderStatusConfig, orderTypeConfig, serviceTypeConfig } from '../constants/orders';
import { personnelGroupRank, isPersonnelOnline, displayStatus, statusDotColor } from '../constants/companions';
import { PERSONNEL_COLUMN_WIDTH, fixedColumnFlex, fixedColumnStyle } from '../constants/layout';
import { buildOrderPoolFields } from '../utils/orderPool';
import OrderFieldLine from '../components/OrderFieldLine';
import {
  DATA_FONT_SIZE,
  DATA_ROW_PADDING,
  DATA_SUB_FONT_SIZE,
  DATA_TAG_FONT_SIZE,
} from '../constants/datasetColumns';
import { visibleInterval } from '../hooks/usePolling';
import { BG, BORDER, BRAND, SEMANTIC, TEXT } from '../styles/tokens';

const { Text } = Typography;

const OrderPoolPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const role = user?.role;

  const isCompanion = role === 'COMPANION';
  const navigate = useNavigate();
  const location = useLocation();
  // 点 Windows 新单横幅跳过来时，被点的那一单标黄 + 滚到屏幕中间（老板 2026-10-01）。
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const [orders, setOrders] = useState<any[]>([]);
  const [poolStatus, setPoolStatus] = useState<any>(null);
  // 「今日名额」点开看每天加了多少、用了多少（老板 2026-10-04）
  const [quotaDetailOpen, setQuotaDetailOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [grabbing, setGrabbing] = useState<string | null>(null);

  // Order-level unread tracking (populated via WebSocket order events, not localStorage)
  const [unreadMap, setUnreadMap] = useState<Record<string, number>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<any>(null);

  // Chat state
  const [chatPartner, setChatPartner] = useState<any>(null);
  // 全站只保留一个聊天窗口（AppLayout 里的全局 ChatModal）：页面这一层不再自己弹窗，
  // 只把「要打开谁」转交给全局那一个 —— 否则「订单页的聊天框」和「左侧消息面板的聊天框」
  // 会同时弹出，同一个人出现两个聊天框、也没法统一最小化（老板 2026-10-05）。
  useEffect(() => {
    if (!chatPartner) return;
    window.dispatchEvent(new CustomEvent('open-chat-modal', { detail: chatPartner }));
    setChatPartner(null);
  }, [chatPartner]);
  const conversations = useChatStore((s) => s.conversations);
  // 每个人（会话）的未读：人员列表据此把「有未读的人」顶到最上面 + 名字旁点红点
  // （老板 2026-10-05：「未读根本就不会置顶，有时候会看不到」）。
  const unreadByParticipant = useMemo(() => {
    const map: Record<string, number> = {};
    for (const conv of Object.values(conversations)) {
      const participantId = conv.participant?.userId;
      if (!participantId || conv.unreadCount <= 0) continue;
      map[participantId] = (map[participantId] || 0) + conv.unreadCount;
    }
    return map;
  }, [conversations]);

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
        // 有未读的人一律顶到最上面（老板 2026-10-05：「未读根本就不会置顶，有时候会看不到」）。
        const aMsg = unreadByParticipant[a.user?.id || a.id] > 0 ? 1 : 0;
        const bMsg = unreadByParticipant[b.user?.id || b.id] > 0 ? 1 : 0;
        if (aMsg !== bMsg) return bMsg - aMsg;
        // 群聊固定在最上方单独渲染，这里只排人员：客服 → 店长 → 在线空闲陪玩 →
        // 在线接单中陪玩 → 在线娱乐中陪玩 → 离线人员；同组内按昵称排。
        const aGroup = personnelGroupRank(a);
        const bGroup = personnelGroupRank(b);
        if (aGroup !== bGroup) return aGroup - bGroup;
        const aName = a.user?.displayName || a.user?.username || '';
        const bName = b.user?.displayName || b.user?.username || '';
        return aName.localeCompare(bName, 'zh-CN');
      }),
    [companions, unreadByParticipant],
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

  // 被点的那一单：横幅里点一下或而跳过来（路由带 state），都把它标黄。
  useEffect(() => {
    if (!isCompanion) return;
    const onFocus = (e: Event) => {
      const orderId = String((e as CustomEvent)?.detail?.orderId || '');
      if (orderId) setHighlightId(orderId);
    };
    window.addEventListener('chunlv:order-focus', onFocus);
    const fromRoute = String((location.state as any)?.highlightOrderId || '');
    if (fromRoute) setHighlightId(fromRoute);
    return () => window.removeEventListener('chunlv:order-focus', onFocus);
  }, [isCompanion, location.state]);

  // 标黄一段时间后自己跦掉；刚进页面时订单还在拉，等它出现了再滚到中间。
  useEffect(() => {
    if (!highlightId) return;
    let tries = 0;
    const scroller = setInterval(() => {
      const el = document.querySelector(`[data-order-id="${highlightId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        clearInterval(scroller);
      } else if (++tries > 20) {
        clearInterval(scroller);
      }
    }, 300);
    const clear = setTimeout(() => setHighlightId(null), 15000);
    return () => {
      clearInterval(scroller);
      clearTimeout(clear);
    };
  }, [highlightId]);

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
      orderInfo: encodeOrderInfo(orderInfoTextOf(order), order.id),
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

  // 每日抢单名额（老板 2026-09-20 起取代「流水门槛」；2026-10-04 改成抢单即扣、没用完累计）
  const quotaRemaining = Number(poolStatus?.remaining ?? 0);
  const quotaLimit = Number(poolStatus?.dailyLimit ?? 0);
  const quotaUsedToday = Number(poolStatus?.usedToday ?? 0);
  const quotaDays: any[] = Array.isArray(poolStatus?.days) ? poolStatus.days : [];
  const quotaLogs: any[] = Array.isArray(poolStatus?.recentLogs) ? poolStatus.recentLogs : [];
  const quotaReasonLabel: Record<string, string> = {
    GRANT: '每日发放',
    GRAB: '抢单扣减',
    REFUND: '抢单失败退回',
    SUPPLEMENT: '管理端补单返还',
    ADJUST: '人工调整',
  };
  const todayBusinessKey = (() => {
    const d = new Date();
    if (d.getHours() < 12) d.setDate(d.getDate() - 1);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  })();
  const fmtDay = (k: string) => (k === todayBusinessKey ? `${k}（今天）` : k);

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
    // 横幅里点过来的那一单：整行套全局那套「跳过来」高亮（紫色选中阴影），一会儿自己褪掉。
    const highlighted = highlightId === String(order.id);
    const fields = buildOrderPoolFields(order, now, disappearMinutes, scheduledDisappearMinutes, {
      taken,
      isCompanion,
      companionId: user?.companionId,
    });

    return (
      <div
        key={order.id}
        data-order-id={order.id}
        className={highlighted ? 'order-pool-row row-jump-focus' : 'order-pool-row'}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: DATA_ROW_PADDING,
          background: taken ? BG.hover : BG.container,
          borderBottom: `1px solid ${BORDER.secondary}`,
          borderLeft: taken ? `3px solid ${BORDER.base}` : '3px solid transparent',
          transition: 'background .3s ease',
          fontSize: DATA_FONT_SIZE,
          color: taken ? TEXT.tertiary : TEXT.primary,
        }}
      >
        {/* 订单字段：标签口径跟订单管理表 / 订单详情 / 客户管理是同一份（constants/orderFields.ts）。
            一行放不下就换行，抢单按钮永远钉在最右侧，不被挤出屏幕。 */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '4px 0',
            flex: '1 1 auto',
            minWidth: 0,
          }}
        >
          <OrderFieldLine items={fields} wrap />
          {order.customFields?.csCultivated === true && (
            <Tag color="cyan" style={{ margin: 0, fontSize: DATA_TAG_FONT_SIZE }}>
              ✅ 客服已加过微信，请知悉
            </Tag>
          )}
        </div>
        <div style={{ flexShrink: 0 }}>
        {taken ? (
          <Space size={8}>
            {/* 客服「指定」单（老板 2026-10-06）：不走抢单池，直接灰色列在这里，写清「指定给谁、已被接」，
                永远不给「抢单」按钮。紫色跟全局「跳过来」的选中阴影同一色系，一眼分得出是指定单。 */}
            <Tag
              style={{
                margin: 0,
                fontSize: DATA_TAG_FONT_SIZE,
                color: order._direct ? SEMANTIC.direct : order._takenByMe ? SEMANTIC.success : TEXT.secondary,
                background: order._direct ? SEMANTIC.directSoft : order._takenByMe ? SEMANTIC.successSoft : BORDER.track,
                borderColor: order._direct ? SEMANTIC.directBorder : order._takenByMe ? SEMANTIC.successBorder : BORDER.base,
              }}
            >
              {order._direct
                ? order._takenByMe
                  ? '🎯 这单指定给你'
                  : `🎯 客服指定给 ${order._takenByName || '其他陪玩'} 接`
                : order._takenByMe
                  ? '✅ 你已抢到这单'
                  : `已被 ${order._takenByName || '其他陪玩'} 抢走`}
            </Tag>
            {/* 「已被 XX 抢走」已经写明白了，这里只在后面还有进展（进行中 / 已完成）时才补一句。
                状态文字跟订单管理表是同一份（constants/orders.ts 的 orderStatusConfig）——
                以前这里另写了一套（客服处理中 / 服务中），跟表里对不上。 */}
            {order.status !== 'GRABBED' && (
              <Text type="secondary" style={{ fontSize: DATA_SUB_FONT_SIZE }}>
                {orderStatusConfig[order.status]?.label || order.status}
              </Text>
            )}
            {/* 客服指定给自己的单：这里没有「抢单」按钮，真正要做的动作是去「订单管理」点「开始首单」。
                从 Windows 横幅点过来的人一眼看到这个按钮就能直接过去，不用自己再翻菜单
                （老板 2026-10-06：「指定到某个陪玩，直接进订单管理，陪玩有时候可能注意不到」）。 */}
            {order._direct && order._takenByMe && order.status === 'GRABBED' && (
              <Button
                type="primary"
                size="small"
                onClick={() => navigate(`/companion/orders?orderId=${order.id}`)}
              >
                去开始首单
              </Button>
            )}
          </Space>
        ) : isCompanion ? (
          <Space size={8}>
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
            {/* 客服「指定」给你的单已经是你的了，**不给「抢单」按钮**（老板 2026-10-06：
                「发单者指定某个陪玩的订单，为什么还显示抢单按钮」）。正常路径下它本来就以
                「已被抢」的灰色行出现在下面那一段；这里兜的是历史/异常数据（companionId 已写、
                状态还停在待抢的单），保证这种单也永远点不出「抢单」。 */}
            {order.companionId ? (
              <Tag
                style={{
                  margin: 0,
                  fontSize: DATA_TAG_FONT_SIZE,
                  color: SEMANTIC.direct,
                  background: SEMANTIC.directSoft,
                  borderColor: SEMANTIC.directBorder,
                }}
              >
                🎯 客服指定给你接
              </Tag>
            ) : (
              <Button
                type="primary"
                size="small"
                danger
                loading={grabbing === order.id}
                onClick={() => handleGrab(order.id)}
              >
                抢单
              </Button>
            )}
          </Space>
        ) : (
          // 「发布」（发布人 + 时间）和「状态」左边那一行字段里已经有了，右边只留操作按钮。
          // 以前这里还各写一份（「发布:xxx」和「待派单」），同一份数据在两处长得不一样。
          <Space size={8}>
            {canEditOrder(order) && (
              <Button
                size="small"
                icon={React.createElement(EditOutlined)}
                onClick={() => setEditingOrder(order)}
              >
                修改
              </Button>
            )}
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
            background: groupUnread > 0 ? SEMANTIC.infoSoft : BG.base,
            border: groupUnread > 0 ? `1px solid ${SEMANTIC.infoBorder}` : '1px solid transparent',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ fontSize: 18 }}>🏠</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Text strong style={{ fontSize: DATA_FONT_SIZE, color: TEXT.primary }}>
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
                color: groupUnread > 0 ? TEXT.heading : TEXT.tertiary,
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
              // 未读消息**条数**（不是简单点个红点）—— 老板 2026-10-05：「要的是未读消息数」。
              const companionUnread = unreadByParticipant[c.user?.id || c.id] || 0;
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
                    e.currentTarget.style.background = BG.base;
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
                          background: avatarUrl ? `url(${avatarUrl}) center/cover` : BRAND.primary,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        {!avatarUrl && <span style={{ color: TEXT.inverse, fontSize: 15, fontWeight: 700 }}>{initial}</span>}
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
                          border: `2px solid ${BG.container}`,
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
                            color: TEXT.primary,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            flex: '1 1 auto',
                            minWidth: 0,
                          }}
                        >
                          {c.user?.displayName || c.user?.username || c.id}
                        </span>
                        {companionUnread > 0 && (
                          <Badge
                            count={companionUnread}
                            size="small"
                            overflowCount={99}
                            title={`${companionUnread} 条未读消息`}
                            style={{ flexShrink: 0 }}
                          />
                        )}
                        <Button
                          size="small"
                          type="text"
                          style={{ padding: 0, fontSize: DATA_FONT_SIZE, color: BRAND.primary, height: 22, width: 22, flexShrink: 0 }}
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
                          <span style={{ fontSize: DATA_SUB_FONT_SIZE, color: TEXT.heading }}>{displayStatus(c).label}</span>
                        </span>
                        {c.currentOrder && (
                          <span
                            style={{
                              fontSize: DATA_SUB_FONT_SIZE,
                              color: BRAND.primary,
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
        style={{ background: BG.base, borderRadius: 12, padding: 12, minHeight: 'calc(100vh - 160px)' }}
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
                <Text strong style={{ fontSize: DATA_FONT_SIZE, color: TEXT.secondary }}>
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
              {/* 客户来源（小红书…）对陪玩已隐藏（老板 2026-09-29），这条提示跟着改。 */}
              <Text type="secondary">💡 抢单后可见客户联系方式</Text>
            </Card>
          )}

          {/* 陪玩：没绑工作微信 → 抢不了单（老板 2026-10-02 方案 B），提前提醒，不要等点了才报错 */}
          {isCompanion && poolStatus && poolStatus.hasWorkWechat === false && (
            <Card
              size="small"
              style={{ marginTop: 12, background: BG.error, borderColor: SEMANTIC.dangerBorder }}
            >
              <Text strong style={{ color: SEMANTIC.dangerDeep, fontSize: DATA_FONT_SIZE }}>
                ⚠️ 你还没绑定工作微信，现在抢不了单
              </Text>
              <div style={{ marginTop: 4 }}>
                <Text type="secondary" style={{ fontSize: DATA_SUB_FONT_SIZE }}>
                  请让店长 / 客服到「工作微信 → 陪玩工作微信」帮你绑定你自己的号，绑好后立刻就能抢。
                </Text>
              </div>
            </Card>
          )}

          {/* 陪玩：今日抢单名额（抢单即扣；没用完的累计到明天） */}
          {isCompanion && poolStatus && (
            <Card
              size="small"
              style={{
                marginTop: 12,
                background: quotaRemaining > 0 ? SEMANTIC.successSoft : SEMANTIC.warningSoft,
              }}
            >
              <Row align="middle" justify="space-between">
                <Col>
                  <Text strong style={{ fontSize: DATA_FONT_SIZE }}>
                    今日抢单名额：已用 {quotaUsedToday} 个 ｜ 当前可用（含累计结余）{quotaRemaining} 个
                  </Text>
                  <div>
                    <Text type="secondary" style={{ fontSize: DATA_SUB_FONT_SIZE }}>
                      每天按段位发 {quotaLimit} 个，没用完的自动攒着；
                      <a onClick={() => setQuotaDetailOpen(true)} style={{ marginLeft: 4 }}>
                        点开看每天加/用明细
                      </a>
                    </Text>
                  </div>
                </Col>
                <Col>
                  <Tag
                    color={quotaRemaining > 0 ? 'success' : 'warning'}
                    style={{ fontSize: DATA_TAG_FONT_SIZE, padding: '2px 10px' }}
                  >
                    {quotaRemaining > 0 ? `✅ 还能抢 ${quotaRemaining} 个` : '名额用完了，明天自动补'}
                  </Tag>
                </Col>
              </Row>
            </Card>
          )}

          <Modal
            open={quotaDetailOpen}
            title="🎟️ 我的抢单名额明细"
            footer={null}
            onCancel={() => setQuotaDetailOpen(false)}
            width={560}
          >
            <Text style={{ fontSize: DATA_FONT_SIZE }}>
              段位 {poolStatus?.tier || '—'} ｜ 每天发 {quotaLimit} 个 ｜ 今天已用 {quotaUsedToday} 个 ｜
              当前可用 <Text strong>{quotaRemaining}</Text> 个
            </Text>
            <div>
              <Text type="secondary" style={{ fontSize: DATA_SUB_FONT_SIZE }}>
                抢单那一刻就扣 1 个名额；陪玩自己发的单、客服直接指定的单不占名额；
                线下工作室的预约单也算 1 个。客户没通过 → 让管理端点「同意补单」，名额就还你 1 个。
              </Text>
            </div>
            <div style={{ marginTop: 12 }}>
              <Text strong style={{ fontSize: DATA_FONT_SIZE }}>
                最近 14 天（+ 加 / − 用）
              </Text>
              <List
                size="small"
                dataSource={quotaDays}
                locale={{ emptyText: '还没有记录' }}
                renderItem={(d: any) => (
                  <List.Item>
                    <span style={{ fontSize: DATA_FONT_SIZE }}>{fmtDay(String(d.dayKey))}</span>
                    <span style={{ fontSize: DATA_FONT_SIZE }}>
                      <Text type="success">+{d.granted}</Text>
                      {'  '}
                      <Text type="danger">−{d.used}</Text>
                      {'  '}
                      <Text type="secondary">结余 {d.net}</Text>
                    </span>
                  </List.Item>
                )}
              />
            </div>
            <div style={{ marginTop: 12 }}>
              <Text strong style={{ fontSize: DATA_FONT_SIZE }}>
                最近明细
              </Text>
              <List
                size="small"
                dataSource={quotaLogs}
                locale={{ emptyText: '还没有记录' }}
                renderItem={(l: any) => (
                  <List.Item>
                    <span style={{ fontSize: DATA_FONT_SIZE }}>
                      {String(l.createdAt || '').slice(5, 16).replace('T', ' ')}
                      {'  '}
                      {quotaReasonLabel[l.reason] || l.reason}
                      {l.note ? <Text type="secondary">（{l.note}）</Text> : null}
                    </span>
                    <Text type={Number(l.delta) >= 0 ? 'success' : 'danger'} style={{ fontSize: DATA_FONT_SIZE }}>
                      {Number(l.delta) >= 0 ? `+${l.delta}` : l.delta}
                    </Text>
                  </List.Item>
                )}
              />
            </div>
          </Modal>
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

    </div>
  );
};

export default OrderPoolPage;
