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
export const DATA_FONT_SIZE = 12;
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
  /** 「订单」单行：订单号 + 订单类型（如「232 · 首单」） */
  orderCode: 70,
  /** 订单管理表的状态列：状态文字，或红字「无人接单」（超时退回的单） */
  orderStatus: 74,
  /** 「游戏 / 服务」单行：游戏名 + 护航/任务 + 机密/绝密 + 双陪 */
  game: 128,
  /** 「金额 / 打单」单行：¥金额 + 立即打（预约是蓝字） */
  amount: 80,
  /** 「客户微信 / 编号」单行 */
  customerWechat: 120,
  /** 「客户账号」单行：来源平台 + 来源账号 + 昵称 + 客户ID + 房间码 + YY / KOOK（+ 二维码小图） */
  customerAccounts: 108,
  /** 「主陪 / 副陪」单行：陪玩名（+副陪、桥接工作室） */
  studio: 86,
  /** 「发布」单行：发布人 + 发布时间 */
  createdAt: 118,
  status: 72,

  // ── 客户字段（客户管理表）──
  /**
   * 客户编号列：编号 + 微信号 + 昵称 + 存单/预约（一行），钉在左侧（见 CUSTOMER_CODE_COLUMN）。
   * 下面这些宽度按客服客户端窗口（1320 宽 → 表格可用 991px）重算过：
   * 单行单元格比原来「上下两行」窄，整张表能落在 991px 里，不用左右拖。
   */
  customerCode: 160,
  lastOrder: 140,
  sourceTime: 120,
  companionWechat: 100,
  followUpSpent: 104,

  // ── 两张表共用（同一份数据，必须同宽）──
  /** 客户管理表的「陪玩」列（独立使用时的大小，客户表已改为合并列） */
  companion: 110,
  notes: 104,

  // ── 操作列（定宽 + 钉在右侧，确保订单信息再长也挤不掉按钮）──
  /**
   * 客户管理表的操作列（陪玩视角）：沟通 / 首单 / 发布订单 / 预约 / 存单 / 查看 / 删除，
   * 7 个按钮在列内自动换行（两行）。
   */
  actions: 190,
  /** 客户管理表的操作列（客服 / 管理端）：归属调整 / 编辑 / 删除，三个链接按钮，窄列就够 */
  actionsStaff: 176,
  /**
   * 订单管理表的操作列：固定格子排布（2026-09-28 收紧）。
   * 按钮统一 22px 高 / 12px 字号，最宽的一行是「沟通 38 + 客户已同意 72 + 添加失败 60」= 180px（间隔 5px），
   * 加单元格内边距两边的 10px → 196。和上面 8 列相加 = 980px，落在客服窗口的 991px 里（横向不用拖）。
   */
  orderActions: 196,
} as const;

/**
 * 计算 scroll.x：传进去的字段宽度之和，保证表头不会被挤到换行 / 列不会被压扁。
 * 注意：下面这些宽度是「列宽」，单元格左右各留 5px 内边距（见 global.css 的 .data-table），
 * 所以真正放文字的地方是「列宽 − 10px」。
 */
export function sumWidths(keys: Array<keyof typeof FIELD_WIDTH>): number {
  return keys.reduce((total, key) => total + FIELD_WIDTH[key], 0);
}

/** 订单管理表的列（顺序即表头顺序），scroll.x 直接用它算。 */
export const ORDER_TABLE_KEYS: Array<keyof typeof FIELD_WIDTH> = [
  'orderCode', 'orderStatus', 'game', 'amount',
  'customerWechat', 'customerAccounts', 'studio', 'createdAt', 'orderActions',
];

/** 客户管理表的列（管理端 / 客服视角）。 */
export const CUSTOMER_TABLE_KEYS: Array<keyof typeof FIELD_WIDTH> = [
  'customerCode', 'lastOrder', 'sourceTime', 'status',
  'companionWechat', 'followUpSpent', 'notes', 'actionsStaff',
];

/** 客户管理表的列（陪玩视角：没有客户昵称 / 来源账号）。 */
export const CUSTOMER_TABLE_KEYS_COMPANION: Array<keyof typeof FIELD_WIDTH> = [
  'customerCode', 'lastOrder', 'sourceTime', 'status',
  'companionWechat', 'followUpSpent', 'notes', 'actions',
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

/**
 * 客户编号列：定宽 + 钉在左侧，它同时是整张表的「这一行是谁」。
 *
 * 编号只有 1~3 位，光看编号认不出是哪个人，所以这一列同时带上微信号和昵称（一行），
 * 横向拖动看备注 / 累计消费时它一直贴着屏幕左边，「这一行是谁」永远看得见。
 */
export const CUSTOMER_CODE_COLUMN = {
  width: FIELD_WIDTH.customerCode,
  fixed: 'left' as const,
};

/**
 * 操作列的统一 class：按钮规格（22px 高 / 12px 字号）只在 global.css 里写一次，
 * 凡是挂了这个 class 的操作列，按钮自动变小 —— 不用给每个 Button 单独套 style。
 */
export const ACTIONS_CELL_CLASS = 'cell-actions';

/** 客服 / 管理端客户表的操作列：定宽 + 钉在右侧。 */
export const ACTIONS_COLUMN = {
  width: FIELD_WIDTH.actionsStaff,
  fixed: 'right' as const,
  className: ACTIONS_CELL_CLASS,
};

/** 陪玩端客户表的操作列（按钮有 7 个，要宽一些）：定宽 + 钉在右侧。 */
export const ACTIONS_COLUMN_COMPANION = {
  width: FIELD_WIDTH.actions,
  fixed: 'right' as const,
  className: ACTIONS_CELL_CLASS,
};

/** 订单管理表的操作列：按钮最多的一行是「沟通 + 添加成功 + 添加失败 + 退款」，
 *  按钮统一 22px 高 / 11px 字号（和工作室账号管理一致）后一行放得下。 */
export const ORDER_ACTIONS_COLUMN = {
  width: FIELD_WIDTH.orderActions,
  fixed: 'right' as const,
  className: ACTIONS_CELL_CLASS,
};

/**
 * 单元格里的唯一一行（老板 2026-09-28：「所有信息不要分两层显示，该把字体调小就调小，
 * 别花里胡哨」）：一行一个格子、超长自己省略号、完整内容用 title / Tooltip 悬停看，
 * 行高固定 20px，所以整张表的每行都是一样高（约 31px），列与列之间也就自然对齐了。
 */
export const CELL_ONE_LINE: React.CSSProperties = {
  display: 'block',
  lineHeight: '20px',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

/** 单行里的「次要信息」：11px 灰字，跟在主信息后面（如「232 · 首单」里的「首单」） */
export const CELL_SUB_TEXT: React.CSSProperties = {
  fontSize: DATA_SUB_FONT_SIZE,
  color: '#94A3B8',
  marginLeft: 4,
};

/** 单行里的「主要信息」：深色加粗（金额、累计消费这类要一眼看到的值） */
export const CELL_MAIN_TEXT: React.CSSProperties = {
  color: '#1F2937',
  fontWeight: 600,
};

/** 同上（兼容老名字）：单元格里的一行小字，超长省略号 */
export const CELL_LINE_STYLE: React.CSSProperties = {
  display: 'block',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

/** 同上，小一号（次要信息 / 11px）。 */
export const CELL_SUB_LINE_STYLE: React.CSSProperties = {
  ...CELL_LINE_STYLE,
  fontSize: DATA_SUB_FONT_SIZE,
};