/**
 * 订单相关统一常量 — 所有角色共用
 *
 * 这些配置之前分散在 OrderTable、cs/OrdersPage、companion/OrdersPage、
 * admin/DispatchPage、cs/DispatchPage 等文件中各自定义，现在统一为单一来源。
 */

// 老板 2026-09-30：「从发布订单→进入抢单池/指定→订单管理→客户管理 用的都是同一条数据，
// 你把所有的显示的标签都用一样的不行么？」—— RENEW 以前这里写「续费」，
// 发布订单表单（CreateOrderModal）、陪玩端「续单」按钮、业绩里的「续单率」都写「续单」，
// 同一个东西两个名字。统一成「续单」。
export const orderTypeConfig: Record<string, { color: string; label: string }> = {
  NEW: { color: 'blue', label: '首单' },
  RENEW: { color: 'cyan', label: '续单' },
  REPURCHASE: { color: 'purple', label: '复购' },
  TIP: { color: 'orange', label: '打赏' },
};

// 老板 2026-09-30：「状态 已抢到订单改成已被抢 无人接单改成 无人接 全部压缩到3个字，
// 状态跟游戏之间再缩短一点，这不就有位置了」—— 状态文案一律 **3 个字**（多一个字，
// 订单管理那张表的状态列就要多 12px，13 列的表就多一格横向滚动）。
export const orderStatusConfig: Record<string, { color: string; label: string }> = {
  PENDING: { color: 'gold', label: '待派单' },
  CLAIMED: { color: 'purple', label: '已认领' },
  GRABBED: { color: 'blue', label: '已被抢' },
  CONFIRMED: { color: 'green', label: '进行中' },
  DONE: { color: 'green', label: '已完成' },
  // 存单：客户先把钱存进来、这次还没打。老板 2026-10-08 全链路复查时补的 ——
  // 以前这个状态没进枚举，界面会把英文 DEPOSITED 直接打给用户看。
  DEPOSITED: { color: 'cyan', label: '已存单' },
  CANCELLED: { color: 'default', label: '已取消' },
};

export const dispatchTypeConfig: Record<string, { color: string; label: string }> = {
  POOL: { color: 'blue', label: '入池' },
  BROADCAST: { color: 'purple', label: '广播' },
  DIRECT: { color: 'green', label: '指定' },
};

/**
 * 派单方式的显示名（指定 / 入池 / 广播）。取不到值就返回空串，
 * **绝不把英文枚举原文打给用户看**（老板 2026-09-30：「标签都用一样的」）。
 * 订单管理表的「派单方式」列、订单详情的同一行、工具条筛选下拉全部走这一份。
 *
 * 注意：发布订单表单里选「广播」时，服务端存的是 `POOL`（见 orders.service.ts ——
 * 广播本来就是「进抢单池」的一种），所以库里只有 POOL / DIRECT 两种值；
 * 陪玩自建、续单、直添客户那些同样是 POOL。
 */
export const dispatchTypeLabel = (dispatchType?: string | null): string =>
  dispatchTypeConfig[String(dispatchType ?? '')]?.label ?? '';

/** 派单方式的固定顺序：**指定排最前**（老板天天要找的就是它），后面才是入池 / 广播。 */
export const dispatchTypeOrder = ['DIRECT', 'POOL', 'BROADCAST'];

/** 订单管理工具条「派单方式」筛选下拉的选项，标签取上面那一份，不另写中文。 */
export const dispatchTypeOptions = dispatchTypeOrder.map((value) => ({
  value,
  label: dispatchTypeConfig[value]?.label ?? value,
}));

export const contactStatusConfig: Record<string, { color: string; label: string }> = {
  added: { color: 'green', label: '联系方式添加成功' },
  not_accepted: { color: 'orange', label: '已添加未同意' },
};

export const urgencyConfig: Record<string, { color: string; label: string }> = {
  now: { color: 'green', label: '⚡立即打' },
  later: { color: 'purple', label: '📅预约' },
};

// 老板 2026-09-30：这里的 key 以前写的是 `hourly`，可发布订单表单存进去的是 `hour` / `round`，
// 所以「计费方式」在订单详情里一直取不到值、只能靠兜底文字。改成跟表单同一个 key，
// 文案也跟表单同一份（按小时 / 按局数）—— 同一个数据在所有页面同一个名字。
export const billingModeConfig: Record<string, { color: string; label: string }> = {
  hour: { color: 'blue', label: '按小时' },
  round: { color: 'default', label: '按局数' },
};

export const settlementTypeOptions = [
  { label: '陪玩', value: 'COMPANION' },
  { label: '代练', value: 'ESCORT' },
];

export const serviceTypeConfig: Record<string, { color: string; label: string }> = {
  PLAY_WITH: { color: 'blue', label: '陪玩' },
  ESCORT: { color: 'orange', label: '护航' },
  DO_TASK: { color: 'purple', label: '做任务' },
};

// 老板 2026-10-01：「选择机密时 金额默认 35；选择绝密时 金额默认 45」——
// 发单弹窗选「任务类型」时按这个把金额带出来（已经手动填过别的价就不覆盖）。
export const deltaMissionDefaultPrice: Record<string, number> = {
  机密: 35,
  绝密: 45,
};

export const customerPaidToConfig: Record<string, { color: string; label: string }> = {
  CS_WECHAT: { color: 'purple', label: '客服工作微信' },
  COMPANION_WECHAT: { color: 'blue', label: '陪玩微信' },
  STUDIO_ACCOUNT: { color: 'green', label: '工作室收款账号' },
  OTHER: { color: 'default', label: '其他' },
};
