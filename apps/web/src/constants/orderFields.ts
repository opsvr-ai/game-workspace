/**
 * 订单 / 客户数据**唯一一份字段口径**（老板 2026-09-30 定）。
 *
 * 老板：「我说过：从发布订单→进入抢单池/指定→订单管理→客户管理 用的都是同一条数据，
 * 你把所有的显示的标签都用一样的不行么？只是有些数据不展示给陪玩端而已，
 * 你现在搞得标签乱七八糟，每个页面都显示的不一样，数据太乱，你整理」。
 *
 * 以前每个页面各写一套名字，同一份数据在哪儿看都叫得不一样：
 *  - 订单管理表的表头：「来源 / 引流账号 / 客户昵称 / 客户账号ID / 客户联系方式」；
 *  - 订单详情弹窗：「客户来源 / 来源账号 / 客户微信」（同一份数据换了个叫法）；
 *  - 抢单池 / 派单工作台那一行：干脆一个字段名都没有，只有一串用 `|` 隔开的值；
 *  - 客户详情页：客户状态又叫成「待跟进」（订单表里叫「跟进」），订单类型叫「续单」（表里叫「续费」），
 *    订单状态叫「待接单 / 已确认」（表里叫「待派单 / 进行中」）。
 *
 * 现在收成一份：**字段名（label）+ 取值（text）+ 陪玩端是否展示（companionHidden）**。
 * 表格表头、订单详情、订单池 / 派单工作台那一行、客户管理、客户详情全部从这里取，
 * 页面里不再写死中文标签 —— 以后改名只要改这一个文件。
 * 陪玩端只是**少几个字段**（老板 2026-09-29「陪玩端 隐藏 客户小红书信息」），不是换一套写法。
 */
import { billingModeConfig, orderTypeConfig, orderStatusConfig, serviceTypeConfig } from './orders';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 字段名（唯一一份）：表头、详情弹窗左边的名字、订单池那一行的小标签，全用这里的字。 */
export const ORDER_FIELD_LABELS = {
  // 订单管理表的列（也是抢单池 / 派单工作台那一行的字段）
  orderCode: '订单',
  status: '状态',
  game: '游戏 / 服务',
  amount: '金额 / 打单',
  customerSource: '来源',
  customerSourceAccount: '引流账号',
  customerNickname: '客户昵称',
  customerAccountId: '客户账号ID',
  customerContact: '客户联系方式',
  orderNote: '备注',
  companion: '主陪 / 副陪',
  /** 这一列 / 这一行只放一个人的时候（客户管理、客户详情） */
  mainCompanion: '主陪',
  coCompanion: '副陪',
  createdAt: '发布',
  // 详情弹窗里那些单独成行的字段（名字跟发布订单表单 CreateOrderModal 里的 label 一模一样）
  orderType: '订单类型',
  serviceType: '服务类型',
  deltaMission: '任务类型',
  deltaCount: '单/双陪',
  duration: '时长',
  billingMode: '计费方式',
  urgency: '打单时间',
  scheduledTime: '预约时间',
  customerWechatQr: '客户微信二维码',
  workWechat: '工作微信',
  csUser: '发布人',
  companionStudio: '接单工作室',
  grabbedAt: '接单时间',
  transfers: '转让记录',
  // 客户侧的字段名（客户管理 / 客户详情和订单表共用同一批名字）
  customerCode: '客户编号',
  wechatId: '微信号',
  // 「客户联系方式」这一行里各个渠道的名字（订单详情 / 抢单成功浮窗逐条显示时用）
  yy: 'YY',
  kook: 'KOOK',
  roomCode: '房间码',
  // 抢单池那一行特有的两个倒计时（别的页面没有，但名字也收在这里）
  waited: '已等待',
  disappearIn: '距离消失',
  takenAt: '抢单时间',
  /** 客服「指定」单在抢单池灰色行里显示的时间（跟「抢单时间」分开） */
  directAt: '指定时间',
} as const;

export type OrderFieldKey = keyof typeof ORDER_FIELD_LABELS;

export const orderFieldLabel = (key: string): string =>
  (ORDER_FIELD_LABELS as Record<string, string>)[key] ?? key;

/** 所有订单 / 客户列表搜索框的提示语（老板 2026-09-30：同一个数据用同一套名字搜）。 */
export const ORDER_SEARCH_PLACEHOLDER =
  '搜 来源 / 引流账号 / 客户昵称 / 客户账号ID / 微信号 / 游戏名（空格分隔多个词）';

/** 陪玩端不展示的字段（老板 2026-09-29「陪玩端 隐藏 客户小红书信息」）。 */
export const COMPANION_HIDDEN_FIELDS: ReadonlySet<string> = new Set([
  'customerSource',
  'customerSourceAccount',
  'customerNickname',
  'customerAccountId',
]);

/**
 * **抢单池**里陪玩端一定看不到的字段（老板 2026-10-01）。
 *
 * 老板：「订单池怎么还没抢的订单也能看到客户微信等信息？被抢过的怎么也显示？还没抢就显示微信
 * 那还抢什么？」—— 客户联系方式（微信号 / YY / KOOK / 房间码）以前漏在陪玩端的隐藏清单外边，
 * 2026-09-30 把订单数据收成「唯一一份字段口径」之后，抢单池那一行也跟着走同一份口径，
 * 微信就顺着显示出来了。
 *
 * 这里是**抢单池专用**的隐藏清单，比 COMPANION_HIDDEN_FIELDS 多藏「客户联系方式 + 二维码」：
 *  - 抢单池里**不是自己的单**（还没抢到的、被别人抢走的）：联系方式一个字都不显示，抢到手才有；
 *  - 客服指定给自己的单、自己已经抢到的单：照常显示（服务要用，不能藏）；
 *  - 客服 / 店长 / 老板：不受影响（他们不看这个清单）。
 * 订单管理（接单记录）/ 抢单成功浮窗走的是原来那份 COMPANION_HIDDEN_FIELDS，联系方式照常给。
 */
export const COMPANION_POOL_HIDDEN_FIELDS: ReadonlySet<string> = new Set([
  ...COMPANION_HIDDEN_FIELDS,
  'customerContact',
  'wechatId',
  'yy',
  'kook',
  'roomCode',
  'customerWechatQr',
]);

export const fieldVisibleTo = (
  key: string,
  isCompanion: boolean,
  hidden: ReadonlySet<string> = COMPANION_HIDDEN_FIELDS,
): boolean => !(isCompanion && hidden.has(key));

/**
 * 状态在表格单元格 / 详情弹窗里的文字颜色（老板 2026-09-28「别花里胡哨」之后不再用彩色标签块，
 * 只用彩色文字）。表格和详情弹窗共用这一份，别各写一套。
 */
export const ORDER_STATUS_TEXT_COLOR: Record<string, string> = {
  PENDING: '#B45309',
  CLAIMED: '#6D28D9',
  GRABBED: '#1D4ED8',
  CONFIRMED: '#15803D',
  DONE: '#15803D',
  CANCELLED: '#94A3B8',
};

// ── 取值（纯文本，一个字段一行）─────────────────────────────────────────────
// 表格单元格、订单详情、订单池那一行用的是同一份取值函数，保证「同一个数据在哪儿都是同一段文字」。

export const orderTypeLabel = (o: any): string => orderTypeConfig[o?.type]?.label || o?.type || '首单';

/**
 * 池子里超时没人抢、已经退回「流转失败明细」的单：状态直接写「无人接」。
 *
 * 老板 2026-10-02：「管理端直添客户流转明细 最前边怎么显示无人接？客服只是记录 又没派单出去
 * 更不是没人接，怎么就成了无人接」—— 「无人接」是**抢单池**的结论（单子放出去了、没人接）。
 * 只要客服已经接手这张单，它就不再是「没人接」，状态按订单自己的状态走（PENDING → 待派单）：
 *  - `directAdd`：「管理端直添客户」登记进来的单，从来没进过抢单池；
 *  - `contactStatus`：客服在跟进台账 / 订单管理里记过添加情况（待添加 / 已添加 / 客户已同意 /
 *    添加失败 / 已派单）—— 客服那一列「添加情况」照旧单独显示走到哪一步，两个格互不打架。
 */
export const isOrderStuck = (o: any): boolean => {
  const cf = o?.customFields || {};
  if (cf.poolExpired !== true || o?.companionId) return false;
  if (cf.directAdd === true) return false;
  if (o?.contactStatus) return false;
  return true;
};

export const orderStatusLabel = (o: any): string => {
  if (isOrderStuck(o)) return '无人接';
  return orderStatusConfig[o?.status]?.label || o?.status || '-';
};

export const orderUrgencyText = (o: any): string =>
  o?.customFields?.urgency === 'later' ? '预约' : '立即打';

/** 游戏 / 服务：游戏名 +（护航 / 做任务）+ 任务 + 双（默认的「陪玩」不写出来，省宽度）。 */
export const orderGameText = (o: any): string => {
  const cf = o?.customFields || {};
  const svc = serviceTypeConfig[o?.serviceType]?.label;
  const parts = [
    svc && svc !== '陪玩' ? svc : '',
    cf.deltaMission || '',
    cf.deltaCount === '双' ? '双' : '',
  ].filter(Boolean);
  return [o?.gameName || '-', ...parts].join(' ');
};

export const orderServiceTypeText = (o: any): string =>
  serviceTypeConfig[o?.customFields?.serviceType || o?.serviceType]?.label || '陪玩';

export const orderDeltaCountText = (o: any): string =>
  o?.coCompanionId || o?.customFields?.deltaCount === '双' ? '双陪' : '单陪';

export const orderBillingModeText = (o: any): string =>
  billingModeConfig[o?.customFields?.billingMode]?.label || billingModeConfig.hour.label;

export const orderDurationText = (o: any): string => {
  const cf = o?.customFields || {};
  return cf.billingMode === 'round'
    ? `${o?.duration || cf.deltaCount || '?'}局`
    : `${o?.duration || '?'}小时`;
};

export const orderAmountText = (o: any): string => `\u00A5${Number(o?.amount || 0).toFixed(0)}`;

export const orderCustomerWechat = (o: any): string =>
  o?.customFields?.customerWechat || o?.customer?.wechatId || '';

/** 客户联系方式：微信号 + YY + KOOK + 房间码（就是发布订单表单「客户联系方式」那一行的四个框）。 */
export const orderCustomerContact = (o: any): string => {
  const cf = o?.customFields || {};
  const wechat = orderCustomerWechat(o);
  return [
    wechat ? `${ORDER_FIELD_LABELS.wechatId}:${wechat}` : '',
    cf.customerYy ? `${ORDER_FIELD_LABELS.yy}:${cf.customerYy}` : '',
    cf.customerPlatformAccount ? `${ORDER_FIELD_LABELS.kook}:${cf.customerPlatformAccount}` : '',
    cf.customerRoomCode ? `${ORDER_FIELD_LABELS.roomCode}:${cf.customerRoomCode}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
};

export const orderCompanionText = (o: any): string => {
  const name = o?.companion?.user?.username;
  if (!name) return '';
  const co = o?.coCompanion?.user?.username;
  const studio = o?.companion?.studio;
  // 订单上的 studioId 是发布方；两者不一致就是桥接工作室接的单（本店自己的工作室名不用重复写）
  const isBridged = !!o?.studioId && !!studio?.id && o.studioId !== studio.id;
  return `${name}${co ? '+' + co : ''}${isBridged ? ' · 桥接·' + studio.name : ''}`;
};

/** 发布：发布人 + 短时间（完整时间放 title / 详情里）。 */
export const orderCreatedByText = (o: any): string => {
  const who = o?.csUser?.username || '-';
  const d = new Date(o?.grabbedAt || o?.createdAt);
  if (Number.isNaN(d.getTime())) return who;
  return `${who} ${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

export const ORDER_FIELD_TEXT: Record<string, (o: any) => string | null> = {
  orderCode: (o) => {
    const code = o?.orderCode || (o?.id ? String(o.id).slice(0, 8) : '');
    return code ? `${code} · ${orderTypeLabel(o)}` : null;
  },
  status: (o) => orderStatusLabel(o),
  game: (o) => orderGameText(o),
  amount: (o) => `${orderAmountText(o)} · ${orderUrgencyText(o)}`,
  customerSource: (o) => o?.customFields?.customerSource || o?.customer?.platform || null,
  customerSourceAccount: (o) => o?.customFields?.customerSourceAccount || null,
  customerNickname: (o) => {
    const nickname = o?.customFields?.customerNickname || '';
    const code = o?.customer?.customerCode;
    if (!nickname && !code) return null;
    // 客户编号（1~3 位）跟在昵称后面当小字（和订单管理表「客户昵称」那一列一个口径）
    return [nickname || '-', code || ''].filter(Boolean).join(' · ');
  },
  customerAccountId: (o) => o?.customFields?.customerAccountId || null,
  customerContact: (o) => orderCustomerContact(o) || null,
  // 「客户联系方式」拆开逐条显示（订单详情 / 抢单成功浮窗）时就是这几项，名字同一份
  wechatId: (o) => orderCustomerWechat(o) || null,
  yy: (o) => o?.customFields?.customerYy || null,
  kook: (o) => o?.customFields?.customerPlatformAccount || null,
  roomCode: (o) => o?.customFields?.customerRoomCode || null,
  orderNote: (o) => o?.customFields?.deltaNote || o?.notes || null,
  companion: (o) => orderCompanionText(o) || null,
  createdAt: (o) => orderCreatedByText(o),
  // 「详情」类页面（订单详情 / 抢单成功浮窗）逐行列出来的服务细节，取值也收在这一份里
  serviceType: (o) => orderServiceTypeText(o),
  deltaMission: (o) => o?.customFields?.deltaMission || null,
  deltaCount: (o) => orderDeltaCountText(o),
  duration: (o) => orderDurationText(o),
  billingMode: (o) => orderBillingModeText(o),
};

/**
 * 一张卡片 / 一行里按什么顺序、展示哪些字段 —— 就是订单管理表的列顺序
 * （订单 → 状态 → 游戏 / 服务 → 金额 / 打单 → 客户五列 → 备注 → 主陪 / 副陪 → 发布）。
 */
export const ORDER_CARD_FIELD_ORDER: string[] = [
  'orderCode',
  'status',
  'game',
  'amount',
  'customerSource',
  'customerSourceAccount',
  'customerNickname',
  'customerAccountId',
  'customerContact',
  'orderNote',
  'companion',
  'createdAt',
];

/**
 * 「一张卡」把服务细节也列出来时的字段顺序（抢单成功浮窗）：就是订单管理表的列顺序，
 * 「游戏 / 服务」后面插上发布订单表单里的服务细节（服务类型 / 任务类型 / 单双陪 / 时长 / 计费方式）。
 */
export const ORDER_DETAIL_FIELD_ORDER: string[] = [
  'orderCode',
  'status',
  'game',
  'serviceType',
  'deltaMission',
  'deltaCount',
  'duration',
  'billingMode',
  'amount',
  'customerSource',
  'customerSourceAccount',
  'customerNickname',
  'customerAccountId',
  'customerContact',
  'orderNote',
  'companion',
  'createdAt',
];

/** 单个字段的纯文本取值（客户管理 / 客户详情拿客户最近一单当订单用）。 */
export const orderFieldText = (order: any, key: string): string | null =>
  ORDER_FIELD_TEXT[key]?.(order) ?? null;

export interface OrderFieldEntry {
  key: string;
  label: string;
  text: string;
  /** 值可以点一下复制（抢单成功浮窗里的客户联系方式） */
  copyable?: boolean;
}

/** 按口径把一条订单摊成「标签 + 值」若干项；没有值的字段直接跳过（陪玩端跳过来源那几列）。 */
export function buildOrderFieldEntries(
  order: any,
  opts: { isCompanion?: boolean; keys?: string[]; hidden?: ReadonlySet<string> } = {},
): OrderFieldEntry[] {
  const isCompanion = opts.isCompanion === true;
  const keys = opts.keys ?? ORDER_CARD_FIELD_ORDER;
  const out: OrderFieldEntry[] = [];
  for (const key of keys) {
    if (!fieldVisibleTo(key, isCompanion, opts.hidden)) continue;
    const text = ORDER_FIELD_TEXT[key]?.(order);
    if (text === null || text === undefined || text === '') continue;
    out.push({ key, label: orderFieldLabel(key), text: String(text) });
  }
  return out;
}
