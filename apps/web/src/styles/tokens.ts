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
} as const;

/** 描边色。 */
export const BORDER = {
  base: '#E2E8F0',
  secondary: '#F1F5F9',
  light: '#EDF1F7',
  /** 轨道 / 进度槽 */
  track: '#EEF2F8',
} as const;

/** 语义色 —— 代表含义，不要随意替换。 */
export const SEMANTIC = {
  success: '#16A34A',
  warning: '#F59E0B',
  danger: '#EF4444',
  info: BRAND.primary,
} as const;

/** 渐变（品牌外观）。 */
export const GRADIENTS = {
  /** 主按钮 / 品牌块 */
  brand: `linear-gradient(135deg, ${BRAND.primary} 0%, ${BRAND.primaryBlue} 100%)`,
  brandHover: `linear-gradient(135deg, ${BRAND.primaryHover} 0%, #6D8BFF 100%)`,
  brandActive: `linear-gradient(135deg, ${BRAND.primaryActive} 0%, #4A6BF0 100%)`,
  /** 顶栏左右渐变 */
  header: 'linear-gradient(90deg, #0B1024 0%, #1B1246 55%, #0B1024 100%)',
  /** 卡片标题 / 统计卡左侧的品牌竖条 */
  accentBar: `linear-gradient(180deg, ${BRAND.accent}, ${BRAND.primary})`,
  /** 侧栏选中项底 */
  siderSelected: 'linear-gradient(90deg, rgba(124,77,255,0.42), rgba(0,229,255,0.14))',
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
  // 文本
  '--color-text': TEXT.primary,
  '--color-text-primary': TEXT.primary,
  '--color-text-secondary': TEXT.secondary,
  '--color-text-heading': TEXT.heading,
  '--color-text-tertiary': TEXT.tertiary,
  '--color-text-disabled': TEXT.disabled,
  // 背景
  '--color-bg-base': BG.base,
  '--color-bg-container': BG.container,
  '--color-bg-hover': BG.hover,
  '--color-bg-sider': BG.sider,
  '--color-bg-error': '#FEF2F2',
  '--color-bg-inverse': BG.inverse,
  // 描边
  '--color-border': BORDER.base,
  '--color-border-secondary': BORDER.secondary,
  '--color-border-track': BORDER.track,
  // 渐变
  '--grad-brand': GRADIENTS.brand,
  '--grad-accent-bar': GRADIENTS.accentBar,
  '--grad-sider-selected': GRADIENTS.siderSelected,
  '--grad-header': GRADIENTS.header,
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
