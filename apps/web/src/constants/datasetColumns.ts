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
  orderCode: 66,
  /** 订单管理表的状态列：状态文字，或红字「无人接单」（超时退回的单） */
  orderStatus: 72,
  /** 「游戏 / 服务」单行：游戏名 + 双 + 机密/绝密（空格分隔，省下的宽度留给客户列）。
   *  2026-09-28 第三次调整：客服默认窗口 1320 宽时，订单管理那张表真正能用的只有 985px
   *  （卡片内边距 14×2 之后的宽度），而九列加起来是 986 → 多出来的 1px 会让表格长出横向滚动条。
   *  实测这一列最长的内容（如「三角洲行动机密 双」）只占 70~90px，所以从 118 收到 112，
   *  九列合计 980px，1320 窗口下不用往右拖。 */
  game: 112,
  /** 「金额 / 打单」单行：¥金额 + 立即打（预约是蓝字） */
  amount: 74,
  /** 「客户微信 / 编号」单行 */
  customerWechat: 118,
  /** 「客户账号」单行（管理端）：来源平台 + 来源账号 + 昵称 + 客户账号ID + 房间码 + YY / KOOK（+ 二维码小图）。
   *  老板 2026-09-29：「订单管理的客户账号那里显示的全一点：包括客户来源 客户昵称 客户账号ID」、
   *  「是管理端这一列加宽」。实测线上 120 单：来源+来源账号最长 220px、昵称最长 84px、账号ID 最长 92px、
   *  房间码 70px，整格最长 308px —— 原来 84px（放字的地方 74px）只看得见三个字。
   *  这里取 176px（放字的地方 166px）：来源/昵称/账号ID 大多数单子能一口气看全，
   *  最长的那几单仍然靠省略号 + 悬停 + 详情弹窗看全。
   *  代价：管理端订单表基准合计 1072px，1320 宽的窗口会有约 80px 横向滚动 —— 这是「这一列显示全」的代价。
   *  2026-09-29 当天下半场：窗口比 1072px 宽出来的宽度不再堆在「退款」右边，而是按 fitOrderColumnWidths
   *  先补给这一列（最长可到 336px）和「客户微信 / 编号」「主陪 / 副陪」等列。 */
  customerAccounts: 176,
  /** 「客户账号」单行（陪玩端）：陪玩看不到来源 / 昵称 / 账号ID（见 canSeeCustomerSource），
   *  这一格只剩房间码 + YY + KOOK（实测最长 70px），84px 绰绰有余，
   *  也让陪玩端的接单记录仍然是 984px、不给陪玩加横向滚动。 */
  customerAccountsCompanion: 84,
  /** 「主陪 / 副陪」单行：陪玩名（+副陪、桥接工作室） */
  studio: 84,
  /** 「发布」单行：发布人 + 发布时间 */
  createdAt: 116,
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
   * 订单管理表的操作列（2026-09-28 第二次调整，老板：「修改 退款 显示在 添加失败后边」）。
   * 现在**一行**按顺序排：「沟通 36 + 添加成功 / 已同意 60 + 添加失败 60 + 修改 36 + 退款 36」= 244px（间隔 4px），
   * 加单元格内边距两边的 10px → 254。和上面 8 列相加 = 986px，仍然落在客服窗口的 991px 里（横向不用拖），
   * 而且所有行的数据行高统一 33px（以前有沟通按钮的行要两行 = 59px）。
   */
  orderActions: 254,
  /**
   * 陪玩端订单管理（接单记录）的操作列：陪玩没有「修改 / 退款」
   * （OrdersPage 的 canEditOrder 对陪玩恒为 false、hasOrderRow 也是 false）。
   * 一行最多「沟通 36 + 添加成功 / 已同意 60 + 添加失败 60 + 转让 36」= 192px（间隔 4×3）+
   * 单元格内边距 10px → 214。省下来的 40px 给了「备注」列。
   * 老板 2026-09-29 加「转让」后比原来宽 40px（陪玩端整表 984 → 1024px），
   * 这是「不加宽就得把备注 / 房间码列砍掉」的取舍 —— 陪玩端窗口拉宽一点即可。
   */
  companionOrderActions: 214,
  /**
   * 陪玩端的「备注」列：客服发单时填的备注（`customFields.deltaNote`）。
   * 老板 2026-09-29：「陪玩抢到订单后，订单管理怎么没显示当时发单时填写的备注」——
   * 这一列以前只有订单池卡片和订单详情弹窗里有。一格一行、超长省略号 + 鼠标悬停看全。
   */
  orderNote: 84,
  /**
   * 派单管理下面三张订单列表（订单池流转失败明细 / 管理端直添客户跟进列表 / 流转明细）的
   * 「说明」列：退回时间 / 添加情况 / 收款情况。老板 2026-09-28：「流转失败列表页很混乱」——
   * 这三张表以前是卡片行，一格叠 2~3 行、十几个彩色标签，现在和订单管理一样「一格一行」。
   */
  panelNote: 150,
  /** 上面三张列表的操作列：按钮只有 2~3 个，比订单管理的窄，钉在右侧不让内容挤掉 */
  panelActions: 178,
} as const;

/**
 * 「客服跟进台账」（派单管理里的那一页，老板 2026-09-29 定稿）的列宽。
 * 和订单管理那套不一样：这一页是**按人看的台账** —— 客户 → 客服工作微信 → 走到哪一步 →
 * 最后跟进（时间 + 聊了啥）→ 下次跟进 → 操作。一格一行、超长省略号 + 鼠标悬停看全。
 * 宽度预算（基准 1066px）：客户 320 + 客服工作微信 108 + 添加情况 92 + 最后跟进 240
 * + 下次跟进 104 + 操作 202。1320 的客服默认窗口（可用约 991px）会有约 75px 横向滚动，
 * 和这一页以前那张表（1062px）差不多。
 */
export const LEDGER_FIELD_WIDTH = {
  customer: 320,
  workWechat: 108,
  state: 92,
  lastFollow: 240,
  nextFollow: 104,
  actions: 202,
} as const;

/** 跟进台账整表宽度（scroll.x）：列宽之和，别手写比它小的值，否则列会被压扁 */
export const LEDGER_TABLE_WIDTH: number = Object.values(LEDGER_FIELD_WIDTH).reduce(
  (total: number, w: number) => total + w,
  0,
);

/**
 * 计算 scroll.x：传进去的字段宽度之和，保证表头不会被挤到换行 / 列不会被压扁。
 * 注意：下面这些宽度是「列宽」，单元格左右各留 5px 内边距（见 global.css 的 .data-table），
 * 所以真正放文字的地方是「列宽 − 10px」。
 */
export function sumWidths(keys: Array<keyof typeof FIELD_WIDTH>): number {
  return keys.reduce((total, key) => total + FIELD_WIDTH[key], 0);
}

/** 订单管理表的列（管理端，顺序即表头顺序），scroll.x 直接用它算。
 *  2026-09-29「客户账号」列 84 → 176 之后，合计 66+72+112+74+118+176+84+116+254 = **1072px**。
 *  窗口比这宽时多出来的宽度怎么分，见下面的 fitOrderColumnWidths（补给客户信息列，不再堆在退款右边）。 */
export const ORDER_TABLE_KEYS: Array<keyof typeof FIELD_WIDTH> = [
  'orderCode', 'orderStatus', 'game', 'amount',
  'customerWechat', 'customerAccounts', 'studio', 'createdAt', 'orderActions',
];

/**
 * 陪玩端订单管理（接单记录）的列：比客服端多一列「备注」（插在「客户账号」后面）。
 * 「客户账号」用陪玩端的窄版（customerAccountsCompanion —— 陪玩只看得到房间码 / YY / KOOK）。
 * 合计 66+72+112+74+118+84+84+84+116+214 = **1024px**（2026-09-29 加「转让」按钮后 +40px）。
 */
export const ORDER_TABLE_KEYS_COMPANION: Array<keyof typeof FIELD_WIDTH> = [
  'orderCode', 'orderStatus', 'game', 'amount',
  'customerWechat', 'customerAccountsCompanion', 'orderNote', 'studio', 'createdAt', 'companionOrderActions',
];

/**
 * 订单管理表九列的基准宽度之和 —— 也是这张表 scroll.x 的下限（66+72+112+74+118+176+84+116+254 = 1072px）。
 */
export const ORDER_TABLE_BASE_WIDTH = sumWidths(ORDER_TABLE_KEYS);

/**
 * 各列「内容真正需要的宽度」（线上 112 单实测 = 内容最长值 + 左右各 5px 内边距 + 2px 余量）。
 * 窗口比表格宽出来的部分，优先补到这些上限 —— 补到这儿，客户来源 / 昵称 / 账号ID、微信号、
 * 主陪、金额就全都能显示下、不再是省略号了。
 */
export const ORDER_COLUMN_MAX_WIDTH: Record<string, number> = {
  orderCode: 74, // 实测最长 61（「232 · 首单」）
  amount: 82, // 实测最长 68（「¥188 立即打」）
  customerWechat: 150, // 实测最长 138（客户微信号）
  customerAccounts: 336, // 实测最长 324（来源 + 来源账号 + 昵称 + 客户账号ID + 房间码）
  studio: 132, // 实测最长 119（陪玩名 + 副陪 + 桥接工作室）
};

/**
 * 补宽顺序。
 *  1. 先补「差几 px 就能显示全」的小列（金额差 4px、订单号差 5px）——
 *     这两个不补的话，几乎每一行的「· 首单」「立即打」都会被省略号吃掉，最扎眼；
 *  2. 再补最缺宽度的「客户账号」（差 160px，来源 / 昵称 / 账号ID 全在里面）；
 *  3. 然后「客户微信 / 编号」「主陪 / 副陪」。
 */
export const ORDER_COLUMN_FIT_ORDER: string[] = [
  'amount',
  'orderCode',
  'customerAccounts',
  'customerWechat',
  'studio',
];

/**
 * 订单管理表的列宽：按窗口真正能给的宽度算。
 *
 * 老板 2026-09-29：「操作的退款后边不是还有很多空间么？不能让退款靠在最右边？
 * 让前边的客户信息全部显示出来？」以前九列全是写死的宽度，窗口比表格宽出来的那一段，
 * 浏览器会按列宽比例平摊给**所有**列（操作列也摊），于是那段空间落在了「退款」右边 ——
 * 该宽的客户信息没宽（只能看省略号），操作列却白撑出一大块空白。
 * 现在改成三步：
 *  1. 先把多出来的宽度按 ORDER_COLUMN_FIT_ORDER 补给被截断的列，补到内容需要的宽度就停
 *     （「客户账号」排第一，所以窗口一宽，来源 / 昵称 / 账号ID 就先显示全）；
 *  2. 还有富余，再按列宽比例摊给 8 个数据列（和浏览器平时的做法一样，只是不再摊给操作列）；
 *  3. 操作列宽度永远不变，按钮靠右对齐 —— 「退款」就贴在表格最右边，后面不留空。
 * 窗口不够宽（可用宽度 < 1072px）时九列维持基准宽度，横向滚动条和以前完全一样。
 *
 * @param availableWidth 表格真正能用的宽度（卡片内容区的宽度，不含页面内边距）
 */
export function fitOrderColumnWidths(availableWidth: number): {
  widths: Record<string, number>;
  scrollX: number;
} {
  const widths: Record<string, number> = { ...FIELD_WIDTH };
  // 留 1px 给浏览器取整：列宽之和正好等于可用宽度时，容易因为小数位冒出一条横向滚动条
  const available = Math.max(0, availableWidth - 1);
  const scrollX = Math.max(ORDER_TABLE_BASE_WIDTH, available);
  let spare = available - ORDER_TABLE_BASE_WIDTH;
  if (spare <= 0) return { widths, scrollX };
  for (const key of ORDER_COLUMN_FIT_ORDER) {
    const room = Math.max(0, (ORDER_COLUMN_MAX_WIDTH[key] ?? widths[key]) - widths[key]);
    const add = Math.min(room, spare);
    widths[key] += add;
    spare -= add;
    if (spare <= 0) return { widths, scrollX };
  }
  // 每列都补到内容需要的宽度了还有富余：按列宽比例摊给数据列（操作列不参与，空白不会再跑到「退款」右边）
  const dataKeys = ORDER_TABLE_KEYS.filter((key) => key !== 'orderActions');
  const dataSum = dataKeys.reduce((total, key) => total + widths[key], 0);
  let left = spare;
  for (const key of dataKeys) {
    const add = Math.min(left, Math.floor((spare * widths[key]) / dataSum));
    widths[key] += add;
    left -= add;
  }
  widths.customerAccounts += left;
  return { widths, scrollX };
}

/** 客户管理表的列（管理端 / 客服视角）。 */
export const CUSTOMER_TABLE_KEYS: Array<keyof typeof FIELD_WIDTH> = [
  'customerCode', 'lastOrder', 'sourceTime', 'status',
  'companionWechat', 'followUpSpent', 'notes', 'actionsStaff',
];

/**
 * 派单管理下面三张订单列表的列（订单池流转失败明细 / 跟进列表 / 流转明细）。
 * 和订单管理同一套宽度（多一个「说明」列、操作列窄一些，并且三张表都用 hideStudio 去掉「主陪 / 副陪」）：
 * 66+72+112+74+118+176+150+116+178 − 84 = **978px**，1320 窗口（可用 991px）仍然一屏放得下。
 * 注意：这三张列表实际用 OrderTable 渲染，scroll.x 是按真实列宽之和算的，这里只是留档。
 */
export const ORDER_PANEL_KEYS: Array<keyof typeof FIELD_WIDTH> = [
  'orderCode', 'orderStatus', 'game', 'amount',
  'customerWechat', 'customerAccounts', 'panelNote', 'createdAt', 'panelActions',
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
 *  按钮统一 22px 高 / 11px 字号（和工作室账号管理一致）后一行正好 244px，列宽 254px
 *  （左右各 5px 内边距）—— 严丝合缝，所以「退款」的右端就贴着表格右边，
 *  后面不会再有空白（老板 2026-09-29：「不能让退款靠在最右边？」）。
 *  这一列是**定宽**的：窗口多出来的宽度全部补给前面的客户信息列，见 fitOrderColumnWidths。 */
export const ORDER_ACTIONS_COLUMN = {
  width: FIELD_WIDTH.orderActions,
  fixed: 'right' as const,
  className: ACTIONS_CELL_CLASS,
};

/** 陪玩端订单管理的操作列：没有「修改 / 退款」，比客服端窄 80px，正好让给「备注」列。 */
export const ORDER_ACTIONS_COLUMN_COMPANION = {
  width: FIELD_WIDTH.companionOrderActions,
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

/**
 * 客户来源（小红书 / 抖音 / 快手…）和来源账号，对**陪玩端一律不显示**。
 *
 * 老板 2026-09-29：「陪玩端 隐藏 客户小红书信息」。服务端
 * `common/order-privacy.ts` 的 `canSeeSourceAccount()` 已经把来源账号抹成 `***`，
 * 前端这里把「小红书」这三个字本身、以及详情弹窗里的「客户来源 / 来源账号」两行也一起藏掉 ——
 * 只抹账号、留着平台名，陪玩还是能看到「这一单是从小红书来的」。
 *
 * 客服 / 店长 / 老板都是管理端，照常显示。
 */
export const canSeeCustomerSource = (role?: string | null): boolean => role !== 'COMPANION';

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
