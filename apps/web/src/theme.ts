// 蠢驴电竞 — 浅色简约风
import type { ThemeConfig } from 'antd';

export const chunlvTheme: ThemeConfig = {
  hashed: false,
  token: {
    // 色彩 — 经典蓝主色调
    colorPrimary: '#2563EB',
    colorSuccess: '#16A34A',
    colorWarning: '#F59E0B',
    colorError: '#EF4444',
    colorInfo: '#2563EB',
    colorTextBase: '#1E293B',
    colorBgBase: '#F8FAFC',
    colorBgContainer: '#FFFFFF',
    colorBgElevated: '#FFFFFF',
    colorBorder: '#E2E8F0',
    colorBorderSecondary: '#F1F5F9',
    colorLink: '#2563EB',

    // 排版
    fontFamily:
      "'Inter', 'PingFang SC', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
    fontSize: 14,
    fontSizeLG: 16,
    fontSizeSM: 12,
    borderRadius: 8,
    borderRadiusLG: 8,
    borderRadiusSM: 6,
    borderRadiusXS: 4,

    // 控件
    controlHeight: 36,
    controlHeightLG: 44,
    controlHeightSM: 30,
    lineHeight: 1.6,

    // 阴影 — 干净轻阴影
    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
    boxShadowSecondary: '0 2px 8px rgba(0,0,0,0.06)',
    boxShadowTertiary: '0 4px 16px rgba(0,0,0,0.08)',
  },

  components: {
    Layout: {
      bodyBg: '#F8FAFC',
      headerBg: '#FFFFFF',
      siderBg: '#FFFFFF',
      triggerBg: '#FFFFFF',
    },
    Menu: {
      itemBg: 'transparent',
      itemSelectedBg: '#EFF6FF',
      itemSelectedColor: '#2563EB',
      itemHoverBg: '#F8FAFC',
      itemBorderRadius: 8,
      itemMarginInline: 8,
      itemHeight: 40,
      darkItemBg: 'transparent',
      darkItemSelectedBg: '#EFF6FF',
      darkItemSelectedColor: '#2563EB',
      darkItemHoverBg: '#F8FAFC',
      darkItemColor: '#475569',
    },
    Card: {
      colorBgContainer: '#FFFFFF',
      paddingLG: 20,
      borderRadiusLG: 8,
    },
    Table: {
      colorBgContainer: '#FFFFFF',
      headerBg: '#F8FAFC',
      headerColor: '#64748B',
      rowHoverBg: '#EFF6FF',
      borderColor: '#E2E8F0',
      headerBorderRadius: 8,
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
      defaultHoverBorderColor: '#2563EB',
      defaultHoverColor: '#2563EB',
      fontWeight: 600,
    },
    Input: {
      colorBgContainer: '#FFFFFF',
      colorBorder: '#E2E8F0',
      colorTextPlaceholder: '#94A3B8',
      activeBorderColor: '#2563EB',
      borderRadius: 8,
      paddingBlock: 8,
      paddingInline: 14,
    },
    Select: {
      colorBgContainer: '#FFFFFF',
      colorBgElevated: '#FFFFFF',
      optionSelectedBg: '#EFF6FF',
      borderRadius: 8,
    },
    Modal: {
      colorBgElevated: '#FFFFFF',
      headerBg: '#FFFFFF',
      borderRadiusLG: 12,
    },
    Tabs: {
      colorBgContainer: 'transparent',
      itemSelectedColor: '#2563EB',
      inkBarColor: '#2563EB',
      itemHoverColor: '#2563EB',
    },
    Tag: { borderRadiusSM: 6, lineHeight: 1.6 },
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
      linkColor: '#2563EB',
    },
  },
};
