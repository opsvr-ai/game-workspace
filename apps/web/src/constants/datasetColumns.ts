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
  /** 订单管理表的状态列：状态文字（**一律 3 个字**，见 constants/orders.ts），或红字「无人接」
   *  （超时退回的单）。老板 2026-09-30：「状态 已抢到订单改成已被抢 无人接单改成 无人接
   *  全部压缩到3个字，状态跟游戏之间再缩短一点，这不就有位置了」——
   *  正文 12px 的 3 个字 = 36px（线上逐格量过，正好 36.000px），加左右各 5px 内边距 = **46px**，
   *  所以这一列 72 → 50 → **46px**（老板 2026-09-30 追加：「订单管理中：状态 跟游戏之间
   *  距离太大了 缩小，跟其他的最小间距一样宽度就可以」—— 46px 正好等于内容宽度，
   *  「状态」跟「游戏」之间只剩左右各 5px 内边距，跟别的列的最小间距一样）。
   *  这一列**不参与窗口补宽**（见下面 ORDER_COLUMN_MAX_WIDTH / ORDER_COLUMN_FIT_ORDER 的说明）：
   *  以前窗口一宽它会长到 124px 去放「· 待反馈」这类结果小字，于是那一格后面留出一大片空白 ——
   *  老板说的「距离太大」就是这里。线上 / 桥接单的结果小字现在放不下就省略号，
   *  鼠标悬停看全（orderColumns.tsx 的状态格把结果拼进了 title）。 */
  orderStatus: 46,
  /** 「游戏 / 服务」单行：游戏名 + 双 + 机密/绝密（空格分隔，省下的宽度留给客户列）。
   *  2026-09-28 第三次调整：客服默认窗口 1320 宽时，订单管理那张表真正能用的只有 985px
   *  （卡片内边距 14×2 之后的宽度），而九列加起来是 986 → 多出来的 1px 会让表格长出横向滚动条。
   *  实测这一列最长的内容（如「三角洲行动机密 双」）只占 70~90px，所以从 118 收到 112，
   *  九列合计 980px，1320 窗口下不用往右拖。 */
  game: 112,
  /** 「金额 / 打单」单行：¥金额 + 立即打（预约是蓝字） */
  amount: 74,
  /** 「来源」单行（管理端）：客户是从哪个平台来的（小红书 / 抖音 / 快手…）。
   *  老板 2026-09-30：「你把客户账号拆分成发布订单时细分的名称不行么？比如来源：小红书
   *  引流账号： 客户昵称 客户账号id 客户联系方式，把前边的微信 挪过去」——
   *  原来这一格和来源账号 / 昵称 / 账号ID / 房间码挤在同一列里（216px，实测最长要 326px、
   *  只能显示省略号）；现在一列只放一个字段，每个字段都能显示全。
   *  实测线上 120 单这一格最长「小红书」= 46px（含左右各 5px 内边距）。 */
  customerSource: 50,
  /** 「引流账号」单行（管理端）：发笔记的那个小红书 / 抖音号（trafficAccount.nickname）。
   *  实测最长「总掉萌萌泪 旧 新 鱼鱼鱼🐟」= 157px；再长就省略号 + 鼠标悬停看全。
   *  管理端一律显示完整（抹成 `***` 的规则 2026-09-30 删了），已弃用的账号后面跟小灰字「已弃用」。 */
  customerSourceAccount: 116,
  /** 「客户昵称」单行（管理端）：客户昵称 + 灰字客户编号（编号只有 1~3 位，单独占一列太浪费）。
   *  实测最长「绝密航天毁一生 · 219」= 123px。 */
  customerNickname: 96,
  /** 「客户账号ID」单行（管理端）：客户自己的小红书 ID / 抖音号（到底是哪个客户）。
   *  实测最长「308798116_Peng」= 100px。 */
  customerAccountId: 88,
  /** 「客户联系方式」单行（管理端）：微信 + YY + KOOK + 房间码（+ 二维码小图）。
   *  微信原来单独一列（「客户微信 / 编号」），老板 2026-09-30 让挪到这一格里来。
   *  实测最长「gqs980190843 · 房间OLJ9896」= 167px。 */
  customerContact: 132,
  /**
   * 「主陪 / 副陪」单行：陪玩名（+副陪、桥接工作室）。
   * 老板 2026-09-30：「主陪跟发布中间不是有这么大的空间么？你把他们距离缩小」——
   * 线上 118 单实测：113 行的这一格只要 40~70px（三个字的名字），只有 5 行带
   * 「桥接·工作室名」要 103px，原来 84px 在短名字后面留了一截看得见的空白。
   * 收到 66px（表头「主陪 / 副陪」本身要 64px，再窄表头就折行了），把宽度让给「客户账号」；
   * 长的行（带副陪 / 桥接工作室）照样是省略号 + 鼠标悬停 / 详情弹窗看全。
   * 注意：**只有管理端（订单管理 / 派单管理）收窄到 66px**；陪玩端的接单记录照旧用
   * studioCompanion（84px），陪玩端那一列一个字都没动。
   */
  studio: 66,
  /** 「主陪 / 副陪」在陪玩端的宽度：陪玩要看自己的名字 + 副陪 + 桥接工作室，保持原样 84px，
   *  管理端收窄不影响陪玩端（见 orderColumns.tsx 里的 isCompanion 分支）。 */
  studioCompanion: 84,
  /**
   * 「转让记录」单行（**只在管理端出现**）：整单转让过就标红「已转让」（转过多次带笔数），
   * 鼠标停上去看「什么时候谁转给谁」；没转让过的行留空。
   *
   * 老板 2026-10-03：「这种转让的 能不能放在明面上一眼能看到，你这还得点订单进去才能看到」——
   * 这个标记以前是塞在「主陪 / 副陪」格子里那 66px 里（名字 + 副陪 + 桥接工作室一长就被省略号吃掉），
   * 窗口不够宽时那一列根本不补宽，等于看不见。现在单独给一列、**定宽不参与补宽**，窗口再窄也看得到。
   * 「已转让」3 个字 11px ≈ 33px + 左右各 5px 内边距 = 44px；表头「转让记录」4 个字 12px = 48px + 10px → 64px。
   */
  transfer: 64,
  /**
   * 「发布」单行：发布人 + 发布时间。（2026-09-30 曾试过收 4px，结果线上 31 行的
   * 「邵泽慧 09-29 23:10」被吃掉分钟变成「…23:…」，所以回到 116px —— 正好放得下。）
   */
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
   * 老板 2026-09-29 加「转让」后比原来宽 40px（陪玩端整表 984 → 1024px；
   * 2026-09-30 状态列跟管理端共用、72 → 46px 后是 998px），
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
 * 派单管理下面几张订单列表（订单池流转失败明细 / 管理端直添客户流转明细 / 流转统计）的
 * 「说明」列：退回情况 / 收款情况。老板 2026-09-28：「流转失败列表页很混乱」——
 * 这些表以前是卡片行，一格叠 2~3 行、十几个彩色标签，现在和订单管理一样「一格一行」。
   */
  panelNote: 150,
  /** 上面几张小列表的操作列：按钮只有 2~3 个，比订单管理的窄，钉在右侧不让内容挤掉 */
  panelActions: 178,
} as const;

/**
 * 「管理端直添客户流转明细」（派单管理里的那一页）**特有**的那几列列宽。
 *
 * 老板 2026-09-30：「把客服跟进台账删除，把他的功能合并到管理端直添客户流转明细」——
 * 以前跟进台账是单独一页（CsFollowupPanel，已删除），现在两页合一，这一页 =
 * 订单列（订单 / 状态 / 游戏服务 / 金额打单 / 来源 / 引流账号 / 客户昵称 / 客户账号ID /
 * 客户联系方式 / 备注 / 发布，和订单管理同一份，见 orderColumns.tsx）
 * → 下面前四列 → 收款情况 → 操作。一格一行、超长省略号 + 鼠标悬停看全。
 *
 * 客户信息以前是这一格里自己拼的一列「客户」（320px，编号·微信·昵称·来源·来源账号·账号ID
 * 全挤在一格、用「·」拼），老板 2026-09-30：「管理端直添客户流转明细做的跟订单池流转失败明细
 * +派单工作台一样的标签格式一样…显示的不一样 显得乱七八糟的」—— 现在改成和订单列表一模一样的
 * 五列（来源 50 / 引流账号 116 / 客户昵称 96 / 客户账号ID 88 / 客户联系方式 132 = 482px，
 * 直接用 FIELD_WIDTH 里那几个数，两边不会各写一份慢慢走样）。
 *
 * 宽的一页（合计约 1900px）是有意的：这一页要同时看订单、跟进和收款，横向拉一下就行；
 * 「客服工作微信 / 添加情况 / 最后跟进 / 下次跟进」四列都是定宽，订单那几列不跟着窗口变，
 * 所以上下两页怎么拉表头都对齐。
 */
export const LEDGER_FIELD_WIDTH = {
  workWechat: 108,
  /** 「添加情况」那一列：待添加 / 已添加 / 客户已同意 / 添加失败 / 已派单 */
  stage: 92,
  lastFollow: 240,
  nextFollow: 104,
  /** 「收款情况」那一列（说明列）的宽度：收款状态 + 转入/转出/收款去向/去向/主陪…一小串 */
  receipt: 250,
} as const;

/**
 * 计算 scroll.x：传进去的字段宽度之和，保证表头不会被挤到换行 / 列不会被压扁。
 * 注意：下面这些宽度是「列宽」，单元格左右各留 5px 内边距（见 global.css 的 .data-table），
 * 所以真正放文字的地方是「列宽 − 10px」。
 */
export function sumWidths(keys: Array<keyof typeof FIELD_WIDTH>): number {
  return keys.reduce((total, key) => total + FIELD_WIDTH[key], 0);
}

/**
 * 订单管理表的列（管理端，顺序即表头顺序），scroll.x 直接用它算。
 * 顺序 = constants/orderFields.ts 的字段口径（订单 → 状态 → 游戏 / 服务 → 金额 / 打单 →
 * 来源 / 引流账号 / 客户昵称 / 客户账号ID / 客户联系方式 → 备注 → 主陪 / 副陪 → 发布 → 操作）。
 * 管理端 13 列；合计 66+46+112+74+50+116+96+88+132+84+66+116+254 = **1300px**。
 * 窗口比这宽时多出来的宽度怎么分，见下面的 fitOrderColumnWidths（按 ORDER_COLUMN_FIT_ORDER
 * 先补给客户那五列，不再堆在「退款」右边，也不会把「主陪 / 副陪」撑出一截空白）。 */
export const ORDER_TABLE_KEYS: Array<keyof typeof FIELD_WIDTH> = [
  'orderCode', 'orderStatus', 'game', 'amount',
  'customerSource', 'customerSourceAccount', 'customerNickname', 'customerAccountId', 'customerContact',
  'orderNote', 'studio', 'transfer', 'createdAt', 'orderActions',
];

/**
 * 陪玩端订单管理（接单记录）的列：**和管理端同一份列、同一个标签**，只是把
 * 「来源 / 引流账号 / 客户昵称 / 客户账号ID」四列按 orderFields.ts 的 COMPANION_HIDDEN_FIELDS 去掉
 * （老板 2026-09-29「陪玩端 隐藏 客户小红书信息」；2026-09-30「只是有些数据不展示给陪玩端而已」）——
 * 不再是另写一套「客户微信 / 编号 + 客户账号」。
 * 合计 66+46+112+74+132+84+84+116+214 = **928px**（比改造前还窄 70px，陪玩端更不用横向拖）。
 */
export const ORDER_TABLE_KEYS_COMPANION: Array<keyof typeof FIELD_WIDTH> = [
  'orderCode', 'orderStatus', 'game', 'amount',
  'customerContact', 'orderNote', 'studioCompanion', 'createdAt', 'companionOrderActions',
];

/**
 * 订单管理表的基准宽度之和 —— 也是这张表 scroll.x 的下限
 * （66+46+112+74+50+116+96+88+132+84+66+64+116+254 = 1364px）。
 */
export const ORDER_TABLE_BASE_WIDTH = sumWidths(ORDER_TABLE_KEYS);

/**
 * 各列「内容真正需要的宽度」上限 —— 2026-09-30 用线上 118 单逐格量出来的最长值
 * （量法：把每格内容套进一个 `white-space:nowrap` 的隐藏 div 量文字宽度，再 + 左右各 5px 内边距 + 余量）。
 *
 * 窗口比表格宽出来的部分按 ORDER_COLUMN_FIT_ORDER 补到这些上限就停；补满即「这一列全显示、没有省略号」。
 * 有了这套上限，就不会再出现「某一列被撑出一大截空白、旁边那列还在显示省略号」的情况。
 */
export const ORDER_COLUMN_MAX_WIDTH: Record<string, number> = {
  orderCode: 70, // 基础 66 就够（线上 118 行的「269 · 首单」都不截断），留 4px 余量
  // 这里**故意没有 orderStatus**：状态列永远按基础宽度 46px 走（3 个字 36px + 左右各 5px 内边距），
  // 窗口再宽也不补 —— 老板 2026-09-30「状态 跟游戏之间距离太大了 缩小」，
  // 以前补到 124px 是为了放线上 / 桥接单的「· 待反馈」小字，结果那一格后面空出一大片；
  // 现在小字放不下就省略号，鼠标悬停（title）或打开订单详情能看全。
  game: 126, // 最长 111（「三角洲行动 机密 双」）
  amount: 82, // 最长 63（「¥35 立即打」）
  customerSource: 60, // 最长 46（「小红书」）
  customerSourceAccount: 164, // 最长 157（「总掉萌萌泪 旧 新 鱼鱼鱼🐟」）
  customerNickname: 130, // 最长 123（「绝密航天毁一生 · 219」，含客户编号）
  customerAccountId: 108, // 最长 100（「308798116_Peng」）
  customerContact: 180, // 最长 167（「gqs980190843 · 房间OLJ9896」，微信 + 房间码）
  orderNote: 140, // 备注一行最长 133（线上 118 单实测），够放完整一行
  studio: 116, // 最长 103（陪玩名 + 副陪 + 桥接工作室）
  createdAt: 118, // 基础 116 就够（发布人 +「MM-DD HH:mm」），留 2px 余量
  // 这里**故意没有 transfer**：转让列按基础宽度 64px 固定走（老板 2026-10-03 要「一眼能看到」，
  // 「已转让」三个字只要 44px，宽度必须恒定、不随窗口变，免得窗口一窄它就被省略号吃掉）。
};

/**
 * 补宽顺序（哪一列被截断了就先补谁）。
 *  1. 客户那五列排最前：「客户账号」拆成「一列一个字段」之后它们宽度最紧，先把它们喂饱
 *     （每列补到 ORDER_COLUMN_MAX_WIDTH 就停，不会再出现「一列撑出一大截空白、旁边还在省略号」）；
 *  2. 然后是同样被截断的「主陪 / 副陪」「发布」；
 *  3. 最后才是「游戏 / 服务」「订单」「金额 / 打单」—— 这几列差得少（2~14px），
 *     排在后面就不会出现「它们被撑得空落落、客户那几列还在省略号」的怪现象。
 *  状态列（orderStatus）**不在这个名单里**：它永远按基础宽度 46px 走，不参与补宽（见上面的说明）。
 */
export const ORDER_COLUMN_FIT_ORDER: string[] = [
  'customerSourceAccount',
  'customerContact',
  'customerNickname',
  'customerAccountId',
  'customerSource',
  'orderNote',
  'studio',
  'createdAt',
  'game',
  'orderCode',
  'amount',
];

/**
 * 订单管理表的列宽：按窗口真正能给的宽度算。
 *
 * 老板 2026-09-29：「操作的退款后边不是还有很多空间么？不能让退款靠在最右边？
 * 让前边的客户信息全部显示出来？」以前全是写死的宽度，窗口比表格宽出来的那一段，
 * 浏览器会按列宽比例平摊给**所有**列（操作列也摊），于是那段空间落在了「退款」右边 ——
 * 该宽的客户信息没宽（只能看省略号），操作列却白撑出一大块空白。
 * 老板 2026-09-30 让把「客户账号」拆成五列之后，改成三步：
 *  1. 先把多出来的宽度按 ORDER_COLUMN_FIT_ORDER 补给被截断的列，补到内容需要的宽度就停
 *     （客户那五列排最前，所以窗口一宽，引流账号 / 联系方式 / 昵称 / 账号ID 就先显示全）；
 *  2. 只有**所有**列都补满（窗口远宽于 1532px 时）还有富余，才按列宽比例摊给数据列；
 *  3. 操作列宽度永远不变，按钮靠右对齐 —— 「退款」就贴在表格最右边，后面不留空。
 * 窗口不够宽（可用宽度 < 1216px）时各列维持基准宽度，横向滚动条和以前完全一样。
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
  widths.customerSourceAccount += left;
  return { widths, scrollX };
}

/** 客户管理表的列（管理端 / 客服视角）。 */
export const CUSTOMER_TABLE_KEYS: Array<keyof typeof FIELD_WIDTH> = [
  'customerCode', 'lastOrder', 'sourceTime', 'status',
  'companionWechat', 'followUpSpent', 'notes', 'actionsStaff',
];

/**
 * 派单管理下面三张订单列表的列（订单池流转失败明细 / 跟进列表 / 流转明细）。
 * 和订单管理同一套列宽（同样拆成来源 / 引流账号 / 客户昵称 / 客户账号ID / 客户联系方式五列，
 * 多一个「说明」列、操作列窄一些，并且三张表都用 hideStudio 去掉「主陪 / 副陪」）：
 * 66+46+112+74+50+116+96+88+132+150+116+178 = **1224px**，1320 窗口（可用 991px）会有横向滚动
 * （和订单管理共用同一份列宽，所以这几张表也一起变宽了）。
 * 注意：这三张列表实际用 OrderTable 渲染，scroll.x 是按真实列宽之和算的，这里只是留档。
 */
export const ORDER_PANEL_KEYS: Array<keyof typeof FIELD_WIDTH> = [
  'orderCode', 'orderStatus', 'game', 'amount',
  'customerSource', 'customerSourceAccount', 'customerNickname', 'customerAccountId', 'customerContact',
  'panelNote', 'createdAt', 'panelActions',
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
 * 老板 2026-09-29：「陪玩端 隐藏 客户小红书信息」；老板 2026-10-02：「蠢驴电竞的客服发单，
 * 为什么桥接工作室的黄浩那边没抢单就能显示客户的小红书信息？……除了发单工作室的管理端能看到
 * 其他人一律看不到」。
 *
 * 现在唯一的口径：**只有发单工作室**（这条数据自己的 `studioId`）的客服 / 店长 / 老板能看到；
 * 全站老板（不挂工作室）看全部；接单方（桥接工作室的店长 / 客服、别的店、所有陪玩）一律看不到。
 *
 * 服务端同一条口径在 `apps/server/src/common/order-privacy.ts`（`canSeeCustomerSource` +
 * `stripCustomerSourceForViewer`）—— 那边是把字段**真的摘掉**，这边只是少显示几列，
 * 两边必须一起改，别只改一边。
 */
export const canSeeCustomerSource = (
  item?: { studioId?: string | null } | null,
  user?: { role?: string | null; studioId?: string | null } | null,
): boolean => {
  const role = user?.role;
  if (!role) return false;
  // 陪玩端一律看不到（本店的单也不给看）
  if (role === 'COMPANION') return false;
  // 全站老板（不挂工作室）看全部
  if (role === 'OWNER' && !user?.studioId) return true;
  // 其余：只有发单工作室的人能看（拿不到归属 → 从严不给看）
  return !!item?.studioId && item.studioId === user?.studioId;
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
