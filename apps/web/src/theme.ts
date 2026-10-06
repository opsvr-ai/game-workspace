// 蠢驴电竞 — 浅色简约风
//
// 这个文件只做「令牌 → Ant Design」的映射，**不要在这里写死色值**。
// 改品牌色 / 圆角 / 字号 / 阴影，请改 `styles/tokens.ts`（唯一真源）。
import type { ThemeConfig } from 'antd';
import {
  BG,
  BORDER,
  BRAND,
  FONT,
  OVERLAY,
  RADIUS,
  SEMANTIC,
  SHADOW,
  SPACE,
  TEXT,
} from './styles/tokens';

export const chunlvTheme: ThemeConfig = {
  hashed: false,
  token: {
    // 色彩 — 品牌紫主色调（全套界面唯一主色）
    colorPrimary: BRAND.primary,
    colorSuccess: SEMANTIC.success,
    colorWarning: SEMANTIC.warning,
    colorError: SEMANTIC.danger,
    colorInfo: BRAND.primary,
    colorTextBase: TEXT.primary,
    colorBgBase: BG.base,
    colorBgContainer: BG.container,
    colorBgElevated: BG.container,
    colorBorder: BORDER.base,
    colorBorderSecondary: BORDER.secondary,
    colorLink: BRAND.primary,

    // 排版
    fontFamily: FONT.family,
    fontSize: FONT.size,
    fontSizeLG: FONT.sizeLG,
    fontSizeSM: FONT.sizeSM,
    borderRadius: RADIUS.md,
    borderRadiusLG: RADIUS.lg,
    borderRadiusSM: RADIUS.sm,
    borderRadiusXS: RADIUS.xs,

    // 控件
    controlHeight: 36,
    controlHeightLG: 44,
    controlHeightSM: 30,
    lineHeight: FONT.lineHeight,

    // 阴影 — 干净轻阴影
    boxShadow: SHADOW.xs,
    boxShadowSecondary: SHADOW.sm,
    boxShadowTertiary: SHADOW.md,
  },

  components: {
    Layout: {
      // 底色交给 .app-shell 的淡紫 / 淡青晕染（见 styles/global.css），这里只兜底
      bodyBg: BG.content,
      headerBg: BG.container,
      siderBg: BG.sider,
      triggerBg: BG.sider,
    },
    Menu: {
      itemBg: 'transparent',
      subMenuItemBg: 'transparent',
      itemSelectedBg: BRAND.soft,
      itemSelectedColor: BRAND.primary,
      itemHoverBg: BG.hover,
      itemBorderRadius: RADIUS.sm,
      itemMarginInline: RADIUS.sm,
      itemHeight: 40,
      darkItemBg: BG.sider,
      darkSubMenuItemBg: BG.sider,
      darkPopupBg: BG.sider,
      darkItemSelectedBg: BRAND.accentSoft,
      darkItemSelectedColor: BRAND.accent,
      darkItemHoverBg: OVERLAY.hoverOnDark,
      darkItemColor: TEXT.onDarkMuted,
    },
    Card: {
      colorBgContainer: BG.container,
      headerBg: BG.container,
      headerFontSize: 15,
      paddingLG: SPACE.xl,
      borderRadiusLG: RADIUS.xl,
      // 卡片标题左侧的品牌竖条在 global.css 里画（.ant-card-head-title::before）
    },
    Table: {
      colorBgContainer: BG.container,
      headerBg: BG.base,
      headerColor: TEXT.heading,
      headerSplitColor: BORDER.base,
      rowHoverBg: BRAND.softWash,
      rowSelectedBg: BRAND.soft,
      rowSelectedHoverBg: BRAND.softHover,
      borderColor: BORDER.light,
      headerBorderRadius: RADIUS.md,
    },
    Button: {
      borderRadius: RADIUS.sm,
      borderRadiusLG: RADIUS.md,
      borderRadiusSM: RADIUS.xs,
      primaryShadow: SHADOW.primary,
      defaultBg: BG.container,
      defaultBorderColor: BORDER.base,
      defaultColor: TEXT.primary,
      defaultHoverBg: BG.hover,
      defaultHoverBorderColor: BRAND.primary,
      defaultHoverColor: BRAND.primary,
      fontWeight: 600,
    },
    Input: {
      colorBgContainer: BG.container,
      colorBorder: BORDER.base,
      colorTextPlaceholder: TEXT.tertiary,
      activeBorderColor: BRAND.primary,
      borderRadius: RADIUS.sm,
      paddingBlock: SPACE.sm,
      paddingInline: 14,
    },
    Select: {
      colorBgContainer: BG.container,
      colorBgElevated: BG.container,
      optionSelectedBg: BRAND.soft,
      borderRadius: RADIUS.sm,
    },
    Modal: {
      colorBgElevated: BG.container,
      headerBg: BG.container,
      borderRadiusLG: RADIUS.lg,
    },
    Tabs: {
      colorBgContainer: 'transparent',
      itemSelectedColor: BRAND.primary,
      inkBarColor: BRAND.primary,
      itemHoverColor: BRAND.primary,
    },
    Tag: { borderRadiusSM: RADIUS.pill, lineHeight: FONT.lineHeight },
    Progress: { defaultColor: BRAND.primary, remainingColor: BORDER.track },
    Descriptions: { labelBg: BG.base, titleMarginBottom: SPACE.md },
    Tooltip: { colorBgSpotlight: OVERLAY.tooltip, borderRadius: RADIUS.sm },
    Pagination: { itemActiveBg: BRAND.soft, borderRadius: RADIUS.sm },
    Divider: { colorSplit: BORDER.light },
    Popover: { borderRadiusLG: RADIUS.xl },
    Drawer: { borderRadiusLG: RADIUS.xl },
    Statistic: { colorTextDescription: TEXT.secondary },
    Badge: { colorText: TEXT.inverse },
    Segmented: {
      itemSelectedBg: BG.container,
      itemSelectedColor: TEXT.primary,
      trackBg: BORDER.secondary,
    },
    Breadcrumb: {
      colorText: TEXT.tertiary,
      lastItemColor: TEXT.primary,
      linkColor: BRAND.primary,
    },
  },
};
