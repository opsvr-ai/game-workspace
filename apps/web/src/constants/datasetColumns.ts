import type React from 'react';

/**
 * 订单 / 客户是同一份数据，从「订单发布 → 订单池 → 订单管理 → 客户管理」一路都在展示它。
 * 以前每个页面各写各的列宽和字号，改一处就对不齐，所以统一收在这里：
 * 订单管理表、客户管理表、两个订单池行、订单详情、客户详情、发布订单表单都从这里取值。
 *
 * 约定：
 *  - 列宽一律取 FIELD_WIDTH 里的值，页面里不要再写魔法数字；
 *  - 正文用 DATA_FONT_SIZE，行内小标签用 DATA_TAG_FONT_SIZE，次要信息用 DATA_SUB_FONT_SIZE；
 *  - 表格 scroll.x 用 sumWidths([...]) 算，别再手写一个比实际列宽之和小的值
 *    （写小了 antd 会把列按比例压扁，昵称那类列会被挤成竖排单字）。
 */

/** 列表正文：表格单元格、订单池每一行、订单/客户详情 */
export const DATA_FONT_SIZE = 13;
/** 表头（比正文小一号，和全站表头风格一致） */
export const DATA_HEAD_FONT_SIZE = 11;
/** 行内小标签：状态、类型、任务这类 Tag */
export const DATA_TAG_FONT_SIZE = 11;
/** 次要信息：时间、辅助说明、「已弃用」这类小字 */
export const DATA_SUB_FONT_SIZE = 11;
/** 列表里的控件（操作列按钮、备注输入框、分页）—— 比正文小一号，全站统一 */
export const DATA_CONTROL_FONT_SIZE = 12;
/** 订单池那种「一行一条」的行内边距 */
export const DATA_ROW_PADDING = '9px 12px';
/** 详情弹窗 / 抽屉里左侧标签列的固定宽度 */
export const DETAIL_LABEL_WIDTH = 112;

/**
 * 字段宽度（px）。同一个字段在订单管理和客户管理里必须是同一个数，
 * 这样客服在两张表、两个池子里看到的「游戏 / 金额 / 客户微信」都是同宽的。
 */
export const FIELD_WIDTH = {
  // ── 订单字段（订单管理表）──
  orderCode: 88,
  type: 76,
  status: 90,
  game: 110,
  service: 80,
  count: 60,
  mission: 76,
  amount: 84,
  urgency: 82,
  /** 「主陪 / 接单工作室」合并列（主陪名 + 工作室标签上下排） */
  studio: 124,
  coCompanion: 92,
  customerWechat: 140,
  source: 92,
  createdAt: 150,
  csUser: 88,

  // ── 客户字段（客户管理表）──
  customerCode: 150,
  wechatId: 130,
  nickname: 120,
  sourceAccount: 150,
  lastOrder: 220,
  workWechat: 100,
  followUp: 120,
  totalSpent: 120,

  // ── 两张表共用（同一份数据，必须同宽）──
  /** 客户管理表的「陪玩」列 */
  companion: 110,
  /** 客户管理表的「来源/时间」列 */
  sourceTime: 110,
  notes: 200,

  // ── 操作列（定宽 + 钉在右侧，确保订单信息再长也挤不掉按钮）──
  /** 客户管理表的操作列：归属调整 / 编辑 / 删除 */
  actions: 280,
  /**
   * 订单管理表的操作列：沟通 / 已添加 / 添加成功 / 添加失败 / 修改 / 退款，
   * 按钮最多的一行实测要 358px，再加上单元格内边距，280 会把「修改 / 退款」切掉。
   */
  orderActions: 344,
} as const;

/** 计算 scroll.x：传进去的字段宽度之和，保证表头不会被挤到换行 / 列不会被压扁。 */
export function sumWidths(keys: Array<keyof typeof FIELD_WIDTH>): number {
  return keys.reduce((total, key) => total + FIELD_WIDTH[key], 0);
}

/** 订单管理表的列（顺序即表头顺序），scroll.x 直接用它算。 */
export const ORDER_TABLE_KEYS: Array<keyof typeof FIELD_WIDTH> = [
  'orderCode', 'type', 'status', 'game', 'service', 'count', 'mission',
  'amount', 'urgency', 'studio', 'coCompanion', 'customerWechat',
  'source', 'createdAt', 'csUser', 'orderActions',
];

/** 客户管理表的列（管理端 / 客服视角）。 */
export const CUSTOMER_TABLE_KEYS: Array<keyof typeof FIELD_WIDTH> = [
  'customerCode', 'wechatId', 'nickname', 'sourceAccount', 'lastOrder',
  'sourceTime', 'status', 'workWechat', 'companion', 'followUp',
  'totalSpent', 'notes', 'actions',
];

/** 客户管理表的列（陪玩视角：没有客户昵称 / 来源账号）。 */
export const CUSTOMER_TABLE_KEYS_COMPANION: Array<keyof typeof FIELD_WIDTH> = [
  'customerCode', 'wechatId', 'lastOrder', 'sourceTime', 'status',
  'workWechat', 'companion', 'followUp', 'totalSpent', 'notes', 'actions',
];

/** 表格正文统一字号，给 antd Table 的 style 直接用。 */
export const TABLE_STYLE: React.CSSProperties = {
  fontSize: DATA_FONT_SIZE,
};

/**
 * 把数据字号注入成 CSS 变量（--data-font-size / --data-head-font-size）。
 * CSS 里所有跟订单 / 客户数据有关的字号都读这两个变量，
 * 这样「改字号」永远只有一个地方：本文件。
 */
export function applyDataFontCssVars(): void {
  const root = document.documentElement.style;
  root.setProperty('--data-font-size', `${DATA_FONT_SIZE}px`);
  root.setProperty('--data-head-font-size', `${DATA_HEAD_FONT_SIZE}px`);
  root.setProperty('--data-control-font-size', `${DATA_CONTROL_FONT_SIZE}px`);
}

/** 操作列统一配置：定宽 + 钉在右侧。 */
export const ACTIONS_COLUMN = {
  width: FIELD_WIDTH.actions,
  fixed: 'right' as const,
};

/** 订单管理表的操作列：按钮更多，所以比客户表宽。 */
export const ORDER_ACTIONS_COLUMN = {
  width: FIELD_WIDTH.orderActions,
  fixed: 'right' as const,
};