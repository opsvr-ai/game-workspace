// 蠢驴电竞 — 浅色简约风
import type { ThemeConfig } from 'antd';

export const chunlvTheme: ThemeConfig = {
  hashed: false,
  token: {
    // 色彩 — 经典蓝主色调
    colorPrimary: '#7C4DFF',
    colorSuccess: '#16A34A',
    colorWarning: '#F59E0B',
    colorError: '#EF4444',
    colorInfo: '#7C4DFF',
    colorTextBase: '#1E293B',
    colorBgBase: '#F8FAFC',
    colorBgContainer: '#FFFFFF',
    colorBgElevated: '#FFFFFF',
    colorBorder: '#E2E8F0',
    colorBorderSecondary: '#F1F5F9',
    colorLink: '#7C4DFF',

    // 排版
    fontFamily:
      "'Inter', 'PingFang SC', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
    fontSize: 14,
    fontSizeLG: 16,
    fontSizeSM: 12,
    borderRadius: 10,
    borderRadiusLG: 12,
    borderRadiusSM: 8,
    borderRadiusXS: 6,

    // 控件
    controlHeight: 36,
    controlHeightLG: 44,
    controlHeightSM: 30,
    lineHeight: 1.6,

    // 阴影 — 干净轻阴影
    boxShadow: '0 1px 3px rgba(15,23,42,0.06)',
    boxShadowSecondary: '0 6px 16px rgba(15,23,42,0.08)',
    boxShadowTertiary: '0 12px 32px rgba(15,23,42,0.12)',
  },

  components: {
    Layout: {
      // 底色交给 .app-shell 的淡紫 / 淡青晕染（见 styles/global.css），这里只兜底
      bodyBg: '#F4F6FD',
      headerBg: '#FFFFFF',
      siderBg: '#0B1024',
      triggerBg: '#0B1024',
    },
    Menu: {
      itemBg: 'transparent',
      subMenuItemBg: 'transparent',
      itemSelectedBg: '#F3EEFF',
      itemSelectedColor: '#7C4DFF',
      itemHoverBg: '#F8FAFC',
      itemBorderRadius: 8,
      itemMarginInline: 8,
      itemHeight: 40,
      darkItemBg: '#0B1024',
      darkSubMenuItemBg: '#0B1024',
      darkPopupBg: '#0B1024',
      darkItemSelectedBg: 'rgba(0,229,255,0.12)',
      darkItemSelectedColor: '#00E5FF',
      darkItemHoverBg: 'rgba(255,255,255,0.06)',
      darkItemColor: '#A9B7D9',
    },
    Card: {
      colorBgContainer: '#FFFFFF',
      headerBg: '#FFFFFF',
      headerFontSize: 15,
      paddingLG: 20,
      borderRadiusLG: 14,
      // 卡片标题左侧的品牌竖条在 global.css 里画（.ant-card-head-title::before）
    },
    Table: {
      colorBgContainer: '#FFFFFF',
      headerBg: '#F8FAFC',
      headerColor: '#475569',
      headerSplitColor: '#E2E8F0',
      rowHoverBg: '#F8F6FF',
      rowSelectedBg: '#F3EEFF',
      rowSelectedHoverBg: '#EEE9FF',
      borderColor: '#EDF1F7',
      headerBorderRadius: 10,
    },
    Button: {
      borderRadius: 8,
      borderRadiusLG: 10,
      borderRadiusSM: 6,
      primaryShadow: '0 1px 3px rgba(37,99,235,0.2)',
      defaultBg: '#FFFFFF',
      defaultBorderColor: '#E2E8F0',
      defaultColor: '#1E293B',
      defaultHoverBg: '#F8FAFC',
      defaultHoverBorderColor: '#7C4DFF',
      defaultHoverColor: '#7C4DFF',
      fontWeight: 600,
    },
    Input: {
      colorBgContainer: '#FFFFFF',
      colorBorder: '#E2E8F0',
      colorTextPlaceholder: '#94A3B8',
      activeBorderColor: '#7C4DFF',
      borderRadius: 8,
      paddingBlock: 8,
      paddingInline: 14,
    },
    Select: {
      colorBgContainer: '#FFFFFF',
      colorBgElevated: '#FFFFFF',
      optionSelectedBg: '#F3EEFF',
      borderRadius: 8,
    },
    Modal: {
      colorBgElevated: '#FFFFFF',
      headerBg: '#FFFFFF',
      borderRadiusLG: 12,
    },
    Tabs: {
      colorBgContainer: 'transparent',
      itemSelectedColor: '#7C4DFF',
      inkBarColor: '#7C4DFF',
      itemHoverColor: '#7C4DFF',
    },
    Tag: { borderRadiusSM: 999, lineHeight: 1.6 },
    Progress: { defaultColor: '#7C4DFF', remainingColor: '#EEF2F8' },
    Descriptions: { labelBg: '#F8FAFC', titleMarginBottom: 12 },
    Tooltip: { colorBgSpotlight: 'rgba(15,23,42,0.92)', borderRadius: 8 },
    Pagination: { itemActiveBg: '#F3EEFF', borderRadius: 8 },
    Divider: { colorSplit: '#EDF1F7' },
    Popover: { borderRadiusLG: 14 },
    Drawer: { borderRadiusLG: 14 },
    Statistic: { colorTextDescription: '#64748B' },
    Badge: { colorText: '#FFFFFF' },
    Segmented: {
      itemSelectedBg: '#FFFFFF',
      itemSelectedColor: '#1E293B',
      trackBg: '#F1F5F9',
    },
    Breadcrumb: {
      colorText: '#94A3B8',
      lastItemColor: '#1E293B',
      linkColor: '#7C4DFF',
    },
  },
};
