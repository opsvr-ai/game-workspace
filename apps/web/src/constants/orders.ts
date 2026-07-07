/**
 * 订单相关统一常量 — 所有角色共用
 *
 * 这些配置之前分散在 OrderTable、cs/OrdersPage、companion/OrdersPage、
 * admin/DispatchPage、cs/DispatchPage 等文件中各自定义，现在统一为单一来源。
 */

export const orderTypeConfig: Record<string, { color: string; label: string }> = {
  NEW: { color: 'blue', label: '首单' },
  RENEW: { color: 'cyan', label: '续费' },
  REPURCHASE: { color: 'purple', label: '复购' },
  TIP: { color: 'orange', label: '打赏' },
};

export const orderStatusConfig: Record<string, { color: string; label: string }> = {
  PENDING: { color: 'gold', label: '待派单' },
  GRABBED: { color: 'blue', label: '已接单' },
  CONFIRMED: { color: 'green', label: '进行中' },
  DONE: { color: 'green', label: '已完成' },
  CANCELLED: { color: 'default', label: '已取消' },
};

export const dispatchTypeConfig: Record<string, { color: string; label: string }> = {
  POOL: { color: 'blue', label: '抢单池' },
  DIRECT: { color: 'green', label: '直接分配' },
};

export const contactStatusConfig: Record<string, { color: string; label: string }> = {
  added: { color: 'green', label: '联系方式添加成功' },
  not_accepted: { color: 'orange', label: '已添加未同意' },
};

export const urgencyConfig: Record<string, { color: string; label: string }> = {
  now: { color: 'green', label: '⚡立即打' },
  later: { color: 'purple', label: '📅预约' },
};

export const billingModeConfig: Record<string, { color: string; label: string }> = {
  hourly: { color: 'blue', label: '按小时' },
  round: { color: 'default', label: '按局' },
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
