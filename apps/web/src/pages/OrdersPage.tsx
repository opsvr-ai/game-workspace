// craftsman-ignore: TS001,TS002
import React, { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
import { describeTransfer, transferWho } from '../components/OrderTransferNote';
import http from '../api/client';
import { ordersApi } from '../api/orders';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import CreateOrderModal from '../components/CreateOrderModal';
import OrderDetailModal from '../components/OrderDetailModal';
import OrderOutcomeModal, { orderChannelOf } from '../components/OrderOutcome';
import { buildOrderColumns } from '../components/orderColumns';
import { isRowClickIgnored } from '../utils/rowClick';
import { encodeOrderInfo, orderInfoTextOf } from '../utils/chatOrder';
import { orderMatchesSearch } from '../utils/orderPool';
import { loadInactiveAccounts } from '../utils/inactiveTrafficAccounts';
import ChatModal from '../components/ChatModal';
import { orderStatusConfig } from '../constants';
import { ORDER_FIELD_LABELS, ORDER_SEARCH_PLACEHOLDER } from '../constants/orderFields';
import PageHeader from '../components/PageHeader';
import TableSkeleton from '../components/TableSkeleton';
import { PartnerInviteCards } from '../components/PartnerInviteCards';
import {
  ORDER_ACTIONS_COLUMN,
  ORDER_ACTIONS_COLUMN_COMPANION,
  ORDER_TABLE_KEYS,
  ORDER_TABLE_KEYS_COMPANION,
  TABLE_STYLE,
  canSeeCustomerSource,
  fitOrderColumnWidths,
  sumWidths,
} from '../constants/datasetColumns';

const { Text } = Typography;
const { Option } = Select;

/**
 * 量「这张表真正能用的宽度」（订单管理表所在卡片内容区的宽度）。
 * 窗口一拉宽就重新算列宽：多出来的宽度补给客户信息列，操作列保持定宽
 * —— 老板 2026-09-29：「操作的退款后边不是还有很多空间么？不能让退款靠在最右边？
 * 让前边的客户信息全部显示出来？」（算法见 datasetColumns.ts 的 fitOrderColumnWidths）
 */
function useTableAvailWidth(): [(node: HTMLDivElement | null) => void, number] {
  // 用回调 ref 而不是 useRef：这张表是「数据回来之后才渲染」的（先出骨架屏），
  // useRef + 只跑一次的 effect 会在表格还没出现时就量完（量到 0），之后再也不量。
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  React.useLayoutEffect(() => {
    if (!node) return undefined;
    const update = () => setWidth(node.clientWidth);
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const ro = new ResizeObserver(update);
    ro.observe(node);
    return () => ro.disconnect();
  }, [node]);
  return [setNode, width];
}

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
  // 从聊天框点「查看订单」跳过来时带的订单 id（见下面的 focus 效果）
  const [searchParams, setSearchParams] = useSearchParams();
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
  // 陪玩端的三个口径（服务端 scope 参数），老板 2026-10-03：
  //   taken   = 我抢到的（挂在我名下的单，含转出的留痕、待我接手的转让）
  //   served  = 我服务的（别人抢到、我当搭档一起打的单；这一栏隐藏主陪的客户微信）
  //   published = 我发布的（我自己发起的第一单 / 续费 / 复购）
  const [companionScope, setCompanionScope] = useState<'taken' | 'served' | 'published'>('taken');
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
  // 线上 / 桥接单的结果反馈（老板 2026-09-29）：客服 / 店长点状态格或操作列的「记结果」都能打开
  const [outcomeOrder, setOutcomeOrder] = useState<any>(null);
  // 「线上→线下流转」的单提前放给本店线下陪玩（点状态格小字，走二次确认）
  const [releaseOrder, setReleaseOrder] = useState<any>(null);
  const [releaseSubmitting, setReleaseSubmitting] = useState(false);
  // 陪玩转让订单（老板 2026-09-29）；2026-10-03 起改成「发申请」，要对方同意才换手
  const [transferOrder, setTransferOrder] = useState<any>(null);
  const [transferToId, setTransferToId] = useState<string>('');
  const [transferReason, setTransferReason] = useState('');
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  // 我发起的、还没被同意的转让申请（按订单 id 索引）：这些单的「转让」按钮换成「撤回」，
  // 鼠标停上去看「在等谁同意」（老板 2026-10-03：「需要被转让方同意才能过来」）。
  const [outTransferMap, setOutTransferMap] = useState<Record<string, any>>({});
  // 正在处理的那条「别人转给我」的申请：点「接手 / 拒绝」时给按钮转圈，防连点。
  const [transferRespondId, setTransferRespondId] = useState<string>('');
  // 列宽按窗口宽度现算（老板 2026-09-29）：窗口宽出来的部分给客户信息列，操作列定宽
  const [tableWrapRef, tableAvailWidth] = useTableAvailWidth();
  const fittedColumns = fitOrderColumnWidths(tableAvailWidth);

  const canEditOrder = (r: any) => {
    if (!user || user.role === 'COMPANION' || r.dispatchType !== 'POOL' || r.status === 'CANCELLED') return false;
    if (user.role === 'CS') return r.csUserId === user.id;
    if (user.role === 'ADMIN') return r.studioId === user.studioId;
    return user.role === 'OWNER';
  };

  /**
   * 能不能给这张单记结果（老板 2026-09-29）：只有桥接 / 线上单要接单方反馈，
   * 本店线下的单看「开始首单」就自动算成功、不用记；还没人接的单也没结果可记。
   * 陪玩端不参与（反馈是客服 / 店长代录）。
   */
  const canRecordOutcome = (r: any) =>
    !isCompanion &&
    !!r.companionId &&
    r.status !== 'CANCELLED' &&
    !r.refundedAt &&
    orderChannelOf(r) !== 'offline';

  /**
   * 陪玩能不能转让这张单（老板 2026-09-29）。
   *
   * 「抢单超时自动回收」已经整条删除 —— 是谁抢的就是谁的；只有我抢到的、还没开始
   * 服务的单能自己转给别人（加了很久客户没通过 / 客户不满意时）。转完我自己那份
   * 接单记录还在，只是标成「已转让」。
   */
  const canTransfer = (r: any) =>
    isCompanion &&
    !!user?.companionId &&
    r.companionId === user.companionId &&
    (r.status === 'GRABBED' || r.status === 'CONFIRMED') &&
    !(r.sessions?.length && r.sessions[0]?.startedAt);

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

  // 从聊天框点「查看订单」跳过来：<角色>/orders?orderId=<id> —— 直接把那一单的详情弹窗打开
  // （老板 2026-09-30：「客服点击这个位置会跳转到该订单方便查看客户信息」）。
  // 先把参数从地址里抹掉，免得关掉弹窗 / 刷新页面时又自己弹回来；不在当前筛选范围里
  // （客服默认只看自己的单）就单独把这一单取回来。
  useEffect(() => {
    const focusId = searchParams.get('orderId');
    if (!focusId) return;
    if (loading && orders.length === 0) return;
    const next = new URLSearchParams(searchParams);
    next.delete('orderId');
    setSearchParams(next, { replace: true });
    const hit = orders.find((o: any) => o.id === focusId);
    if (hit) {
      setDetailOrder(hit);
      return;
    }
    ordersApi
      .getOrder(focusId)
      .then(({ data }: any) => {
        const one = data?.data;
        if (one?.id) setDetailOrder(one);
        else message.error('没找到这个订单');
      })
      .catch((e: any) => message.error(extractErrorMessage(e, '没找到这个订单')));
  }, [searchParams, setSearchParams, orders, loading]);

  useEffect(() => {
    const refreshOrders = () => fetch();
    window.addEventListener('chunlv:order-pool-updated', refreshOrders);
    // 有人把单转给我 / 我点了接手 / 对方撤回：列表也要跟着变 ——
    // 待我确认的那一行就是靠这个刷出来的（老板 2026-10-03）。
    window.addEventListener('chunlv:transfer-updated', refreshOrders);
    return () => {
      window.removeEventListener('chunlv:order-pool-updated', refreshOrders);
      window.removeEventListener('chunlv:transfer-updated', refreshOrders);
    };
  }, [fetch]);

  // 我发起的转让申请：刷新 / 重连后把「等待对方同意」的状态补回来（WS 只在发生时推一次）。
  useEffect(() => {
    if (!isCompanion || !user?.companionId) return;
    const load = () => {
      ordersApi
        .myTransferRequests()
        .then(({ data }: any) => {
          const list = data?.data?.outgoing || [];
          const map: Record<string, any> = {};
          list.forEach((r: any) => {
            map[r.orderId] = r;
          });
          setOutTransferMap(map);
        })
        .catch(() => {});
    };
    load();
    window.addEventListener('chunlv:transfer-updated', load);
    return () => window.removeEventListener('chunlv:transfer-updated', load);
  }, [isCompanion, user?.companionId]);

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
                // 「这一单」那行字带上订单 id / 单号：客服在聊天框里点一下就能跳到这张单
                const orderInfo = encodeOrderInfo(orderInfoTextOf(r), r.id);
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
    // 这张单现在挂的不是我（转让出去的单还留在转出方的接单记录里，老板 2026-09-29）：
    // 「添加成功 / 添加失败」这些动作只能由当前持有人点，我这边一律当成「不用标」，
    // 否则转出方会点到已经转给别人的单。
    const notMyOrder = isCompanion && r.companionId !== user?.companionId;
    // 「我转出去的」那一笔留痕：转出方的行要在「操作」列把「什么时候转给谁」写出来
    // （主陪 / 副陪 那列只有 84px，名字一长标记就被省略号吃掉了）。
    const myTransfer = (r.transfers || []).find((t: any) => t.fromCompanion?.id === user?.companionId);
    const showTransferNote = notMyOrder && !!myTransfer;
    // 别人要转给我、等我点同意的单（老板 2026-10-03）：这一行直接长出「接手 / 拒绝」，
    // 不再只靠顶栏铃铛 —— 单子本身就是从列表里点过来的。
    const incomingTransfer = isCompanion ? r.pendingTransferForMe || null : null;
    // 客户微信加了没有：added=已添加 / not_accepted=客户没同意 / pending=还没标 / none=这单不用标
    const contactState = isCoCompanion || notMyOrder
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
                  // 「这一单」那行字带上订单 id / 单号（同上，客服点了直接跳过去看客户信息）
                  const orderInfo = encodeOrderInfo(orderInfoTextOf(r), r.id);
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
        {showTransferNote && (
          <span
            style={{
              flex: '1 1 auto',
              minWidth: 0,
              fontSize: 11,
              color: '#C2410C',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={describeTransfer(myTransfer)}
          >
            已转让给 {transferWho(myTransfer.toCompanion)}（{new Date(myTransfer.createdAt).toLocaleString('zh-CN', { hour12: false })}）
          </span>
        )}
        {incomingTransfer && (
          <span
            style={{
              flex: '1 1 auto',
              minWidth: 0,
              fontSize: 11,
              color: '#C2410C',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={`${incomingTransfer.fromName || '同事'} 想把这张单转给你${
              incomingTransfer.reason ? `（原因：${incomingTransfer.reason}）` : ''
            }；点「接手」之后才算转过来`}
          >
            🔁 {incomingTransfer.fromName || '同事'} 想转给你
          </span>
        )}
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
          {contactState === 'pending' ? (
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
          ) : canRecordOutcome(r) ? (
            // 这一格平时被「添加失败」占着；客户微信已经加过（或这单不用标）时就空出来了，
            // 空出来正好放「记结果」—— 位置固定（永远第 3 格 60px），操作列宽度不变、行高不变。
            <Button size="small" style={{ width: 58 }} onClick={() => setOutcomeOrder(r)}>
              记结果
            </Button>
          ) : null}
        </span>
        <span style={actionSlot(36)}>
          {incomingTransfer ? (
            // 「接手」占的正是平时放「转让」的那一格：待我确认的单本来就没别的动作，
            // 位置固定、操作列不变宽。
            <Button
              size="small"
              type="primary"
              style={{ width: 36, background: '#16A34A', borderColor: '#16A34A' }}
              loading={transferRespondId === incomingTransfer.requestId}
              onClick={() => respondIncomingTransfer(incomingTransfer, true)}
            >
              接手
            </Button>
          ) : canEditOrder(r) ? (
            <Button size="small" style={{ width: 36 }} onClick={() => setEditingOrder(r)}>
              修改
            </Button>
          ) : outTransferMap[r.id] ? (
            // 已经发出转让申请、在等对方同意（老板 2026-10-03）：这一格换成「撤回」，
            // 鼠标停上去看「在等谁同意」，免得陪玩以为点了转让就转过去了。
            <Tooltip
              title={`已发出转让申请，等 ${outTransferMap[r.id].toName || '对方'} 点「同意」才转过去；点这里撤回`}
            >
              <Button size="small" danger style={{ width: 36 }} onClick={() => cancelTransfer(r)}>
                撤回
              </Button>
            </Tooltip>
          ) : canTransfer(r) ? (
            // 陪玩的「转让」正好占这一格：这格在陪玩行本来是空的，放进来不撑宽操作列
            // （老板 2026-09-29：谁抢的就是谁的，换手只能本人点这里）
            <Button size="small" style={{ width: 36 }} onClick={() => openTransfer(r)}>
              转让
            </Button>
          ) : null}
        </span>
        <span style={actionSlot(36)}>
          {incomingTransfer ? (
            // 「拒绝」占的是陪玩行本来就空着的「退款」那一格（退款只有客服 / 店长有）。
            <Button
              size="small"
              danger
              style={{ width: 36 }}
              loading={transferRespondId === incomingTransfer.requestId}
              onClick={() => respondIncomingTransfer(incomingTransfer, false)}
            >
              拒绝
            </Button>
          ) : (
            hasOrderRow && (
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
            )
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

  const submitRelease = async () => {
    if (!releaseOrder) return;
    setReleaseSubmitting(true);
    try {
      await ordersApi.releaseToOffline(releaseOrder.id);
      message.success('已放给本店线下陪玩，现在线下可以抢这单了');
      setReleaseOrder(null);
      fetch();
    } catch (e: any) {
      message.error(extractErrorMessage(e, '操作失败'));
    } finally {
      setReleaseSubmitting(false);
    }
  };

  const openTransfer = (r: any) => {
    setTransferOrder(r);
    setTransferToId('');
    // 客户一直没通过是最常见的转让原因，先替陪玩填上，能改能清。
    setTransferReason(r.contactStatus === 'not_accepted' ? '客户一直没通过' : '');
  };

  const submitTransfer = async () => {
    if (!transferOrder) return;
    if (!transferToId) {
      message.warning('请选择要转让给谁');
      return;
    }
    setTransferSubmitting(true);
    try {
      const { data } = await ordersApi.requestTransfer(transferOrder.id, {
        toCompanionId: transferToId,
        reason: transferReason.trim() || undefined,
      });
      const toName = data?.data?.toName || '对方';
      message.success(`已发出转让申请，等 ${toName} 点「同意」之后才真正转过去`);
      setTransferOrder(null);
      window.dispatchEvent(new Event('chunlv:transfer-updated'));
      fetch();
    } catch (e: any) {
      message.error(extractErrorMessage(e, '转让失败'));
    } finally {
      setTransferSubmitting(false);
    }
  };

  /** 撤回还没被同意的转让申请（老板 2026-10-03）。 */
  const cancelTransfer = async (r: any) => {
    const req = outTransferMap[r.id];
    if (!req) return;
    try {
      await ordersApi.cancelTransfer(req.requestId);
      message.success('已撤回转让申请，这张单还是你的');
      window.dispatchEvent(new Event('chunlv:transfer-updated'));
    } catch (e: any) {
      message.error(extractErrorMessage(e, '撤回失败'));
    }
  };

  /**
   * 别人转给我的单，直接在订单列表那一行点「接手」/「拒绝」（老板 2026-10-03：
   * 「放在订单列表那一行点转让或者点接受不行么」）。
   * 这两张单现在还不挂在我名下，所以服务端把它们一起放进「我接的单」里，
   * 每行带一个 pendingTransferForMe；点完刷新列表，行上的按钮就消失了。
   */
  const respondIncomingTransfer = async (req: any, accept: boolean) => {
    const requestId = req?.requestId;
    if (!requestId) return;
    setTransferRespondId(requestId);
    try {
      if (accept) await ordersApi.acceptTransfer(requestId);
      else await ordersApi.rejectTransfer(requestId);
      message.success(accept ? '已接手，这张单现在归你了' : '已拒绝，这张单还在对方名下');
      window.dispatchEvent(new Event('chunlv:transfer-updated'));
      window.dispatchEvent(new Event('chunlv:order-pool-updated'));
      fetch();
    } catch (e: any) {
      message.error(extractErrorMessage(e, accept ? '接手失败' : '拒绝失败'));
    } finally {
      setTransferRespondId('');
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
      // 主陪 / 副陪都算「这个陪玩的接单记录」：管理端按人筛选时，
      // 他当搭档跟着打的单（coCompanionId）也要一起筛出来（老板 2026-10-03）。
      return o.companionId === companionFilter || o.coCompanionId === companionFilter;
    })
    .filter((o: any) => {
      if (!csFilter) return true;
      return o.csUserId === csFilter;
    });

  // 订单管理的列来自 components/orderColumns.tsx —— 和派单管理下面的三张订单列表共用同一份，
  // 保证「订单管理 / 流转失败明细 / 跟进列表 / 流转明细」四处的订单长得一模一样
  // （老板 2026-09-28：「流转失败列表页很混乱，你再查查所有角色所有页面 还有同样问题的么」）。
  const columns = [
    // 管理端把按窗口算出来的列宽传进去（客户账号这类列窗口一宽就变宽）；
    // 陪玩端不传，维持固定的窄版列宽（见 orderColumns.tsx 的 OrderColumnOptions.widths）
    ...buildOrderColumns({
      isCompanion,
      canSeeSourceFor: (o: any) => canSeeCustomerSource(o, user),
      inactiveAccounts,
      widths: isCompanion ? undefined : fittedColumns.widths,
      // 客服 / 店长能点状态格记结果、点小字把线上→线下的单放给线下；陪玩端不给这两个入口
      onOutcomeClick: isCompanion ? undefined : (o: any) => setOutcomeOrder(o),
      onReleaseToOffline: isCompanion ? undefined : (o: any) => setReleaseOrder(o),
    }),
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
          title={
            isCompanion
              ? companionScope === 'published'
                ? '我发布的订单'
                : companionScope === 'served'
                  ? '我服务的订单'
                  : '我抢到的订单'
              : '订单管理'
          }
          subtitle={
            isCompanion
              ? companionScope === 'published'
                ? '我自己发布过的订单（首单 / 续费 / 复购）'
                : companionScope === 'served'
                  ? '别人抢到、我当搭档一起打的单（这一栏看不到主陪的客户微信）'
                  : '我抢到的单（含转让留痕、待我接手的转让）'
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
        <PartnerInviteCards />
        {/* Filter bar */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <Input.Search
            placeholder={ORDER_SEARCH_PLACEHOLDER}
            allowClear
            value={orderSearch}
            onChange={(e) => setOrderSearch(e.target.value)}
            style={{ width: 300 }}
            size="small"
          />
          <Select
            placeholder={ORDER_FIELD_LABELS.orderType}
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
              onChange={(v) => setCompanionScope(v as 'taken' | 'served' | 'published')}
              options={[
                { label: '我抢到的', value: 'taken' },
                { label: '我服务的', value: 'served' },
                { label: '我发布的', value: 'published' },
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
            {/* 这个 div 就是「表格真正能用的宽度」，窗口拖动 / 侧栏收起都会重新量一遍 */}
            <div ref={tableWrapRef}>
              <Table
                className="data-table"
                rowKey="id"
                columns={columns as any}
                dataSource={sorted}
                size="small"
                pagination={false}
                style={TABLE_STYLE}
                scroll={{
                  // 管理端用算出来的 scroll.x：窗口窄时是 1216px（横向滚动照旧），
                  // 窗口宽时正好等于表格能用的宽度，列不会被按比例压扁
                  x: isCompanion ? sumWidths(ORDER_TABLE_KEYS_COMPANION) : fittedColumns.scrollX,
                }}
                locale={{
                  emptyText: isCs && csScope === 'mine'
                    ? '暂无我发布的订单，可切到「全店订单」查看'
                    : isCompanion && companionScope === 'published'
                      ? '我还没发过订单'
                      : isCompanion && companionScope === 'served'
                        ? '还没有我当搭档服务的订单'
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
            </div>
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
          title="转让订单"
          open={!!transferOrder}
          onOk={submitTransfer}
          confirmLoading={transferSubmitting}
          onCancel={() => setTransferOrder(null)}
          okText="发出转让申请"
          cancelText="取消"
          destroyOnClose
        >
          <div style={{ marginBottom: 12 }}>
            <Text type="secondary">
              发出申请后要等对方点「同意」才算转过去（老板 2026-10-03：不过对方这关不算数）；他同意后
              这张单归他接手，你的接单记录里仍然留着并标明「什么时候转让给了谁」，客户管理里也看得到。
              已经开始服务的单不能转让，请联系客服；对方 30 分钟没确认会自动作废。
            </Text>
          </div>
          <div style={{ marginBottom: 12 }}>
            <Text>
              订单：{transferOrder?.orderCode || transferOrder?.id?.slice(0, 8)} · {transferOrder?.gameName} · ¥
              {Number(transferOrder?.amount || 0).toFixed(0)}
            </Text>
          </div>
          <div style={{ marginBottom: 12 }}>
            <Text>转让给：</Text>
            <Select
              value={transferToId || undefined}
              style={{ width: '100%' }}
              onChange={(v) => setTransferToId(v)}
              placeholder="选择同工作室的陪玩"
              showSearch
              optionFilterProp="children"
            >
              {companions
                .filter((c: any) => c.id !== user?.companionId)
                .map((c: any) => (
                  <Option key={c.id} value={c.id}>
                    {c.user?.displayName || c.user?.username || c.id.slice(0, 6)}
                  </Option>
                ))}
            </Select>
          </div>
          <div>
            <Text>原因（可选，会写进转让记录）：</Text>
            <Input.TextArea
              rows={3}
              value={transferReason}
              onChange={(e) => setTransferReason(e.target.value)}
              placeholder="例如：客户一直没通过 / 客户不满意"
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
      <OrderDetailModal
        order={detailOrder}
        open={!!detailOrder}
        onClose={() => setDetailOrder(null)}
        onTransfer={(o: any) => {
          setDetailOrder(null);
          openTransfer(o);
        }}
      />
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
      {/* 线上 / 桥接单的结果反馈（成功 / 不成功）；状态格和操作列都能打开 */}
      <OrderOutcomeModal
        open={!!outcomeOrder}
        order={outcomeOrder || {}}
        onClose={() => setOutcomeOrder(null)}
        onSaved={fetch}
      />
      <Modal
        title="放给本店线下陪玩"
        open={!!releaseOrder}
        onOk={submitRelease}
        onCancel={() => setReleaseOrder(null)}
        okText="放给线下"
        cancelText="取消"
        confirmLoading={releaseSubmitting}
      >
        <div style={{ marginTop: 8 }}>
          <Text>
            这单是「线上→线下流转」的：本来要先给桥接工作室 + 线上俱乐部（秒看到），本店线下陪玩暂时看不见。现在就放给本店线下陪玩？
          </Text>
          <Text type="secondary" style={{ display: 'block', marginTop: 10, fontSize: 12 }}>
            放出去之后，本店线下陪玩马上能在订单池里抢到这单。
          </Text>
        </div>
      </Modal>
    </>
  );
};

export default OrdersPage;
