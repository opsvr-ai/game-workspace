// craftsman-ignore: TS001,TS002
import React, { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Typography,
  Button,
  Select,
  DatePicker,
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
  Upload,
} from 'antd';
import { message } from '../utils/feedback';
import { ReloadOutlined } from '@ant-design/icons';
import { extractErrorMessage } from '../utils/error-handler';
import { describeTransfer, transferWho } from '../components/OrderTransferNote';
import http from '../api/client';
import { ordersApi } from '../api/orders';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import CreateOrderModal from '../components/CreateOrderModal';
import PasteImageBox from '../components/PasteImageBox';
import OrderDetailModal from '../components/OrderDetailModal';
import OrderOutcomeModal, { orderChannelOf } from '../components/OrderOutcome';
import { buildOrderColumns } from '../components/orderColumns';
import { isRowClickIgnored } from '../utils/rowClick';
import { encodeOrderInfo, orderInfoTextOf } from '../utils/chatOrder';
import { orderMatchesSearch } from '../utils/orderPool';
import { loadInactiveAccounts } from '../utils/inactiveTrafficAccounts';
import { orderStatusConfig, dispatchTypeOptions, contactStatusConfig, contactStatusOrder } from '../constants';
import { ORDER_FIELD_LABELS, ORDER_SEARCH_PLACEHOLDER } from '../constants/orderFields';
import PageHeader from '../components/PageHeader';
import SupplementReviewButton from '../components/SupplementReviewButton';
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
import { TEXT, SEMANTIC, BORDER, BG } from '../styles/tokens';

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
  // 店长 / 老板 = 管理端：订单管理里的「退款」在他们这里是「补单」（老板 2026-10-08）
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'OWNER';
  const navigate = useNavigate();

  // 陪玩点「添加成功」后，直接进入客户管理接着打首单（老板 2026-10-11：「客户已同意」并进「添加成功」）；
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
  // 从聊天框「查看订单」跳过来（或刚点开）的那一单：整行加选中阴影 + 滚到表格中间，
  // 不用自己再找是哪一单（老板 2026-10-05）。
  const [focusOrderId, setFocusOrderId] = useState<string>('');
  // 列表**第一次真的拉回来了**没有（老板 2026-10-09）。
  // 为什么必须有它：下面那个「跳过来」的 effect 是一次性的（读完就把地址里的 orderId 抹掉）。
  // 首屏渲染那一刻 loading 还是 false、orders 还是空数组，effect 会**在列表到达之前**先跑一次，
  // 于是永远判定「这一单不在列表里」→ 退回「把详情弹窗打开」那条路 —— 老板看到的「还是弹窗」
  // 就是这么来的（哪怕这一单明明就在列表里）。等列表真回来了再判，才判得准。
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [preFill, setPreFill] = useState<any>(null);
  const [dateFilter, setDateFilter] = useState<any>(null);
  const [typeFilter, setTypeFilter] = useState<string>('');
  // 「派单方式」筛选（指定 / 入池）：老板 2026-10-07「怎么看不到订单类型比如指定单」——
  // 它和上面的「订单类型」（首单 / 续单 / 复购 / 打赏）是两回事，所以单独一个下拉。
  const [dispatchFilter, setDispatchFilter] = useState<string>('');
  // 「添加情况」筛选（老板 2026-10-11：「这些添加失败的客户能筛出来么」）——
  // 按 `Order.contactStatus` 筛，五个词跟客服那一列「添加情况」一模一样（唯一一份在 constants/orders.ts）。
  const [contactFilter, setContactFilter] = useState<string>('');
  // 「报结果」筛选（老板 2026-10-11）：待反馈 / 成功 / 不成功 —— 「客户当时不打」这类没打成的单
  // 就是「不成功」那批（原因写在备注里，搜索框也搜得到）。
  const [outcomeFilter, setOutcomeFilter] = useState<string>('');
  // 「补单申请」筛选（老板 2026-10-11）：陪玩点过「添加失败」或「申请补单」的单，按审核状态筛
  // ——数据由服务端挂在每一行的 `supplementRequests` 上（含两种申请：补单 + 退单）。
  const [supplementFilter, setSupplementFilter] = useState<string>('');
  // 客服端默认只看自己发布/认领的单，需要时可切到全店（服务端 scope 参数）
  const [csScope, setCsScope] = useState<'mine' | 'all'>('mine');
  // 陪玩端的三个口径（服务端 scope 参数），老板 2026-10-03：
  //   taken   = 我抢到的（挂在我名下的单，含转出的留痕、待我接手的转让）
  //   served  = 我服务的（别人抢到、我当搭档一起打的单；这一栏隐藏主陪的客户微信）
  //   published = 我发布的（我自己发起的第一单 / 续费 / 复购）
  const [companionScope, setCompanionScope] = useState<'taken' | 'served' | 'published'>('taken');
  // 三栏各自的单数（老板 2026-10-03：「被邀请方打的这个订单找不到」——把数量挂在页签上，
  // 被邀请来的单不会再藏在没点过的那一栏里；当前这一栏直接用列表长度，永远最新）。
  const [scopeCounts, setScopeCounts] = useState<{ taken: number; served: number; published: number }>({
    taken: 0,
    served: 0,
    published: 0,
  });
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
  // 全站只保留一个聊天窗口（AppLayout 里的全局 ChatModal）：页面这一层不再自己弹窗，
  // 只把「要打开谁」转交给全局那一个 —— 否则「订单页的聊天框」和「左侧消息面板的聊天框」
  // 会同时弹出，同一个人出现两个聊天框、也没法统一最小化（老板 2026-10-05）。
  useEffect(() => {
    if (!chatPartner) return;
    window.dispatchEvent(new CustomEvent('open-chat-modal', { detail: chatPartner }));
    setChatPartner(null);
  }, [chatPartner]);
  // 管理端「补单」（老板 2026-10-08）：店长 / 老板点一下，给这张单的陪玩抢单次数 +1
  const [supplementTarget, setSupplementTarget] = useState<any>(null);
  const [supplementReason, setSupplementReason] = useState('');
  const [supplementSubmitting, setSupplementSubmitting] = useState(false);
  // 今日补单数：读补单记录里真实的数字（以前拿列表备注猜「补单」两个字，不准）
  const [supplementToday, setSupplementToday] = useState(0);
  // 线上 / 桥接单的结果反馈（老板 2026-09-29）：客服 / 店长点状态格或操作列的「记结果」都能打开
  const [outcomeOrder, setOutcomeOrder] = useState<any>(null);
  // 陪玩点「添加失败」也要能贴证据（老板 2026-10-06）。以前这个按钮一点就直接提交、
  // 没有地方粘「客户没同意」的截图，管理端审核补单申请时看不到凭据。现在跟「报结果」一套弹窗：
  // **只填备注（必填）+ 粘贴截图（可选）** —— 老板同一天说「那些不成功的原因全部删除吧，
  // 只留备注必填，让他们自己填，因为很多奇奇怪怪的原因，如果乱写管理端给驳回就行了」，
  // 所以这里不再给固定原因选项；备注内容直接当原因存（管理端补单审核里看得到）。
  const [contactFailOrder, setContactFailOrder] = useState<any>(null);
  const [contactFailNote, setContactFailNote] = useState('');
  const [contactFailEvidence, setContactFailEvidence] = useState<string[]>([]);
  const [contactFailUploading, setContactFailUploading] = useState(false);
  const [contactFailSaving, setContactFailSaving] = useState(false);

  const openContactFail = (r: any) => {
    setContactFailOrder(r);
    setContactFailNote('');
    setContactFailEvidence([]);
  };

  /** 一次收多张（Ctrl+V 粘贴 / 拖进来 / 多选文件都走这里），最多留 3 张。 */
  const uploadContactFailFiles = async (files: File[]) => {
    const list = (files || []).filter(Boolean).slice(0, 3);
    if (!list.length) return;
    setContactFailUploading(true);
    try {
      const urls: string[] = [];
      for (const file of list) {
        const fd = new FormData();
        fd.append('file', file);
        const { data } = await http.post('/upload/screenshot', fd);
        const url = data?.data?.url || data?.url || '';
        if (url) urls.push(url);
      }
      if (!urls.length) throw new Error('no url');
      setContactFailEvidence((prev) => [...prev, ...urls].slice(0, 3));
      message.success(urls.length > 1 ? `已上传 ${urls.length} 张截图` : '截图已上传');
    } catch {
      message.error('截图上传失败，再传一次');
    } finally {
      setContactFailUploading(false);
    }
  };

  const submitContactFail = async () => {
    if (!contactFailOrder) return;
    const note = contactFailNote.trim();
    if (!note) {
      message.warning('把为什么添加失败写清楚（原因没有选项了，自己填；乱写会被管理端驳回）');
      return;
    }
    setContactFailSaving(true);
    try {
      await http.put(`/orders/${contactFailOrder.id}/contact`, {
        contactStatus: 'not_accepted',
        notes: note,
        failReason: note,
        screenshotUrl: contactFailEvidence[0] || undefined,
      });
      message.success('已标记添加失败');
      setContactFailOrder(null);
      fetch();
    } catch (e: any) {
      message.error(extractErrorMessage(e, '操作失败'));
    } finally {
      setContactFailSaving(false);
    }
  };
  // 陪玩「申请补单」（老板 2026-10-08 先叫「退单」，2026-10-11 改名）。
  // 场景：客户同意了但没打成（客户没转钱 / 转钱了最后不打）→ 陪玩提交补单申请
  // （写清原因 + 粘贴截图）→ 客服先核对、无异议转店长，店长拍板；
  // 批下来这张单按退款处理（不计利润与提成）+ 抢单次数 +1。跟「添加失败」同一个审核入口。
  // 名字的由来（老板 2026-10-11）：「陪玩端 客户订单管理后边的那个退单 改成申请补单」——
  // 陪玩这边干的事就是「把这一单的名额补回来」，退不退是店长那边的说法。
  const [refundReqOrder, setRefundReqOrder] = useState<any>(null);
  const [refundReqNote, setRefundReqNote] = useState('');
  const [refundReqEvidence, setRefundReqEvidence] = useState<string[]>([]);
  const [refundReqUploading, setRefundReqUploading] = useState(false);
  const [refundReqSaving, setRefundReqSaving] = useState(false);
  // 这一次打开页面里已经提交过退单的单（本页把按钮换成「待审」，免得他以为没提交上、反复点）
  const [refundSubmitted, setRefundSubmitted] = useState<Record<string, boolean>>({});

  const openRefundRequest = (r: any) => {
    setRefundReqOrder(r);
    setRefundReqNote('');
    setRefundReqEvidence([]);
  };

  /** 补单申请截图：一次收多张（Ctrl+V / 拖进来 / 多选），最多留 3 张 —— 跟「添加失败」同一套。 */
  const uploadRefundReqFiles = async (files: File[]) => {
    const list = (files || []).filter(Boolean).slice(0, 3);
    if (!list.length) return;
    setRefundReqUploading(true);
    try {
      const urls: string[] = [];
      for (const file of list) {
        const fd = new FormData();
        fd.append('file', file);
        const { data } = await http.post('/upload/screenshot', fd);
        const url = data?.data?.url || data?.url || '';
        if (url) urls.push(url);
      }
      if (!urls.length) throw new Error('no url');
      setRefundReqEvidence((prev) => [...prev, ...urls].slice(0, 3));
      message.success(urls.length > 1 ? `已上传 ${urls.length} 张截图` : '截图已上传');
    } catch {
      message.error('截图上传失败，再传一次');
    } finally {
      setRefundReqUploading(false);
    }
  };

  const submitRefundRequest = async () => {
    if (!refundReqOrder) return;
    const note = refundReqNote.trim();
    if (!note) {
      message.warning('写清楚为什么没打成（客户没转钱 / 转钱了最后不打…），客服和店长要凭这个判断');
      return;
    }
    setRefundReqSaving(true);
    try {
      await ordersApi.requestRefund(refundReqOrder.id, note, refundReqEvidence[0]);
      message.success('补单申请已提交：客服先核对，无异议就到店长拍板；批下来这单会退掉、你的抢单次数 +1');
      setRefundSubmitted((prev) => ({ ...prev, [refundReqOrder.id]: true }));
      setRefundReqOrder(null);
      fetch();
    } catch (e: any) {
      message.error(extractErrorMessage(e, '补单申请提交失败'));
    } finally {
      setRefundReqSaving(false);
    }
  };

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
   * 能不能给这张单报结果（老板 2026-09-29 定、2026-10-06 改成「接单方自己报」）：
   *  - 桥接 / 线上单：接单方必须给个说法（成功 / 不成功，不成功要带截图）；
   *  - 本店线下单：点了「开始首单」就算成功、不用报；**抢了单一直没开始首单的**，
   *    接单方可以报「不成功」（添加失败 / 暂时不打 / 价格谈不拢 …），一样要带截图；
   *  - 客服 / 店长 / 老板可以替接单方补录；还没人接的单没结果可记。
   */
  const canRecordOutcome = (r: any) => {
    if (!r.companionId || r.status === 'CANCELLED' || r.refundedAt) return false;
    if (isCompanion) {
      if (!user?.companionId || r.companionId !== user.companionId) return false;
      // 已经报过的还能点开看 / 改（失败单重报会退回「待店长拍板」）
      if (r.outcome === 'SUCCESS' || r.outcome === 'FAILED') return true;
      if (orderChannelOf(r) === 'offline') {
        const started = r.status === 'DONE' || (r.sessions || []).some((s: any) => !!s.startedAt);
        return !started;
      }
      return true;
    }
    return orderChannelOf(r) !== 'offline';
  };

  /**
   * 陪玩能不能给这张单点「申请补单」（老板 2026-10-08 叫「退单」，2026-10-11 改名）。
   *  - 只有当前持有人（副陪 / 已经转出去的单不给点）；
   *  - 已经退过 / 已取消 / 已完成的不给点；
   *  - 已经点过「开始首单」的不给点 —— 那种单没打成要走「报结果」（成交核对那套流程）。
   */
  const canRequestRefund = (r: any) => {
    if (!isCompanion || !user?.companionId || r.companionId !== user.companionId) return false;
    if (r.status === 'CANCELLED' || r.status === 'DONE' || r.refundedAt) return false;
    if ((r.sessions || []).some((s: any) => !!s.startedAt)) return false;
    return true;
  };

  /**
   * 管理端能不能给这张单「补单」（老板 2026-10-08）：客服 / 店长 / 老板，单没取消、有人接单。
   *
   * 这一格原来只有店长 / 老板是「补单」、客服是「退款」；老板要求把「直接退款」整条删掉，
   * 全换成一个动作 ——「补单」：给陪玩名额 +1、留记录、通知他本人。
   * 陪玩已经提交过补单申请的单，按钮上会挂红点提醒（见下面渲染那一段）。
   */
  const canSupplement = (r: any) => (isAdmin || isCs) && r.status !== 'CANCELLED' && !!r.companionId;

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
      // 「今日抢单 · 补单 N · 合计」里那个补单数：读管理端补单记录里真实的数字（老板 2026-10-08）
      if (!isCompanion) {
        void ordersApi
          .supplementSummary()
          .then((res) => setSupplementToday(res?.data?.data?.approvedToday ?? 0))
          .catch(() => null);
      }
    } catch {
      message.error('加载失败');
    } finally {
      setLoading(false);
      setOrdersLoaded(true);
    }
  }, [statusFilter, isCs, csScope, isCompanion, companionScope]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  // 别处提交了补单申请（陪玩点「添加失败」）或批了补单，服务端推 socket、AppLayout 转成这个自定义事件：
  // 立刻重拉一遍 —— 「补单」那颗按钮上的红点（待补单）和「已补」状态不能等到下次手动刷新才变
  // （老板 2026-10-08：「以后陪玩申请补单在对应订单后边的补单按钮做提示」）。
  useEffect(() => {
    if (isCompanion) return;
    const onSupplementRefresh = () => void fetch();
    window.addEventListener('supplement:refresh', onSupplementRefresh as EventListener);
    return () =>
      window.removeEventListener('supplement:refresh', onSupplementRefresh as EventListener);
  }, [fetch, isCompanion]);

  // 陪玩端：把三栏的单数拉一遍挂在页签角标上（只拉陪玩自己的，量很小）。
  useEffect(() => {
    if (!isCompanion) return;
    let alive = true;
    const countOf = (r: any) => {
      const d = r?.data?.data ?? r?.data;
      return Array.isArray(d) ? d.length : 0;
    };
    Promise.all(
      (['taken', 'served', 'published'] as const).map((s) =>
        ordersApi.list({ scope: s }).catch(() => null),
      ),
    ).then(([taken, served, published]) => {
      if (!alive) return;
      setScopeCounts({ taken: countOf(taken), served: countOf(served), published: countOf(published) });
    });
    return () => {
      alive = false;
    };
  }, [isCompanion]);

  // 从聊天框点「查看订单」跳过来：<角色>/orders?orderId=<id> —— **只跳到订单管理 + 把那一行标阴影**。
  //
  // 老板 2026-10-09：「邵泽慧点看聊天框顶部的查看订单详情 还是弹窗？不是让你直接跳转到订单管理
  // 并且标阴影么」—— 上一轮（网页 v992）已经去掉了「另开一个订单管理窗口」，但跳过来之后还会
  // **自动把「订单详情」弹窗打开**，老板看到的就是那个「弹窗」。
  // 现在：命中列表里那一单 → 只高亮（高亮 + 滚到表格中间见下面那个 effect），要看详情自己点那一行。
  //
  // 两处例外，照旧自动打开详情：
  //   ① 带 `detail=1` 的入口 —— 补单审核里点订单（老板 2026-10-08「给我直接跳转到订单管理的该订单，
  //      方便客服查看」），那边点进去就是要看详情；
  //   ② 这一单**不在当前筛选范围里**（列表里根本没它，标不出阴影）—— 总比跳过来一片空白强。
  //
  // 先把参数从地址里抹掉，免得关掉弹窗 / 刷新页面时又自己弹回来；不在列表里的那一单单独取回来。
  useEffect(() => {
    const focusId = searchParams.get('orderId');
    if (!focusId) return;
    // 列表还没拉回来 → 这一轮什么都不做（**地址里的参数也先留着**），等它回来了再判。
    if (!ordersLoaded) return;
    const wantDetail = searchParams.get('detail') === '1';
    const next = new URLSearchParams(searchParams);
    next.delete('orderId');
    next.delete('detail');
    setSearchParams(next, { replace: true });
    setFocusOrderId(focusId);
    const hit = orders.find((o: any) => o.id === focusId);
    if (hit) {
      if (wantDetail) setDetailOrder(hit);
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
  }, [searchParams, setSearchParams, orders, ordersLoaded]);

  // 被高亮的那一单滚到表格中间（跳过来一眼就能看到）。
  const focusScrolledRef = useRef<string>('');
  useEffect(() => {
    if (!focusOrderId) return;
    const el = document.querySelector(`.data-table tr[data-row-key="${focusOrderId}"]`);
    if (!el || focusScrolledRef.current === focusOrderId) return;
    focusScrolledRef.current = focusOrderId;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focusOrderId, orders]);

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
            <Tooltip
              title={
                r.customFields?.customerRoomCode
                  ? '房间码单：点一下 = 记「添加成功」+ 把你切成「接单中」（空闲时三角洲会被看门狗杀掉，切了才进得去游戏）'
                  : contactDisabled
                    ? '请先在"工作微信"列选择微信'
                    : undefined
              }
            >
              <Button
                type="primary"
                size="small"
                disabled={contactDisabled && !r.customFields?.customerRoomCode}
                style={{
                  background: contactDisabled ? undefined : SEMANTIC.success,
                  borderColor: contactDisabled ? undefined : SEMANTIC.success,
                }}
                onClick={async () => {
                  try {
                    if (r.customFields?.customerRoomCode) {
                      // 房间码单（老板 2026-10-11）：点一下 = 记「添加成功」+ 切成「接单中」，
                      // 空闲时三角洲会被看门狗杀掉，切了才进得去游戏对接客户。
                      await http.post(`/orders/${r.id}/room-join`);
                      message.success('已进游戏对接：状态切到「接单中」，游戏不会被关，正在进入客户管理');
                    } else {
                      await http.put(`/orders/${r.id}/contact`, { contactStatus: 'added' });
                      message.success('已添加成功，正在进入客户管理');
                    }
                    window.location.href = '/companion/customers';
                  } catch (e: any) {
                    message.error(extractErrorMessage(e, '操作失败'));
                  }
                }}
              >
                {r.customFields?.customerRoomCode ? '🏠 进游戏对接' : '✅ 添加成功'}
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
              style={{ background: SEMANTIC.success, borderColor: SEMANTIC.success }}
              onClick={async () => {
                try {
                  await http.put(`/orders/${r.id}/contact`, { contactStatus: 'added' });
                  message.success('已标记添加成功');
                  fetch();
                } catch (e: any) {
                  message.error(extractErrorMessage(e, '操作失败'));
                }
              }}
            >
              添加成功
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
        <Button size="small" type="primary" style={{ background: SEMANTIC.direct, borderColor: SEMANTIC.direct }} onClick={() => releaseClaim(r)}>
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
  // 现在：第一行永远是「修改 / 补单」，第二行永远是「沟通 / 添加成功 / 添加失败」，
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

    // 操作列：一行按顺序排 —— 沟通 → 添加成功 → 添加失败 → 修改 → 补单
    // （老板 2026-09-28：「修改 退款 显示在 添加失败后边」；2026-10-08 老板要求把「退款」整条删掉、那一格改成「补单」）。
    // 每个动作占一个固定宽度的格子，
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
              color: SEMANTIC.orangeDeeper,
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
              color: SEMANTIC.orangeDeeper,
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
          {isCompanion && r.customFields?.customerRoomCode && (r.status === 'GRABBED' || r.status === 'CONFIRMED') ? (
            <Tooltip title="房间码单：点一下 = 记「添加成功」+ 把你切成「接单中」。空闲时看门狗会把三角洲杀掉，切成接单中才进得去游戏对接客户；对接完回来点「开始首单」正常计时">
              <Button
                size="small"
                type="primary"
                style={{ width: 60, background: SEMANTIC.success, borderColor: SEMANTIC.success }}
                onClick={async () => {
                  try {
                    await http.post(`/orders/${r.id}/room-join`);
                    message.success('已切成「接单中」，游戏不会被关，可以进游戏对接了');
                    fetch();
                  } catch (e: any) {
                    message.error(extractErrorMessage(e, '操作失败'));
                  }
                }}
              >
                进游戏
              </Button>
            </Tooltip>
          ) : contactState === 'added' ? (
            <Tag color="green" style={{ margin: 0 }}>
              添加成功
            </Tag>
          ) : contactState === 'not_accepted' ? (
            <Button
              size="small"
              type="primary"
              style={{ width: 60, background: SEMANTIC.success, borderColor: SEMANTIC.success }}
              onClick={async () => {
                try {
                  await http.put(`/orders/${r.id}/contact`, { contactStatus: 'added' });
                  message.success('已标记添加成功');
                  fetch();
                  gotoCustomersAfterAdd();
                } catch (e: any) {
                  message.error(extractErrorMessage(e, '操作失败'));
                }
              }}
            >
              添加成功
            </Button>
          ) : contactState === 'pending' ? (
            <Button
              size="small"
              type="primary"
              style={{ width: 60, background: SEMANTIC.success, borderColor: SEMANTIC.success }}
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
            <Tooltip title="客户一直没加你 / 没同意就点这里：自己写清楚为什么（备注必填，乱写会被管理端驳回）+ 可粘贴「客户没同意」的截图，管理端审核补单申请时能看到">
              <Button
                size="small"
                danger
                style={{ width: 58 }}
                onClick={() => openContactFail(r)}
              >
                添加失败
              </Button>
            </Tooltip>
          ) : canRecordOutcome(r) ? (
            // 这一格平时被「添加失败」占着；客户微信已经加过（或这单不用标）时就空出来了，
            // 空出来正好放「记结果 / 报结果」—— 位置固定（永远第 3 格 60px），
            // 操作列宽度不变、行高不变。陪玩端（接单方）报过了就把结果显示在这一格。
            isCompanion && r.outcome ? (
              <Tooltip
                title={
                  r.outcome === 'SUCCESS'
                    ? '已报「成功」：推给发单者、计入考核'
                    : r.reviewStatus === 'DECIDED'
                      ? `已报「不成功」，店长已拍板：${r.reviewNote || '（没写结论）'}`
                      : r.reviewStatus === 'REJECTED'
                        ? `店长把说明打回了：${(r.customFields as any)?.outcomeReject?.note || '写得不清楚'} —— 点开重新填原因 + 重贴截图再报一次`
                        : '已报「不成功」：已附截图推给发单者 + 店长，等店长拍板定责'
                }
              >
                <Tag
                  color={r.outcome === 'SUCCESS' ? 'green' : r.reviewStatus === 'REJECTED' ? 'orange' : 'red'}
                  style={{ margin: 0, cursor: 'pointer' }}
                  onClick={() => setOutcomeOrder(r)}
                >
                  {r.outcome === 'SUCCESS' ? '成功' : r.reviewStatus === 'REJECTED' ? '待重报' : '不成功'}
                </Tag>
              </Tooltip>
            ) : (
              // 老板 2026-10-06 问「这单失败了，陪玩应该在哪里选首单失败」——按钮就是这里，
              // 但「报结果」三个字看不出是干这个的，鼠标停上去说清楚什么时候该点它。
              <Tooltip title="这单没打成（客户退出组队 / 加上了客户但没开成 / 价格或单双陪没谈拢…）就点这里：选原因 + 粘贴截图，单子会推给发单客服 + 店长定责">
                <Button size="small" style={{ width: 58 }} onClick={() => setOutcomeOrder(r)}>
                  {isCompanion ? '报结果' : '记结果'}
                </Button>
              </Tooltip>
            )
          ) : null}
        </span>
        <span style={actionSlot(36)}>
          {incomingTransfer ? (
            // 「接手」占的正是平时放「转让」的那一格：待我确认的单本来就没别的动作，
            // 位置固定、操作列不变宽。
            <Button
              size="small"
              type="primary"
              style={{ width: 36, background: SEMANTIC.success, borderColor: SEMANTIC.success }}
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
        {/* 最后一格：管理端是「补单 / 拒绝」（36px 就够），陪玩是「申请补单」（4 个字，要 58px）。 */}
        <span style={actionSlot(isCompanion ? 58 : 36)}>
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
          ) : canSupplement(r) ? (
            // 管理端（客服 / 店长 / 老板）那一格（老板 2026-10-08）：原来的「退款」整条删掉，一律「补单」——
            // 陪玩已经提交补单申请的，按钮上挂个红点；点一下就是核对 + 同意（名额 / 台账 / 记录 / 通知一起走完）；
            // 已经补过的显示「已补」，不给再点（免得同一张单补两次名额）。
            r.supplementApproved ? (
              <Tooltip title="这张单已经补过名额了；谁批的、什么时候批的，到「🧾 补单审核 → 补单记录」里查">
                <Tag color="success" style={{ margin: 0, padding: '0 3px', fontSize: 11 }}>
                  已补
                </Tag>
              </Tooltip>
            ) : (
              <Badge dot={!!r.supplementPending}>
                <Tooltip
                  title={
                    r.supplementPending
                      ? '陪玩已提交补单申请：点这里核对并同意（同意 = 他的抢单次数 +1，并实时通知他）'
                      : '给这张单的陪玩补 1 个抢单次数，并留一条补单记录'
                  }
                >
                  <Button
                    size="small"
                    type={r.supplementPending ? 'primary' : 'default'}
                    style={{ width: 36 }}
                    onClick={() => {
                      setSupplementTarget(r);
                      setSupplementReason('');
                    }}
                  >
                    补单
                  </Button>
                </Tooltip>
              </Badge>
            )
          ) : canRequestRefund(r) ? (
            // 陪玩这一格本来空着（第 5 格原来是「退款」，只有客服 / 店长有）。
            // 老板 2026-10-08：「陪玩端要退款也没用……你在陪玩端＋个按钮『退单』」——
            // 老板 2026-10-11：「陪玩端 客户订单管理后边的那个退单 改成申请补单」——
            // 所以这里给陪玩的是「申请补单」：他只能**申请**，钱的事由客服核对、店长拍板。
            refundSubmitted[r.id] ? (
              <Tooltip title="补单申请已提交：客服先核对，无异议就到店长拍板；批下来这张单会退掉、你的抢单次数 +1">
                <Tag color="orange" style={{ margin: 0, padding: '0 3px', fontSize: 11 }}>
                  待审
                </Tag>
              </Tooltip>
            ) : (
              <Tooltip title="客户同意了但没打成（客户没转钱 / 转钱了最后不打…）就点这里申请补单：写清原因 + 粘贴截图，客服先核对、店长拍板。批下来这张单会退掉（不计利润与提成），你的抢单次数 +1">
                <Button size="small" danger style={{ width: 58 }} onClick={() => openRefundRequest(r)}>
                  申请补单
                </Button>
              </Tooltip>
            )
          ) : null}
        </span>
      </div>
    );
  };

  const submitSupplementOrder = async () => {
    if (!supplementTarget) return;
    // 这张单上本来就有陪玩的补单申请 → 这一次就是「核对 + 同意」，原因用他写的那段，不用再填一遍。
    const approving = !!supplementTarget.supplementPending;
    const reason = supplementReason.trim();
    if (!approving && !reason) {
      message.warning('请填写补单原因');
      return;
    }
    setSupplementSubmitting(true);
    try {
      await ordersApi.supplementOrder(supplementTarget.id, reason || undefined);
      message.success(
        `${approving ? '已同意补单' : '已补单'}：订单 ${supplementTarget.orderCode || ''} 的陪玩抢单次数 +1，已记入补单记录`,
      );
      setSupplementTarget(null);
      setSupplementReason('');
      fetch();
    } catch (e: any) {
      message.error(extractErrorMessage(e, '补单失败'));
    } finally {
      setSupplementSubmitting(false);
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

  /** 当前这一栏以列表长度为准（切栏后立刻准），其余栏用单独拉到的数量。 */
  const scopeTabLabel = (text: string, scope: 'taken' | 'served' | 'published') => {
    const n = companionScope === scope ? orders.length : scopeCounts[scope];
    return (
      <span>
        {text}
        {n > 0 && <Badge count={n} size="small" offset={[6, -2]} />}
      </span>
    );
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
      if (!dispatchFilter) return true;
      return o.dispatchType === dispatchFilter;
    })
    .filter((o: any) => {
      if (!outcomeFilter) return true;
      if (outcomeFilter === 'NONE') return !o.outcome;
      return o.outcome === outcomeFilter;
    })
    .filter((o: any) => {
      if (!supplementFilter) return true;
      const reqs: any[] = Array.isArray(o.supplementRequests) ? o.supplementRequests : [];
      if (supplementFilter === 'ANY') return reqs.length > 0;
      return reqs.some((r: any) => r?.status === supplementFilter);
    })
    .filter((o: any) => {
      if (!contactFilter) return true;
      if (contactFilter === 'NONE') return !o.contactStatus;
      return o.contactStatus === contactFilter;
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
              {!isCompanion && <SupplementReviewButton />}
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
            placeholder={ORDER_FIELD_LABELS.dispatchType}
            allowClear
            value={dispatchFilter || undefined}
            onChange={(v) => setDispatchFilter(v || '')}
            style={{ width: 100 }}
            size="small"
            options={dispatchTypeOptions}
          />
          <Select
            placeholder="添加情况"
            allowClear
            value={contactFilter || undefined}
            onChange={(v) => setContactFilter(v || '')}
            style={{ width: 110 }}
            size="small"
          >
            {contactStatusOrder.map((k) => (
              <Option key={k} value={k}>
                {contactStatusConfig[k].label}
              </Option>
            ))}
            <Option value="NONE">还没记</Option>
          </Select>
          <Select
            placeholder="报结果"
            allowClear
            value={outcomeFilter || undefined}
            onChange={(v) => setOutcomeFilter(v || '')}
            style={{ width: 100 }}
            size="small"
          >
            <Option value="NONE">待反馈</Option>
            <Option value="SUCCESS">成功</Option>
            <Option value="FAILED">不成功</Option>
          </Select>
          <Select
            placeholder="补单申请"
            allowClear
            value={supplementFilter || undefined}
            onChange={(v) => setSupplementFilter(v || '')}
            style={{ width: 110 }}
            size="small"
          >
            <Option value="ANY">有申请</Option>
            <Option value="PENDING">待审核</Option>
            <Option value="APPROVED">已同意</Option>
            <Option value="REJECTED">已驳回</Option>
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
                { label: scopeTabLabel('我抢到的', 'taken'), value: 'taken' },
                { label: scopeTabLabel('我服务的', 'served'), value: 'served' },
                { label: scopeTabLabel('我发布的', 'published'), value: 'published' },
              ]}
            />
          )}
          {(orderSearch || typeFilter || dispatchFilter || contactFilter || outcomeFilter || supplementFilter || companionFilter || csFilter || dateFilter) && (
            <Text type="secondary" style={{ fontSize: 12, lineHeight: '24px' }}>
              筛选结果: {sorted.length}/{orders.length}
            </Text>
          )}
        </div>
        {/* 今日单量：一行灰字（原来三个彩色标签块，视觉噪音太大，老板 2026-09-28） */}
        <div style={{ fontSize: 12, color: TEXT.secondary, marginBottom: 8 }}>
          今日抢单{' '}
          {
            orders.filter((o: any) => {
              const d = new Date(o.grabbedAt || o.createdAt).toDateString();
              return d === new Date().toDateString() && o.status !== 'CANCELLED';
            }).length
          }
          {' · 补单 '}
          {supplementToday}
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
                rowClassName={(record: any) => (record.id === focusOrderId ? 'row-jump-focus' : '')}
                onRow={(record: any) => ({
                  style: { cursor: 'pointer' },
                  onClick: (e: React.MouseEvent) => {
                    if (isRowClickIgnored(e)) return;
                    setFocusOrderId(String(record.id));
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
        title={supplementTarget?.supplementPending ? '补单：陪玩已申请，核对后同意' : '补单'}
        open={!!supplementTarget}
        onOk={submitSupplementOrder}
        onCancel={() => setSupplementTarget(null)}
        okText={supplementTarget?.supplementPending ? '同意补单' : '确认补单'}
        cancelText="取消"
        confirmLoading={supplementSubmitting}
      >
        <div style={{ marginTop: 8 }}>
          <Text>
            给订单 <Text strong>{supplementTarget?.orderCode || supplementTarget?.gameName}</Text>{' '}
            的陪玩补 1 个抢单名额？补完会记在「🧾 补单审核 → 补单记录」里，方便回头查。
          </Text>
          {supplementTarget?.supplementPending ? (
            <div
              style={{
                marginTop: 12,
                padding: 10,
                background: BG.containerSoft,
                border: `1px solid ${BORDER.hairline}`,
                borderRadius: 6,
              }}
            >
              <Text strong>陪玩提交的补单申请</Text>
              <div style={{ marginTop: 6 }}>
                <Text style={{ fontSize: 12 }}>
                  原因：{supplementTarget?.supplementPendingRequest?.reason || '（他没写）'}
                </Text>
              </div>
              {supplementTarget?.supplementPendingRequest?.evidenceUrl ? (
                <div style={{ marginTop: 6 }}>
                  <Text style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>截图：</Text>
                  <Image src={supplementTarget.supplementPendingRequest.evidenceUrl} width={160} />
                </div>
              ) : null}
            </div>
          ) : null}
          <Text strong style={{ display: 'block', marginTop: 12 }}>
            {supplementTarget?.supplementPending ? '补充说明（选填）' : '补单原因（必填）'}
          </Text>
          <Input.TextArea
            rows={3}
            value={supplementReason}
            onChange={(e) => setSupplementReason(e.target.value)}
            placeholder={
              supplementTarget?.supplementPending
                ? '不填也行；填了会记进「补单记录」的处理备注'
                : '例如：客户临时改时间 / 不是陪玩的责任'
            }
            style={{ marginTop: 8 }}
          />
        </div>
      </Modal>
      {/* 陪玩点「申请补单」的弹窗（老板 2026-10-08 叫「退单」，2026-10-11 改名）：
          「客户同意了但是没打成」—— 写清原因 + 粘贴截图，客服先核对、无异议转店长，店长拍板 */}
      <Modal
        title="申请补单"
        open={!!refundReqOrder}
        onOk={submitRefundRequest}
        onCancel={() => setRefundReqOrder(null)}
        okText="提交补单申请"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        confirmLoading={refundReqSaving}
        destroyOnClose
      >
        <Text type="secondary" style={{ fontSize: 12 }}>
          订单 <Text strong>{refundReqOrder?.orderCode || refundReqOrder?.gameName}</Text> 没打成
          （客户没转钱 / 转钱了最后不打…）就提交补单申请：**客服先核对，无异议到店长拍板**，
          跟「添加失败」一样在「🧾 补单审核」里处理。批下来这张单会退掉（不计利润与提成），
          你的抢单次数 +1。
        </Text>
        <div style={{ marginTop: 14 }}>
          <Text strong>截图（可选，建议贴一张）</Text>
          <PasteImageBox
            onFiles={uploadRefundReqFiles}
            disabled={refundReqUploading}
            style={{ marginTop: 8 }}
            hint="点一下这里，直接 Ctrl+V 粘贴截图（可一次粘多张，也能把图片拖进来）"
          >
            {refundReqEvidence.map((url) => (
              <div
                key={url}
                style={{ display: 'inline-flex', alignItems: 'center', marginRight: 8, marginBottom: 8 }}
              >
                <img
                  src={url}
                  alt="补单申请凭据"
                  style={{ width: 54, height: 54, objectFit: 'cover', borderRadius: 6, border: `1px solid ${BORDER.base}`, cursor: 'pointer' }}
                  onClick={() => window.open(url, '_blank')}
                />
                <Button
                  size="small"
                  type="link"
                  danger
                  onClick={() => setRefundReqEvidence((prev) => prev.filter((u) => u !== url))}
                >
                  删
                </Button>
              </div>
            ))}
            <Upload
              beforeUpload={(f) => {
                void uploadRefundReqFiles([f]);
                return false;
              }}
              showUploadList={false}
              accept="image/*"
              multiple
              disabled={refundReqUploading}
            >
              <Button size="small" loading={refundReqUploading}>
                上传截图
              </Button>
            </Upload>
          </PasteImageBox>
        </div>
        <div style={{ marginTop: 14 }}>
          <Text strong>原因（必填）</Text>
          <Input.TextArea
            rows={3}
            value={refundReqNote}
            onChange={(e) => setRefundReqNote(e.target.value)}
            placeholder="自己写清楚为什么没打成（客服和店长会看，乱写会被驳回）"
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
      {/* 陪玩点「添加失败」时的弹窗：选原因 + 粘贴截图（可选）+ 备注（老板 2026-10-06） */}
      <Modal
        title="标记「添加失败」"
        open={!!contactFailOrder}
        onOk={submitContactFail}
        onCancel={() => setContactFailOrder(null)}
        okText="确认添加失败"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        confirmLoading={contactFailSaving}
        destroyOnClose
      >
        <Text type="secondary" style={{ fontSize: 12 }}>
          为什么加不上，自己写清楚就行（没有固定原因选项了）；能贴上「客户没同意 / 没通过验证」的截图更好 ——
          管理端审核补单申请、翻这张单时都看得到。
        </Text>
        <div style={{ marginTop: 14 }}>
          <Text strong>截图（可选，建议贴一张）</Text>
          <PasteImageBox
            onFiles={uploadContactFailFiles}
            disabled={contactFailUploading}
            style={{ marginTop: 8 }}
            hint="点一下这里，直接 Ctrl+V 粘贴截图（可一次粘多张，也能把图片拖进来）"
          >
            {contactFailEvidence.map((url) => (
              <div
                key={url}
                style={{ display: 'inline-flex', alignItems: 'center', marginRight: 8, marginBottom: 8 }}
              >
                <img
                  src={url}
                  alt="添加失败凭据"
                  style={{ width: 54, height: 54, objectFit: 'cover', borderRadius: 6, border: `1px solid ${BORDER.base}`, cursor: 'pointer' }}
                  onClick={() => window.open(url, '_blank')}
                />
                <Button
                  size="small"
                  type="link"
                  danger
                  onClick={() => setContactFailEvidence((prev) => prev.filter((u) => u !== url))}
                >
                  删
                </Button>
              </div>
            ))}
            <Upload
              beforeUpload={(f) => {
                void uploadContactFailFiles([f]);
                return false;
              }}
              showUploadList={false}
              accept="image/*"
              multiple
              disabled={contactFailUploading}
            >
              <Button size="small" loading={contactFailUploading}>
                上传截图
              </Button>
            </Upload>
          </PasteImageBox>
        </div>
        <div style={{ marginTop: 14 }}>
          <Text strong>备注（必填）</Text>
          <Input.TextArea
            rows={3}
            value={contactFailNote}
            onChange={(e) => setContactFailNote(e.target.value)}
            placeholder="自己写清楚为什么添加失败（管理端会看，乱写会被驳回）"
            style={{ marginTop: 8 }}
          />
        </div>
      </Modal>
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
