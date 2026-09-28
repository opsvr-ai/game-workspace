// craftsman-ignore: TS001,TS002
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Typography,
  Button,
  Select,
  DatePicker,
  message,
  Badge,
  Tag,
  Image,
  Modal,
  Input,
  Tooltip,
  Space,
  Segmented,
  Table,
  Card,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { extractErrorMessage } from '../utils/error-handler';
import http from '../api/client';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import CreateOrderModal from '../components/CreateOrderModal';
import OrderDetailModal from '../components/OrderDetailModal';
import { buildOrderColumns } from '../components/orderColumns';
import { isRowClickIgnored } from '../utils/rowClick';
import { orderMatchesSearch } from '../utils/orderPool';
import { loadInactiveAccounts } from '../utils/inactiveTrafficAccounts';
import ChatModal from '../components/ChatModal';
import { orderStatusConfig } from '../constants';
import PageHeader from '../components/PageHeader';
import TableSkeleton from '../components/TableSkeleton';
import {
  ORDER_ACTIONS_COLUMN,
  ORDER_ACTIONS_COLUMN_COMPANION,
  ORDER_TABLE_KEYS,
  ORDER_TABLE_KEYS_COMPANION,
  TABLE_STYLE,
  sumWidths,
} from '../constants/datasetColumns';

const { Text } = Typography;
const { Option } = Select;

const OrdersPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const isCompanion = user?.role === 'COMPANION';
  const isCs = user?.role === 'CS';
  const navigate = useNavigate();

  // 陪玩点「添加成功 / 客户已同意」后，直接进入客户管理接着打首单；
  // 客服/店长一次要处理一批单，保持原地刷新，不跳走。
  const gotoCustomersAfterAdd = () => {
    if (isCompanion) navigate('/companion/customers');
  };

  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<any>(null);
  // 只读详情：没权限修改的订单（广播/指定等）也能整行点开看一眼
  const [detailOrder, setDetailOrder] = useState<any>(null);
  const [preFill, setPreFill] = useState<any>(null);
  const [dateFilter, setDateFilter] = useState<any>(null);
  const [typeFilter, setTypeFilter] = useState<string>('');
  // 客服端默认只看自己发布/认领的单，需要时可切到全店（服务端 scope 参数）
  const [csScope, setCsScope] = useState<'mine' | 'all'>('mine');
  // 陪玩端默认只看「我接的单」，需要时切到「我发的单」（服务端 scope 参数）
  const [companionScope, setCompanionScope] = useState<'taken' | 'published'>('taken');
  // 客户 / 游戏 / 派单人… 一个框全搜（原来只搜游戏名，2026-09-27 从派单记录并过来）
  const [orderSearch, setOrderSearch] = useState('');
  const [companionFilter, setCompanionFilter] = useState<string>('');
  // 来源账号旁边标「已弃用」：和订单池的行共用同一份缓存（老板 2026-09-27 派单记录并过来）
  const [inactiveAccounts, setInactiveAccounts] = useState<Set<string>>(new Set());
  useEffect(() => {
    let alive = true;
    loadInactiveAccounts()
      .then((inactive) => {
        if (alive) setInactiveAccounts(inactive);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  // 店长/老板按客服看派单记录（老板 2026-09-24）
  const [csFilter, setCsFilter] = useState<string>('');
  const [companions, setCompanions] = useState<any[]>([]);
  const [unreadMap, setUnreadMap] = useState<Record<string, number>>({});
  const [chatPartner, setChatPartner] = useState<any>(null);
  const [refundOrder, setRefundOrder] = useState<any>(null);
  const [refundReason, setRefundReason] = useState('');
  const [refundSubmitting, setRefundSubmitting] = useState(false);

  const canEditOrder = (r: any) => {
    if (!user || user.role === 'COMPANION' || r.dispatchType !== 'POOL' || r.status === 'CANCELLED') return false;
    if (user.role === 'CS') return r.csUserId === user.id;
    if (user.role === 'ADMIN') return r.studioId === user.studioId;
    return user.role === 'OWNER';
  };

  // 店长（看本店）/ 老板（看全部）能按派单人筛派单记录；客服、陪玩看不到这个筛选。
  const canFilterByCs = user?.role === 'ADMIN' || user?.role === 'OWNER';
  // 按岗位分组：客服 / 店长-老板 /「陪玩自己开的单」。
  // 老板 2026-09-24 问「筛选里怎么冒出来个徐泽宁」——陪玩端的「首单/续单/复购」由陪玩
  // 自己发起，订单发布人就是他本人（线上全站只有徐泽宁 1 条复购单，35 元），
  // 分组标题直接把这件事说明白，而不是把这条记录藏掉。
  const csGroupedOptions = useMemo(() => {
    if (!canFilterByCs) return [];
    const buckets: Record<string, Array<{ value: string; label: string }>> = {
      CS: [],
      ADMIN_OWNER: [],
      COMPANION: [],
    };
    const seen = new Set<string>();
    orders.forEach((o: any) => {
      const u = o.csUser;
      if (!u?.id || seen.has(u.id)) return;
      seen.add(u.id);
      const item = { value: u.id, label: u.displayName || u.username || u.id };
      if (u.role === 'CS') buckets.CS.push(item);
      else if (u.role === 'ADMIN' || u.role === 'OWNER') buckets.ADMIN_OWNER.push(item);
      else buckets.COMPANION.push(item);
    });
    const groups: Array<{ label: string; options: Array<{ value: string; label: string }> }> = [];
    if (buckets.CS.length > 0) groups.push({ label: '客服', options: buckets.CS });
    if (buckets.ADMIN_OWNER.length > 0) groups.push({ label: '店长 / 老板', options: buckets.ADMIN_OWNER });
    if (buckets.COMPANION.length > 0) groups.push({ label: '陪玩自己开的单', options: buckets.COMPANION });
    return groups;
  }, [orders, canFilterByCs]);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (statusFilter) params.status = statusFilter;
      if (isCs) params.scope = csScope;
      if (isCompanion) params.scope = companionScope;
      const { data } = await http.get('/orders', { params });
      setOrders(data.data?.items ?? data.data ?? []);
    } catch {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, isCs, csScope, isCompanion, companionScope]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  useEffect(() => {
    const refreshOrders = () => fetch();
    window.addEventListener('chunlv:order-pool-updated', refreshOrders);
    return () => window.removeEventListener('chunlv:order-pool-updated', refreshOrders);
  }, [fetch]);

  // Companion-only action buttons
  const renderCompanionActions = (r: any) => {
    const hasWorkWechat = r.customFields?.workWechatName || r.customFields?.workWechatId;
    const contactDisabled = !hasWorkWechat;

    return (
      <>
        <Badge count={unreadMap[r.id] || 0} size="small">
          <Button
            size="small"
            onClick={() => {
              localStorage.removeItem(`unread-${r.id}`);
              setUnreadMap((prev) => {
                const { [r.id]: _, ...rest } = prev;
                return rest;
              });
              const csUser = r.csUser;
              if (csUser?.id) {
                const orderInfo = [
                  `📋 ${r.gameName}`,
                  `¥${Number(r.amount).toFixed(0)}`,
                  r.duration ? `${r.duration}h` : '',
                ]
                  .filter(Boolean)
                  .join(' · ');
                useChatStore.getState().openConversation(
                  csUser.id,
                  {
                    userId: csUser.id,
                    username: csUser.username || '未知',
                    displayName: csUser.displayName,
                    avatar: csUser.avatar,
                    role: csUser.role || 'CS',
                  },
                  orderInfo,
                );
                setChatPartner({
                  conversationId: csUser.id,
                  participant: {
                    userId: csUser.id,
                    username: csUser.username || '未知',
                    displayName: csUser.displayName,
                    avatar: csUser.avatar,
                    role: csUser.role || 'CS',
                  },
                  orderInfo,
                });
              }
            }}
          >
            沟通
          </Button>
        </Badge>
        {(r.status === 'GRABBED' || r.status === 'CONFIRMED') && !r.contactStatus && (
          <>
            <Tooltip title={contactDisabled ? '请先在"工作微信"列选择微信' : undefined}>
              <Button
                type="primary"
                size="small"
                disabled={contactDisabled}
                style={{
                  background: contactDisabled ? undefined : '#16A34A',
                  borderColor: contactDisabled ? undefined : '#16A34A',
                }}
                onClick={async () => {
                  try {
                    await http.put(`/orders/${r.id}/contact`, { contactStatus: 'added' });
                    message.success('已添加成功，正在进入客户管理');
                    window.location.href = '/companion/customers';
                  } catch (e: any) {
                    message.error(extractErrorMessage(e, '操作失败'));
                  }
                }}
              >
                ✅ 添加成功
              </Button>
            </Tooltip>
            <Tooltip title={contactDisabled ? '请先在"工作微信"列选择微信' : undefined}>
              <Button
                danger
                size="small"
                disabled={contactDisabled}
                onClick={async () => {
                  try {
                    await http.put(`/orders/${r.id}/contact`, {
                      contactStatus: 'not_accepted',
                      notes: '客户一直没同意',
                    });
                    message.success('已标记添加失败');
                    fetch();
                  } catch (e: any) {
                    message.error(extractErrorMessage(e, '操作失败'));
                  }
                }}
              >
                ❌ 添加失败
              </Button>
            </Tooltip>
          </>
        )}
        {r.status === 'GRABBED' && r.contactStatus === 'not_accepted' && (
          <>
            <Tag color="orange">待客户同意</Tag>
            {r.screenshotUrl && <Image src={r.screenshotUrl} width={40} style={{ marginLeft: 4, borderRadius: 4 }} />}
            <Button
              type="primary"
              size="small"
              style={{ background: '#16A34A', borderColor: '#16A34A' }}
              onClick={async () => {
                try {
                  await http.put(`/orders/${r.id}/contact`, { contactStatus: 'added' });
                  message.success('已标记为客户同意');
                  fetch();
                } catch (e: any) {
                  message.error(extractErrorMessage(e, '操作失败'));
                }
              }}
            >
              客户已同意
            </Button>
          </>
        )}
        {r.status === 'DONE' && (
          <Button size="small" type="primary" onClick={() => {
            setPreFill({
              customerId: r.customerId,
              companionId: user?.companionId,
              coCompanionId: r.coCompanionId || undefined,
              gameName: r.gameName,
              amount: r.amount,
              coAmount: r.coAmount,
              dispatchType: 'DIRECT',
            });
            setCreateOpen(true);
          }}>续单</Button>
        )}
      </>
    );
  };

  // Load companions for filter + reassign
  useEffect(() => {
    http
      .get('/companions')
      .then(({ data }: any) => setCompanions(data.data || []))
      .catch(() => {});
  }, []);

  const [reassignOrder, setReassignOrder] = useState<any>(null);
  const [reassignCompanionId, setReassignCompanionId] = useState<string>('');
  const [reassignNote, setReassignNote] = useState('');
  const [paymentOrder, setPaymentOrder] = useState<any>(null);
  const [paidTo, setPaidTo] = useState<string>('');
  const [paymentAccountName, setPaymentAccountName] = useState('');

  const releaseClaim = async (r: any) => {
    try {
      await http.post(`/orders/${r.id}/release`, { urgency: 'now' });
      message.success('已放回抢单池并标记为立即打');
      fetch();
    } catch (e: any) {
      message.error(extractErrorMessage(e, '操作失败'));
    }
  };

  const openPayment = (r: any) => {
    setPaymentOrder(r);
    setPaidTo(r.customerPaidTo || '');
    setPaymentAccountName(r.customerPaymentAccountName || '');
  };

  const savePayment = async () => {
    if (!paymentOrder) return;
    try {
      await http.put(`/orders/${paymentOrder.id}/payment`, {
        customerPaidTo: paidTo || null,
        customerPaymentAccountName: paymentAccountName || null,
      });
      message.success('收款去向已保存');
      setPaymentOrder(null);
      fetch();
    } catch (e: any) {
      message.error(extractErrorMessage(e, '保存失败'));
    }
  };

  const renderAdminActions = (r: any) => (
    <>
      {r.status !== 'DONE' && r.status !== 'CANCELLED' && (
        <Button
          type="link"
          size="small"
          onClick={() => {
            setReassignOrder(r);
            setReassignCompanionId(r.companionId || '');
            setReassignNote('');
          }}
        >
          归属调整
        </Button>
      )}
      {r.status === 'CLAIMED' && (
        <Button size="small" type="primary" style={{ background: '#7C3AED', borderColor: '#7C3AED' }} onClick={() => releaseClaim(r)}>
          放回抢单池
        </Button>
      )}
      {(r.status === 'CLAIMED' || r.status === 'GRABBED' || r.status === 'CONFIRMED' || r.status === 'DONE') && (
        <Button size="small" onClick={() => openPayment(r)}>
          收款去向
        </Button>
      )}
      {r.contactStatus === 'not_accepted' && r.screenshotUrl && (
        <Image
          src={r.screenshotUrl}
          width={40}
          style={{ borderRadius: 4, cursor: 'pointer', marginLeft: 4 }}
          preview={{ mask: '查看' }}
        />
      )}
    </>
  );

  // 「操作」列：固定格子排布（2026-09-28 重做 —— 老板说这一列「很乱、不是对齐的」）。
  // 以前是「有哪个按钮就挨着摆」：同一个「退款」，在抢到的行里被排到中间、在没人抢的行里贴着左边；
  // 两个汉字的按钮还会被 antd 自动插一个空格（显示成「退 款」「沟 通」），图标又时有时无 —— 一列看下来就是乱的。
  // 现在：第一行永远是「修改 / 退款」，第二行永远是「沟通 / 添加成功 / 添加失败」，
  // 每个动作占一个固定宽度的格子（这一行没有这个动作就留空），所以同一个按钮在哪一行都在同一个位置；
  // 按钮统一纯文字、等宽（图标去掉，绿 / 红底色表意），高度沿用全站表格按钮规格（22px）。
  const ACTION_ROW: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, minHeight: 22 };
  const actionSlot = (w: number): React.CSSProperties => ({
    width: w,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
  });

  const renderActions = (r: any) => {
    const chatTarget = isCompanion
      ? r.csUser
        ? {
            id: r.csUser.id,
            username: r.csUser.username || '未知',
            displayName: r.csUser.displayName,
            avatar: r.csUser.avatar,
            role: r.csUser.role || 'CS',
          }
        : null
      : r.companion
        ? {
            id: r.companion.user?.id || r.companion.id,
            username: r.companion.user?.username || r.companion.id,
            displayName: r.companion.user?.displayName || r.companion.user?.username || '陪玩',
            avatar: r.companion.user?.avatar,
            role: 'COMPANION',
          }
        : null;
    const isCoCompanion = !!r.coCompanionId && r.companionId !== user?.companionId;
    // 客户微信加了没有：added=已添加 / not_accepted=客户没同意 / pending=还没标 / none=这单不用标
    const contactState = isCoCompanion
      ? 'none'
      : r.contactStatus === 'added'
        ? 'added'
        : r.contactStatus === 'not_accepted'
          ? 'not_accepted'
          : r.status === 'GRABBED' || r.status === 'CONFIRMED'
            ? 'pending'
            : 'none';
    const hasOrderRow = !isCompanion && r.status !== 'CANCELLED';
    const hasContactRow = !!chatTarget || contactState !== 'none';
    if (!hasOrderRow && !hasContactRow) return null;

    // 操作列：一行按顺序排 —— 沟通 → 添加成功 / 已同意 / 已添加 → 添加失败 → 修改 → 退款
    // （老板 2026-09-28：「修改 退款 显示在 添加失败后边」）。每个动作占一个固定宽度的格子，
    // 这一行没有这个动作就留空，所以同一个按钮在哪一行都是同一个位置；一行放得下就不用换行，
    // 数据行高统一 33px。
    return (
      <div style={ACTION_ROW}>
        <span style={actionSlot(36)}>
          {chatTarget && (
            <Badge count={unreadMap[r.id] || 0} size="small">
              <Button
                size="small"
                style={{ width: 36 }}
                onClick={() => {
                  localStorage.removeItem(`unread-${r.id}`);
                  setUnreadMap((prev) => {
                    const { [r.id]: _, ...rest } = prev;
                    return rest;
                  });
                  const orderInfo = [
                    `📋 ${r.gameName}`,
                    `¥${Number(r.amount).toFixed(0)}`,
                    r.duration ? `${r.duration}h` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ');
                  useChatStore.getState().openConversation(
                    chatTarget.id,
                    {
                      userId: chatTarget.id,
                      username: chatTarget.username,
                      displayName: chatTarget.displayName,
                      avatar: chatTarget.avatar,
                      role: chatTarget.role,
                    },
                    orderInfo,
                  );
                  setChatPartner({
                    conversationId: chatTarget.id,
                    participant: {
                      userId: chatTarget.id,
                      username: chatTarget.username,
                      displayName: chatTarget.displayName,
                      avatar: chatTarget.avatar,
                      role: chatTarget.role,
                    },
                    orderInfo,
                  });
                }}
              >
                沟通
              </Button>
            </Badge>
          )}
        </span>
        <span style={actionSlot(60)}>
          {contactState === 'added' ? (
            <Tag color="green" style={{ margin: 0 }}>
              已添加
            </Tag>
          ) : contactState === 'not_accepted' ? (
            <Button
              size="small"
              type="primary"
              style={{ width: 60, background: '#16A34A', borderColor: '#16A34A' }}
              onClick={async () => {
                try {
                  await http.put(`/orders/${r.id}/contact`, { contactStatus: 'added' });
                  message.success('已标记为客户同意');
                  fetch();
                  gotoCustomersAfterAdd();
                } catch (e: any) {
                  message.error(extractErrorMessage(e, '操作失败'));
                }
              }}
            >
              已同意
            </Button>
          ) : contactState === 'pending' ? (
            <Button
              size="small"
              type="primary"
              style={{ width: 60, background: '#16A34A', borderColor: '#16A34A' }}
              onClick={async () => {
                try {
                  await http.put(`/orders/${r.id}/contact`, { contactStatus: 'added' });
                  message.success('已添加成功');
                  fetch();
                  gotoCustomersAfterAdd();
                } catch (e: any) {
                  message.error(extractErrorMessage(e, '操作失败'));
                }
              }}
            >
              添加成功
            </Button>
          ) : null}
        </span>
        <span style={actionSlot(60)}>
          {contactState === 'pending' && (
            <Button
              size="small"
              danger
              style={{ width: 58 }}
              onClick={async () => {
                try {
                  await http.put(`/orders/${r.id}/contact`, {
                    contactStatus: 'not_accepted',
                    notes: '客户一直没同意',
                  });
                  message.success('已标记添加失败');
                  fetch();
                } catch (e: any) {
                  message.error(extractErrorMessage(e, '操作失败'));
                }
              }}
            >
              添加失败
            </Button>
          )}
        </span>
        <span style={actionSlot(36)}>
          {canEditOrder(r) && (
            <Button size="small" style={{ width: 36 }} onClick={() => setEditingOrder(r)}>
              修改
            </Button>
          )}
        </span>
        <span style={actionSlot(36)}>
          {hasOrderRow && (
            <Button
              size="small"
              danger
              style={{ width: 36 }}
              onClick={() => {
                setRefundOrder(r);
                setRefundReason('');
              }}
            >
              退款
            </Button>
          )}
        </span>
      </div>
    );
  };

  const submitRefund = async () => {
    if (!refundOrder) return;
    if (!refundReason.trim()) {
      message.warning('请填写退款原因');
      return;
    }
    setRefundSubmitting(true);
    try {
      await http.post(`/orders/${refundOrder.id}/refund`, { reason: refundReason.trim() });
      message.success('已退款，该订单不再计入利润与提成');
      setRefundOrder(null);
      setRefundReason('');
      fetch();
    } catch (e: any) {
      message.error(extractErrorMessage(e, '退款失败'));
    } finally {
      setRefundSubmitting(false);
    }
  };

  const sorted = [...orders]
    .sort((a: any, b: any) => {
      const aUnread = unreadMap[a.id] || 0;
      const bUnread = unreadMap[b.id] || 0;
      if (aUnread > 0 && bUnread === 0) return -1;
      if (bUnread > 0 && aUnread === 0) return 1;
      return new Date(b.grabbedAt || b.createdAt).getTime() - new Date(a.grabbedAt || a.createdAt).getTime();
    })
    .filter((o: any) => {
      if (!dateFilter) return true;
      return new Date(o.grabbedAt || o.createdAt).toDateString() === dateFilter.toDate().toDateString();
    })
    .filter((o: any) => {
      if (!typeFilter) return true;
      return o.type === typeFilter;
    })
    .filter((o: any) => {
      if (!orderSearch) return true;
      return orderMatchesSearch(o, orderSearch);
    })
    .filter((o: any) => {
      if (!companionFilter) return true;
      return o.companionId === companionFilter;
    })
    .filter((o: any) => {
      if (!csFilter) return true;
      return o.csUserId === csFilter;
    });

  // 订单管理的 8 列来自 components/orderColumns.tsx —— 和派单管理下面的三张订单列表共用同一份，
  // 保证「订单管理 / 流转失败明细 / 跟进列表 / 流转明细」四处的订单长得一模一样
  // （老板 2026-09-28：「流转失败列表页很混乱，你再查查所有角色所有页面 还有同样问题的么」）。
  const columns = [
    ...buildOrderColumns({ isCompanion, inactiveAccounts }),
    {
      title: '操作',
      key: 'actions',
      // 陪玩没有「修改 / 退款」这两个按钮，操作列窄 80px，省下来的宽度给「备注」列
      // （见 datasetColumns.ts 的 ORDER_ACTIONS_COLUMN_COMPANION）。
      ...(isCompanion ? ORDER_ACTIONS_COLUMN_COMPANION : ORDER_ACTIONS_COLUMN),
      render: (_: unknown, o: any) => renderActions(o),
    },
  ];

  return (
    <>
      <div>
        <PageHeader
          title={isCompanion ? (companionScope === 'published' ? '我发的单' : '接单记录') : '订单管理'}
          subtitle={
            isCompanion
              ? companionScope === 'published'
                ? '我自己发布过的订单（首单 / 续费 / 复购）'
                : '查看我的接单历史'
              : undefined
          }
          extra={
            <div style={{ display: 'flex', gap: 8 }}>
              <Select
                placeholder="全部状态"
                allowClear
                value={statusFilter || undefined}
                onChange={(v) => setStatusFilter(v || '')}
                style={{ width: 120 }}
              >
                {Object.entries(orderStatusConfig).map(([k, v]) => (
                  <Option key={k} value={k}>
                    {v.label}
                  </Option>
                ))}
              </Select>
              <DatePicker placeholder="筛选日期" value={dateFilter} onChange={setDateFilter} style={{ width: 140 }} />
              <Button icon={React.createElement(ReloadOutlined)} onClick={fetch} loading={loading}>
                刷新
              </Button>
            </div>
          }
        />
        {/* Filter bar */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <Input.Search
            placeholder="搜客户微信 / 小红书 / 昵称 / 编号 / 游戏名（空格分隔多个词）"
            allowClear
            value={orderSearch}
            onChange={(e) => setOrderSearch(e.target.value)}
            style={{ width: 300 }}
            size="small"
          />
          <Select
            placeholder="订单类型"
            allowClear
            value={typeFilter || undefined}
            onChange={(v) => setTypeFilter(v || '')}
            style={{ width: 100 }}
            size="small"
          >
            <Option value="NEW">首单</Option>
            <Option value="RENEW">续费</Option>
            <Option value="REPURCHASE">复购</Option>
            <Option value="TIP">打赏</Option>
          </Select>
          <Select
            placeholder="员工筛选"
            allowClear
            value={companionFilter || undefined}
            onChange={(v) => setCompanionFilter(v || '')}
            style={{ width: 130 }}
            size="small"
            showSearch
            optionFilterProp="children"
          >
            {companions.map((c: any) => (
              <Option key={c.id} value={c.id}>
                {c.user?.username || c.id.slice(0, 6)}
              </Option>
            ))}
          </Select>
          {canFilterByCs && (
            <Select
              placeholder="派单人筛选"
              allowClear
              value={csFilter || undefined}
              onChange={(v) => setCsFilter(v || '')}
              style={{ width: 150 }}
              size="small"
              showSearch
              optionFilterProp="label"
              options={csGroupedOptions}
            />
          )}
          {isCs && (
            <Segmented
              size="small"
              value={csScope}
              onChange={(v) => setCsScope(v as 'mine' | 'all')}
              options={[
                { label: '我的订单', value: 'mine' },
                { label: '全店订单', value: 'all' },
              ]}
            />
          )}
          {isCompanion && (
            <Segmented
              size="small"
              value={companionScope}
              onChange={(v) => setCompanionScope(v as 'taken' | 'published')}
              options={[
                { label: '我接的单', value: 'taken' },
                { label: '我发的单', value: 'published' },
              ]}
            />
          )}
          {(orderSearch || typeFilter || companionFilter || csFilter || dateFilter) && (
            <Text type="secondary" style={{ fontSize: 12, lineHeight: '24px' }}>
              筛选结果: {sorted.length}/{orders.length}
            </Text>
          )}
        </div>
        {/* 今日单量：一行灰字（原来三个彩色标签块，视觉噪音太大，老板 2026-09-28） */}
        <div style={{ fontSize: 12, color: '#64748B', marginBottom: 8 }}>
          今日抢单{' '}
          {
            orders.filter((o: any) => {
              const d = new Date(o.grabbedAt || o.createdAt).toDateString();
              return d === new Date().toDateString() && o.status !== 'CANCELLED';
            }).length
          }
          {' · 补单 '}
          {
            orders.filter((o: any) => {
              const d = new Date(o.grabbedAt || o.createdAt).toDateString();
              return d === new Date().toDateString() && (o.customFields?.deltaNote || o.notes || '').includes('补单');
            }).length
          }
          {' · 合计 '}
          {
            orders.filter(
              (o: any) => new Date(o.grabbedAt || o.createdAt).toDateString() === new Date().toDateString(),
            ).length
          }
        </div>{' '}
        {loading && orders.length === 0 ? (
          <TableSkeleton columns={5} rows={5} />
        ) : (
          <Card size="small" style={{ overflow: 'auto' }}>
            <Table
              className="data-table"
              rowKey="id"
              columns={columns as any}
              dataSource={sorted}
              size="small"
              pagination={false}
              style={TABLE_STYLE}
              scroll={{
                x: sumWidths(isCompanion ? ORDER_TABLE_KEYS_COMPANION : ORDER_TABLE_KEYS),
              }}
              locale={{
                emptyText: isCs && csScope === 'mine'
                  ? '暂无我发布的订单，可切到「全店订单」查看'
                  : isCompanion && companionScope === 'published'
                    ? '我还没发过订单'
                    : '暂无订单',
              }}
              // 整行可点：订单信息一长，右侧按钮容易被挤到看不见，点行也能进去
              onRow={(record: any) => ({
                style: { cursor: 'pointer' },
                onClick: (e: React.MouseEvent) => {
                  if (isRowClickIgnored(e)) return;
                  if (canEditOrder(record)) setEditingOrder(record);
                  else setDetailOrder(record);
                },
              })}
            />
          </Card>
        )}
        <Modal
          title="归属调整"
          open={!!reassignOrder}
          onOk={async () => {
            if (!reassignCompanionId) {
              message.warning('请选择陪玩');
              return Promise.reject();
            }
            try {
              await http.post(`/orders/${reassignOrder.id}/assign`, { companionId: reassignCompanionId });
              if (reassignNote)
                await http.put(`/orders/${reassignOrder.id}/contact`, { notes: `[归属调整] ${reassignNote}` });
              message.success('已重新分配');
              fetch();
              setReassignOrder(null);
            } catch (e: any) {
              message.error(extractErrorMessage(e, '分配失败'));
              return Promise.reject();
            }
          }}
          onCancel={() => setReassignOrder(null)}
          okText="确认调整"
          cancelText="取消"
          destroyOnClose
        >
          <div style={{ marginBottom: 12 }}>
            <Text>当前陪玩：{reassignOrder?.companion?.user?.username || '未分配'}</Text>
          </div>
          <div style={{ marginBottom: 12 }}>
            <Text>新陪玩：</Text>
            <Select
              value={reassignCompanionId || undefined}
              style={{ width: '100%' }}
              onChange={(v) => setReassignCompanionId(v)}
              placeholder="选择新员工"
            >
              {companions
                .filter((c: any) => c.status !== 'OFFLINE')
                .map((c: any) => (
                  <Option key={c.id} value={c.id}>
                    {c.user?.username || c.id.slice(0, 6)}
                  </Option>
                ))}
            </Select>
          </div>
          <div>
            <Text>备注：</Text>
            <Input.TextArea
              rows={3}
              value={reassignNote}
              onChange={(e) => setReassignNote(e.target.value)}
              placeholder="请填写归属调整原因"
            />
          </div>
        </Modal>
        <Modal
          title="💰 收款去向"
          open={!!paymentOrder}
          onOk={savePayment}
          onCancel={() => setPaymentOrder(null)}
          okText="保存"
          cancelText="取消"
        >
          <div style={{ marginBottom: 12 }}>
            <Text>客户实际付款到：</Text>
            <Select
              value={paidTo || undefined}
              placeholder="选择付款去向"
              style={{ width: '100%', marginTop: 8 }}
              onChange={(v) => setPaidTo(v)}
            >
              <Option value="CS_WECHAT">客服工作微信</Option>
              <Option value="COMPANION_WECHAT">陪玩微信</Option>
              <Option value="STUDIO_ACCOUNT">工作室收款账号</Option>
              <Option value="OTHER">其他</Option>
            </Select>
          </div>
          <div>
            <Text>收款账号名称/微信号：</Text>
            <Input
              value={paymentAccountName}
              onChange={(e) => setPaymentAccountName(e.target.value)}
              placeholder="例如：工作室微信1号 / 陪玩张三微信"
              style={{ marginTop: 8 }}
            />
          </div>
        </Modal>
      </div>
      <CreateOrderModal
        open={createOpen || !!editingOrder}
        onClose={() => {
          setCreateOpen(false);
          setPreFill(null);
          setEditingOrder(null);
        }}
        onCreated={() => {
          message.success(editingOrder ? '订单信息已更新' : '订单已创建');
          fetch();
          setCreateOpen(false);
          setPreFill(null);
          setEditingOrder(null);
        }}
        userId={user?.id}
        editingOrder={editingOrder || undefined}
        customerPreFill={preFill || undefined}
      />
      <ChatModal open={!!chatPartner} partner={chatPartner} onClose={() => setChatPartner(null)} />
      <OrderDetailModal order={detailOrder} open={!!detailOrder} onClose={() => setDetailOrder(null)} />
      <Modal
        title="退款"
        open={!!refundOrder}
        onOk={submitRefund}
        onCancel={() => setRefundOrder(null)}
        okText="确认退款"
        cancelText="取消"
        confirmLoading={refundSubmitting}
      >
        <div style={{ marginTop: 8 }}>
          <Text>
            确认对订单 <Text strong>{refundOrder?.gameName}</Text> 退款？退款后该订单不计入利润与客服提成。
          </Text>
          <Text strong style={{ display: 'block', marginTop: 12 }}>退款原因（必填）</Text>
          <Input.TextArea
            rows={3}
            value={refundReason}
            onChange={(e) => setRefundReason(e.target.value)}
            placeholder="例如：客户不满意要求退款 / 未按时开始"
            style={{ marginTop: 8 }}
          />
        </div>
      </Modal>
    </>
  );
};

export default OrdersPage;
