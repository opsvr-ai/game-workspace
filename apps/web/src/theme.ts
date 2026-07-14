// 蠢驴电竞 — 电竞赛博光感风（浅色主题）
import type { ThemeConfig } from 'antd';

export const chunlvTheme: ThemeConfig = {
  token: {
    // 色彩 — 赛博青主色调
    colorPrimary: '#00D4FF',
    colorSuccess: '#00E676',
    colorWarning: '#FF9100',
    colorError: '#FF4757',
    colorInfo: '#00D4FF',
    colorTextBase: '#1E293B',
    colorBgBase: '#F8FAFC',
    colorBgContainer: '#FFFFFF',
    colorBgElevated: '#FFFFFF',
    colorBorder: '#E2E8F0',
    colorBorderSecondary: '#F1F5F9',
    colorLink: '#00D4FF',

    // 排版 — Inter + PingFang SC
    fontFamily:
      "'Inter', 'PingFang SC', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
    fontSize: 13,
    fontSizeLG: 15,
    fontSizeSM: 11,
    borderRadius: 6,
    borderRadiusLG: 8,
    borderRadiusSM: 4,
    borderRadiusXS: 3,

    // 控件
    controlHeight: 36,
    controlHeightLG: 44,
    controlHeightSM: 30,
    lineHeight: 1.6,
    paddingContentHorizontal: 24,
    paddingContentVertical: 20,
    paddingLG: 24,
    paddingSM: 16,
    paddingXS: 12,
    marginLG: 24,
    marginSM: 16,

    // 阴影 — 赛博光晕
    boxShadow:
      '0 1px 3px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,0.02)',
    boxShadowSecondary:
      '0 4px 20px rgba(0,212,255,0.12), 0 0 0 1px rgba(0,212,255,0.2)',
    boxShadowTertiary:
      '0 8px 32px rgba(0,212,255,0.15)',
  },

  components: {
    Layout: {
      bodyBg: '#F8FAFC',
      headerBg: '#FFFFFF',
      siderBg: '#0F172A',
      triggerBg: '#0F172A',
    },
    Menu: {
      itemBg: 'transparent',
      itemSelectedBg: 'rgba(0,212,255,0.12)',
      itemSelectedColor: '#00D4FF',
      itemHoverBg: 'rgba(255,255,255,0.04)',
      itemBorderRadius: 8,
      itemMarginInline: 8,
      itemHeight: 40,
      darkItemBg: 'transparent',
      darkItemSelectedBg: 'rgba(0,212,255,0.12)',
      darkItemSelectedColor: '#00D4FF',
      darkItemHoverBg: 'rgba(255,255,255,0.04)',
      darkItemColor: '#CBD5E1',
    },
    Card: {
      colorBgContainer: '#FFFFFF',
      paddingLG: 24,
      borderRadiusLG: 12,
    },
    Table: {
      colorBgContainer: '#FFFFFF',
      headerBg: '#F1F5F9',
      headerColor: '#64748B',
      rowHoverBg: 'rgba(0,212,255,0.04)',
      borderColor: '#E2E8F0',
      headerBorderRadius: 8,
    },
    Button: {
      borderRadius: 8,
      borderRadiusLG: 10,
      borderRadiusSM: 6,
      primaryShadow: '0 2px 8px rgba(0,212,255,0.25)',
      defaultBg: '#FFFFFF',
      defaultBorderColor: '#E2E8F0',
      defaultColor: '#1E293B',
      defaultHoverBg: '#F8FAFC',
      defaultHoverBorderColor: '#00D4FF',
      defaultHoverColor: '#00D4FF',
      fontWeight: 600,
    },
    Input: {
      colorBgContainer: '#FFFFFF',
      colorBorder: '#E2E8F0',
      colorTextPlaceholder: '#94A3B8',
      activeBorderColor: '#00D4FF',
      borderRadius: 10,
      paddingBlock: 8,
      paddingInline: 14,
    },
    Select: {
      colorBgContainer: '#FFFFFF',
      colorBgElevated: '#FFFFFF',
      optionSelectedBg: 'rgba(0,212,255,0.08)',
      borderRadius: 10,
    },
    Modal: {
      colorBgElevated: '#FFFFFF',
      headerBg: '#FFFFFF',
      borderRadiusLG: 16,
    },
    Tabs: {
      colorBgContainer: 'transparent',
      itemSelectedColor: '#00D4FF',
      inkBarColor: '#00D4FF',
      itemHoverColor: '#00D4FF',
    },
    Tag: {
      borderRadiusSM: 6,
      lineHeight: 1.6,
    },
    Statistic: {
      colorTextDescription: '#64748B',
    },
    Badge: {
      colorText: '#FFFFFF',
    },
    Segmented: {
      itemSelectedBg: '#FFFFFF',
      itemSelectedColor: '#1E293B',
      trackBg: '#F1F5F9',
    },
    Breadcrumb: {
      colorText: '#94A3B8',
      lastItemColor: '#1E293B',
      linkColor: '#00D4FF',
    },
  },
};
