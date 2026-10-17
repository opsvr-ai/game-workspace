// craftsman-ignore: TS001,TS003
// 订单子域共享常量（从 orders.service.ts 抽出，值与含义保持不变）。

// 搭档邀请有效期（老板 2026-10-03）：60 秒太短 —— 陪玩在游戏里 / 在微信上，
// 看到横幅再切回来经常就过了，邀请一超时就等于这单没有搭档，被邀请方也拿不到记录。
// 放到 3 分钟；而且超时只撤掉「待搭档」，不再把整段会话/订单作废（见 schedulePartnerInviteExpiry）。
export const PARTNER_INVITE_TTL_SEC = 180;

/**
 * 转让申请多久没人理就作废（老板 2026-10-03：「需要被转让方同意才能过来」）。
 * 30 分钟：够对方打完一局看到弹窗，又不至于让一张单一直挂着一个没人认的申请。
 */
export const TRANSFER_REQUEST_TTL_SEC = 30 * 60;

/** 补单申请类型（同一张表装两件事，老板 2026-10-08）：补单＝添加失败要名额；退单＝这单没打成要退掉。 */
export const SUPPLEMENT_TYPE = 'SUPPLEMENT';

/** 「桥接工作室等待」默认值（秒）：库里没配置时用它。 */
export const DEFAULT_BRIDGE_DELAY_SECONDS = 30;
