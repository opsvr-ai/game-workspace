/**
 * 蠢驴电竞 — UI 设计令牌（唯一真源）
 *
 * 规矩（配合 docs/REFACTOR-PLAN.md 第 15.3 节）：
 *  1. 页面 / 组件不要再写十六进制色值 —— 一律从这里取，或读 CSS 变量 var(--color-*)；
 *  2. 需要改品牌色 / 圆角 / 间距 / 字号时，只改这一个文件；
 *  3. theme.ts（Ant Design）与 index.css 的 :root 兜底值都以本文件为准；
 *  4. 语义色（等级 / 结果 / 状态）单独成组，不许为了「好看」把它们合并成一个颜色 ——
 *     颜色在这里代表含义，不是装饰。
 */

/** 品牌主色（紫）—— 全套界面唯一主色。 */
export const BRAND = {
  /** 主色 · 紫（主按钮、链接、选中态） */
  primary: '#7C4DFF',
  /** 主色悬浮 */
  primaryHover: '#8B62FF',
  /** 主色按下 */
  primaryActive: '#6A3DF0',
  /** 品牌渐变里的第二个色（偏蓝，跟主色组成 135° 渐变） */
  primaryBlue: '#5B7CFA',
  /** 强调青（发光条 / 侧栏选中条） */
  accent: '#00E5FF',
  /** 深色侧栏 / 顶栏底色 */
  sider: '#0B1024',
  /** 淡紫底（选中行 / 标签） */
  soft: '#F3EEFF',
  /** 淡紫底 · 悬浮 / 更深一档 */
  softHover: '#EEE9FF',
  /** 淡紫底 · 极淡（表格行悬浮） */
  softWash: '#F8F6FF',
  /** 强调青 · 低透明（深色侧栏选中底） */
  accentSoft: 'rgba(0,229,255,0.12)',
  /** 品牌深紫 —— 顶栏渐变的中段（比 sider 亮、比主色暗） */
  deep: '#1B1246',
} as const;

/** 中性文本色（从深到浅）。 */
export const TEXT = {
  /** 正文 / 标题 */
  primary: '#1E293B',
  /** 次要说明 */
  secondary: '#64748B',
  /** 占位 / 弱提示 */
  tertiary: '#94A3B8',
  disabled: '#CBD5E1',
  /** 深色底上的文字 */
  inverse: '#FFFFFF',
  /** 表头 / 小标题 */
  heading: '#475569',
  /** 深色底上的正文 */
  onDark: '#EAF2FF',
  /** 深色底上的次要文字 */
  onDarkMuted: '#A9B7D9',
  /** 深色底上的弱文字（侧栏二级菜单标题） */
  onDarkSoft: '#C3CEE8',
} as const;

/** 背景色。 */
export const BG = {
  /** 页面底 */
  base: '#F8FAFC',
  /** 卡片 / 弹窗 */
  container: '#FFFFFF',
  /** 悬浮 / 斑马纹 */
  hover: '#F8FAFC',
  /** 深色侧栏 */
  sider: BRAND.sider,
  /** 内容区（管理端外壳） */
  content: '#F4F6FD',
  /** 深色浮层底（语音通话条那种黑底） */
  inverse: '#1E293B',
  /** 深色浮层底 · 更深一档（渐变用） */
  inverseDeep: '#0F172A',
  /** 报错提示条的底（浅红） */
  error: '#FEF2F2',
  /** 登录页 / 无晕染时的兜底页底 */
  page: '#F5F7FB',
  /** 卡中卡（内层卡 / 内嵌块）底色 */
  containerSoft: '#FCFDFF',
  /** 很淡的品牌蓝底（陪玩卡 / 客户卡「正在服务」「选中」那一层底） */
  brandSoft: '#F0F7FF',
} as const;

/** 描边色。 */
export const BORDER = {
  base: '#E2E8F0',
  secondary: '#F1F5F9',
  light: '#EDF1F7',
  /** 轨道 / 进度槽 */
  track: '#EEF2F8',
  /** 细描边（卡片 / 面板 / 内层卡） */
  hairline: '#EEF2F8',
  /** 卡片悬浮描边 */
  hover: '#E3E8F5',
  /** 内容区外壳描边 */
  content: '#EAEFF8',
  /** 表格行分隔线 */
  row: '#F4F7FB',
} as const;

/** 语义色 —— 代表含义，不要随意替换。 */
export const SEMANTIC = {
  success: '#16A34A',
  warning: '#F59E0B',
  danger: '#EF4444',
  info: BRAND.primary,
  /** 在线（绿点 + 光环） */
  online: '#00E676',
  /** 在线光环起始（pulse-glow 用） */
  onlineRing: 'rgba(0,230,118,0.35)',
  /** 在线光环消散（同上、0 透明收尾） */
  onlineRingFade: 'rgba(0,230,118,0)',
  /** 忙碌（橙点） */
  busy: '#FF9100',
  /** 浅底上的「深琥珀」文字（备注 / 转让提示那种）—— 亮橙当文字看不清，所以单独留一档 */
  warningDeep: '#B45309',
  /** 浅底上的深红文字（报错标题那种） */
  dangerDeep: '#CF1322',
  /** 直派单标记（紫罗兰 —— 刻意跟品牌紫 `#7C4DFF` 分开，免得看着像选中态） */
  direct: '#7C3AED',
  /* ── 状态标签的「淡底 + 同色描边」那一套（以前每个页面各写各的十六进制） ── */
  successSoft: '#F0FDF4',
  successBorder: '#BBF7D0',
  warningSoft: '#FFF7E6',
  dangerSoft: '#FFF2F0',
  dangerBorder: '#FFCCC7',
  infoSoft: '#EEF2FF',
  infoBorder: '#C7D2FE',
  directSoft: '#F5F3FF',
  directBorder: '#DDD6FE',
  /* ── 同一含义的「深浅档」（用途不同、别混用；判断标准是「当字用 / 当点用 / 当底用」） ── */
  /** 深绿字（浅底上的正数金额 / 已完成） */
  successDeep: '#15803D',
  /** 亮绿（统计数字 / KPI，比状态绿 #16A34A 亮） */
  successBright: '#10B981',
  /** 中间红（状态点 / 徽标，比 danger 深、比 dangerStrong 浅） */
  dangerMid: '#DC2626',
  /** 深红字（负数金额 / 严重告警） */
  dangerStrong: '#B91C1C',
  /** 红描边（卡片 / 头像圈「正在服务」） */
  dangerEdge: '#FCA5A5',
  /** 更浅的红描边（卡片描边） */
  dangerEdgeSoft: '#FECACA',
  /** 深琥珀（冠军名次 / 待办数字，比 warning 深、当字用） */
  warningStrong: '#D97706',
  /** 深橙（休息状态） */
  orangeDeeper: '#C2410C',
  /** orange-50 底（统计卡） */
  orangeSoft: '#FFF7ED',
  /** 亮蓝（信息类数字） */
  infoBright: '#3B82F6',
  /** 深蓝（统计卡字） */
  infoDeep: '#1D4ED8',
  /** blue-50 底（统计卡） */
  infoSoftBlue: '#EFF6FF',
  /** teal（「陪玩数」那种青绿） */
  teal: '#0F766E',
  /** teal-50 底 */
  tealSoft: '#F0FDFA',
  /** 空闲待派（黄点：客服端「这个人现在能派单」的状态球） */
  idle: '#FFD600',
} as const;

/**
 * 数字角标的一圈同色光晕。
 * 以前这串 `0 0 10px #FF4757` 在 AppLayout 里手写了 9 遍，还有橙色的 3 遍；
 * 现在颜色从 SEMANTIC 取，改一处全站跟着变。
 */
export function badgeGlow(color: string): string {
  return `0 0 10px ${color}`;
}

/** 滚动条。 */
export const SCROLLBAR = {
  /** 全站默认那条（偏青） */
  accent: 'rgba(0,212,255,0.3)',
  /** 内容区 / 侧栏的滑块 */
  thumb: '#D7DFEC',
  /** 滑块悬浮 */
  thumbHover: '#B9C6DA',
} as const;

/**
 * 段位（「马级」）配色 —— 金 / 银 / 铜。
 *
 * 2026-10-07 之前这份色值在 4 个文件里各写了一遍，而且互相打架：
 * 「中等马」在陪玩首页、工作总览是**蓝色**，在段位徽章、评分规则里是**银灰**；
 * 「下等马」一边灰、一边铜 —— 同一匹马换个页面就换一种颜色。
 * 现在统一成金 / 银 / 铜（跟「上等马戴冠金」和徽章的注释一致），以后只改这里。
 */
export const TIER_TINT = {
  top: '#D4A017',
  middle: '#A9A9A9',
  low: '#CD7F32',
} as const;

/** 渐变（品牌外观）。 */

/**
 * 左侧栏一级菜单的「模块配色」。
 * 按菜单 key 的后半段取色（owner-home / admin-finance / cs-orders … 都命中同一张表），
 * 所以加新菜单不用再维护第二份颜色；页面里不要再各写一套。
 * （2026-10-07 从 layouts/AppLayout.tsx 搬进来，色值一个没动。）
 */
export const MODULE_TINTS: Record<string, string> = {
  home: '#7C4DFF',
  dispatch: '#00B8D9',
  orders: '#3B82F6',
  customers: '#8B5CF6',
  employees: '#F59E0B',
  finance: '#10B981',
  shop: '#EC4899',
  settings: '#7C8DA6',
  'battle-screenshots': '#F97316',
};

/**
 * 四个角色的「身份色」（文字 / 头像圈 / 标签）。
 * 2026-10-07 从 dispatch/CSDispatchView.tsx 的 ROLE_TEXT_COLOR 搬进来 —— 之前这份值
 * 藏在客服端一个视图文件里，别的地方要用只能再抄一遍。
 * 注意它跟 MODULE_TINTS 不是一回事：那个按「菜单模块」上色，这个按「人是谁」上色。
 */
export const ROLE_TINT: Record<string, string> = {
  COMPANION: '#2563EB',
  CS: '#0891B2',
  ADMIN: '#EA580C',
  OWNER: '#7C3AED',
};

export const GRADIENTS = {
  /** 主按钮 / 品牌块 */
  brand: `linear-gradient(135deg, ${BRAND.primary} 0%, ${BRAND.primaryBlue} 100%)`,
  brandHover: `linear-gradient(135deg, ${BRAND.primaryHover} 0%, #6D8BFF 100%)`,
  brandActive: `linear-gradient(135deg, ${BRAND.primaryActive} 0%, #4A6BF0 100%)`,
  /** 顶栏左右渐变 */
  header: `linear-gradient(90deg, ${BRAND.sider} 0%, ${BRAND.deep} 55%, ${BRAND.sider} 100%)`,
  /** 卡片标题 / 统计卡左侧的品牌竖条 */
  accentBar: `linear-gradient(180deg, ${BRAND.accent}, ${BRAND.primary})`,
  /** 侧栏选中项底 */
  siderSelected: 'linear-gradient(90deg, rgba(124,77,255,0.42), rgba(0,229,255,0.14))',
  /** 页面兜底底色（body，一层很淡的三段白） */
  pageBody: 'linear-gradient(160deg, #F5F7FF 0%, #FAF8FF 45%, #F5F7FB 100%)',
  /** 管理端外壳底（.app-shell 上面还叠两层品牌色晕染） */
  shell: 'linear-gradient(180deg, #F4F6FD 0%, #EEF1F9 100%)',
  /** 登录页底 */
  login: 'linear-gradient(180deg, #F7F5FF 0%, #F2F4FB 100%)',
  /**
   * 页面标题（**浅色内容区**专用）。
   * 深色顶栏那套「青 → 紫 → 品红」是给深色底用的霓虹色：青 #00E5FF 在**白底**上对比度只有 1.5:1，
   * 标题第一个字基本糊在背景里（20px 粗体至少要 3:1、普通文字要 4.5:1）。这一档换成紫 → 品红：
   * #6D28D9 → #7C4DFF → #DB2777，对白底分别是 7.1 : 4.8 : 4.6，最差也有 4.5:1 以上，
   * 仍然在品牌色系里（跟主按钮、左栏选中项同一个紫）。
   */
  titleText: 'linear-gradient(90deg, #6D28D9 0%, #7C4DFF 50%, #DB2777 100%)',
} as const;

/** 间距（px）。 */
export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 } as const;

/** 圆角（px）。 */
export const RADIUS = { xs: 6, sm: 8, md: 10, lg: 12, xl: 14, pill: 999 } as const;

/** 字体。 */
export const FONT = {
  family:
    "'Inter', 'PingFang SC', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
  size: 14,
  sizeLG: 16,
  sizeSM: 12,
  lineHeight: 1.6,
} as const;

/** 阴影（干净轻阴影）。 */
export const SHADOW = {
  xs: '0 1px 3px rgba(15,23,42,0.06)',
  sm: '0 6px 16px rgba(15,23,42,0.08)',
  md: '0 12px 32px rgba(15,23,42,0.12)',
  /** 主按钮投影（品牌紫） */
  primary: '0 1px 3px rgba(124,77,255,0.25)',
} as const;

/** 半透明遮罩 / 深色底上的交互层。 */
export const OVERLAY = {
  /** Tooltip 底 */
  tooltip: 'rgba(15,23,42,0.92)',
  /** 深色底悬浮 */
  hoverOnDark: 'rgba(255,255,255,0.06)',
} as const;

/**
 * 令牌 → CSS 变量映射。
 * 语义：TS 侧（theme.ts / 组件）用上面的常量；CSS 侧读 var(--...)。
 */
export const CSS_VARS: Record<string, string> = {
  // 品牌
  '--color-brand': BRAND.primary,
  '--color-brand-hover': BRAND.primaryHover,
  '--color-brand-active': BRAND.primaryActive,
  '--color-brand-blue': BRAND.primaryBlue,
  '--color-brand-soft': BRAND.soft,
  '--color-brand-soft-hover': BRAND.softHover,
  '--color-brand-soft-wash': BRAND.softWash,
  '--color-brand-deep': BRAND.deep,
  '--color-accent-soft': BRAND.accentSoft,
  '--color-accent': BRAND.accent,
  // 兼容旧变量名（历史代码里在用）
  '--color-primary': BRAND.primary,
  '--color-primary-light': BRAND.primaryHover,
  '--color-gradient-brand': GRADIENTS.brand,
  '--color-gradient-brand-hover': GRADIENTS.brandHover,
  // 语义
  '--color-success': SEMANTIC.success,
  '--color-warning': SEMANTIC.warning,
  '--color-error': SEMANTIC.danger,
  '--color-danger': SEMANTIC.danger,
  '--color-info': SEMANTIC.info,
  '--color-online': SEMANTIC.online,
  '--color-online-ring': SEMANTIC.onlineRing,
  '--color-online-ring-fade': SEMANTIC.onlineRingFade,
  '--color-busy': SEMANTIC.busy,
  '--color-tier-top': TIER_TINT.top,
  '--color-success-soft': SEMANTIC.successSoft,
  '--color-success-border': SEMANTIC.successBorder,
  '--color-warning-soft': SEMANTIC.warningSoft,
  '--color-warning-deep': SEMANTIC.warningDeep,
  '--color-danger-soft': SEMANTIC.dangerSoft,
  '--color-danger-border': SEMANTIC.dangerBorder,
  '--color-danger-deep': SEMANTIC.dangerDeep,
  '--color-danger-mid': SEMANTIC.dangerMid,
  '--color-info-soft': SEMANTIC.infoSoft,
  '--color-info-border': SEMANTIC.infoBorder,
  '--color-direct': SEMANTIC.direct,
  '--color-direct-soft': SEMANTIC.directSoft,
  '--color-direct-border': SEMANTIC.directBorder,
  '--color-tier-middle': TIER_TINT.middle,
  '--color-tier-low': TIER_TINT.low,
  // 文本
  '--color-text': TEXT.primary,
  '--color-text-primary': TEXT.primary,
  '--color-text-secondary': TEXT.secondary,
  '--color-text-heading': TEXT.heading,
  '--color-text-tertiary': TEXT.tertiary,
  '--color-text-disabled': TEXT.disabled,
  '--color-text-inverse': TEXT.inverse,
  '--color-text-on-dark': TEXT.onDark,
  '--color-text-on-dark-soft': TEXT.onDarkSoft,
  // 背景
  '--color-bg-base': BG.base,
  '--color-bg-container': BG.container,
  '--color-bg-hover': BG.hover,
  '--color-bg-sider': BG.sider,
  '--color-bg-error': BG.error,
  '--color-bg-inverse': BG.inverse,
  '--color-bg-page': BG.page,
  '--color-bg-container-soft': BG.containerSoft,
  '--color-bg-brand-soft': BG.brandSoft,
  // 描边
  '--color-border': BORDER.base,
  '--color-border-secondary': BORDER.secondary,
  '--color-border-track': BORDER.track,
  '--color-border-hairline': BORDER.hairline,
  '--color-border-hover': BORDER.hover,
  '--color-border-content': BORDER.content,
  '--color-border-row': BORDER.row,
  '--color-scrollbar-accent': SCROLLBAR.accent,
  '--color-scrollbar-thumb': SCROLLBAR.thumb,
  '--color-scrollbar-thumb-hover': SCROLLBAR.thumbHover,
  // 渐变
  '--grad-brand': GRADIENTS.brand,
  '--grad-brand-hover': GRADIENTS.brandHover,
  '--grad-brand-active': GRADIENTS.brandActive,
  '--grad-accent-bar': GRADIENTS.accentBar,
  '--grad-sider-selected': GRADIENTS.siderSelected,
  '--grad-header': GRADIENTS.header,
  '--grad-page-body': GRADIENTS.pageBody,
  '--grad-shell': GRADIENTS.shell,
  '--grad-login': GRADIENTS.login,
  // 圆角
  '--radius-xs': `${RADIUS.xs}px`,
  '--radius-sm': `${RADIUS.sm}px`,
  '--radius-md': `${RADIUS.md}px`,
  '--radius-lg': `${RADIUS.lg}px`,
  '--radius-xl': `${RADIUS.xl}px`,
  '--radius-pill': `${RADIUS.pill}px`,
  // 间距
  '--space-xs': `${SPACE.xs}px`,
  '--space-sm': `${SPACE.sm}px`,
  '--space-md': `${SPACE.md}px`,
  '--space-lg': `${SPACE.lg}px`,
  '--space-xl': `${SPACE.xl}px`,
  '--space-xxl': `${SPACE.xxl}px`,
  // 字号
  '--font-size': `${FONT.size}px`,
  '--font-size-lg': `${FONT.sizeLG}px`,
  '--font-size-sm': `${FONT.sizeSM}px`,
  // 阴影
  '--shadow-xs': SHADOW.xs,
  '--shadow-sm': SHADOW.sm,
  '--shadow-md': SHADOW.md,
};

/**
 * 把令牌写进 :root 的 CSS 变量。
 * 在 main.tsx 启动时调用一次 —— 这样运行时的变量与 tokens.ts 永远一致
 * （即使 index.css 里的首屏兜底值被人改歪了，也会被这里覆盖回正）。
 */
export function applyTokenCssVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  for (const [name, value] of Object.entries(CSS_VARS)) {
    root.setProperty(name, value);
  }
}
