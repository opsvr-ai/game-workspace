/**
 * 左侧导航「菜单怎么配」的唯一来源（2026-10-07 从 layouts/AppLayout.tsx 原样搬出来）。
 *
 * AppLayout.tsx 有 3000 多行，但绝大部分是「外壳 + 实时推送 + 弹窗」这类运行时代码；
 * 真正静态的只有这一份：四个角色各显示哪些菜单、每个菜单挂哪个图标、一级菜单按模块上什么色，
 * 以及角标 / 比例小字怎么拼。单独放一个文件，以后改菜单不用在 3000 行里翻。
 *
 * **纯搬运，行为零变化**（正文逐字一致，只动了 import 与导出）。
 */
import React from 'react';
import { Badge, Tooltip } from 'antd';
import {
  ControlOutlined,
  StopOutlined,
  SafetyOutlined,
  HistoryOutlined,
  DashboardOutlined,
  DollarOutlined,
  TeamOutlined,
  UserOutlined,
  ShopOutlined,
  KeyOutlined,
  SendOutlined,
  AuditOutlined,
  FileTextOutlined,
  FundOutlined,
  PictureOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { UserRole } from '@chunlv/shared';
import { BRAND, MODULE_TINTS } from '../styles/tokens';

// Use React.createElement to bypass @ant-design/icons + @types/react 18.3.x JSX type conflict
const IconDashboard = React.createElement(DashboardOutlined);
const IconRevenue = React.createElement(DollarOutlined);
const IconCustomers = React.createElement(TeamOutlined);
const IconEmployees = React.createElement(UserOutlined);
const IconStudios = React.createElement(ShopOutlined);
const IconAuth = React.createElement(KeyOutlined);
const IconDispatch = React.createElement(SendOutlined);
const IconBilling = React.createElement(AuditOutlined);
const IconOrders = React.createElement(FileTextOutlined);
const IconPicture = React.createElement(PictureOutlined);
// Process管控菜单统一图标
const IconControl = React.createElement(ControlOutlined);
const IconStop = React.createElement(StopOutlined);
const IconSafety = React.createElement(SafetyOutlined);
const IconHistory = React.createElement(HistoryOutlined);
const IconClock = React.createElement(ClockCircleOutlined);

const IconLogout = React.createElement(LogoutOutlined);
const IconTraffic = React.createElement(FundOutlined);
const IconFold = React.createElement(MenuFoldOutlined);
const IconUnfold = React.createElement(MenuUnfoldOutlined);

interface MenuItemDef {
  key: string;
  icon?: React.ReactNode;
  label: string;
  type?: string;
  /** 左侧栏标题后面挂的「流水比例」小字（如 70%），数据来自「设置 → 分账规则」。 */
  ratioKey?: 'companion' | 'admin' | 'cs';
  children?: MenuItemDef[];
}

const roleMenus: Record<UserRole, MenuItemDef[]> = {
  [UserRole.OWNER]: [
    // 待处理工作台（老板 2026-10-06）：上班第一件事就点这一页。
    { key: '/todos', icon: IconClock, label: '待处理' },
    {
      key: 'owner-home', icon: IconDashboard, label: '首页',
      children: [
        { key: '/admin', label: '运营看板' },
        { key: '/admin/revenue', label: '营收报表' },
      ],
    },
    {
      key: 'owner-dispatch', icon: IconDispatch, label: '派单管理',
      children: [
        { key: '/admin/dispatch', label: '派单工作台' },
      ],
    },
    {
      key: 'owner-orders', icon: IconOrders, label: '订单管理',
      children: [
        { key: '/owner/orders', label: '全部订单' },
        // 成交核对（老板 2026-10-06）：接单方报的「不成功」在这儿由店长拍板定责，抢了没结果的也在这儿。
        { key: '/owner/order-review', label: '成交核对' },
      ],
    },
    {
      key: 'owner-customers', icon: IconCustomers, label: '客户管理',
      children: [
        { key: '/owner/customers', label: '客户列表' },
        { key: '/owner/customer-board', label: '客户看板' },
      ],
    },
    {
      key: 'owner-employees', icon: IconEmployees, label: '员工管理',
      children: [
        {
          key: 'owner-admin-mgmt', label: '店长管理',
          children: [
            { key: '/owner/employees?role=ADMIN', label: '店长列表' },
          ],
        },
        {
          key: 'owner-companion-mgmt', label: '陪玩管理',
          children: [
            { key: '/admin/companions?role=COMPANION', label: '陪玩列表' },
            { key: '/owner/work-wechats?type=COMPANION', label: '陪玩工作微信' },
            { key: '/admin/battle-screenshots', label: '战绩图审核' },
          ],
        },
        {
          key: 'owner-cs-mgmt', label: '客服管理',
          children: [
            { key: '/owner/employees?role=CS', label: '客服列表' },
            { key: '/owner/work-wechats?type=STUDIO', label: '客服工作微信' },
            { key: '/admin/traffic-accounts', label: '工作室账号管理' },
            { key: '/content-check', label: '内容查重风控' },
          ],
        },
        { key: '/owner/review', label: '实名审核' },
        { key: '/admin/attendance', label: '考勤管理' },
      ],
    },
    {
      key: 'owner-finance', icon: IconRevenue, label: '财务管理',
      children: [
        { key: '/admin/profit-calendar', label: '财务中心' },
        {
          key: 'owner-companion-salary', label: '陪玩工资管理', ratioKey: 'companion',
          children: [
            { key: '/admin/finance/expenses', label: '陪玩审核 + 支取' },
            {
              key: 'owner-companion-reconciliation', label: '陪玩报账对账',
              children: [
                { key: '/admin/finance/reconciliation', label: '应报 vs 实报' },
                { key: '/admin/companion-wallet-calendar', label: '报账与支取日历' },
              ],
            },
            { key: '/admin/finance/risk', label: '打私单风险' },
          ],
        },
        {
          key: 'owner-cs-finance', label: '客服财务管理', ratioKey: 'cs',
          children: [
            {
              key: 'owner-cs-commission', label: '客服提成',
              children: [
                { key: '/admin/finance/commission-today', label: '今日看板' },
                { key: '/admin/finance/commission', label: '月度结算' },
              ],
            },
            { key: '/admin/cs-wechat-flow', label: '客服微信收款明细' },
          ],
        },
      ],
    },
    {
      key: 'owner-shop', icon: IconStudios, label: '店铺管理',
      children: [
        { key: '/owner/studios', label: '工作室管理' },
        { key: '/owner/bridges', label: '工作室桥接' },
        { key: '/owner/authorizations', label: '客户端授权' },
      ],
    },
    {
      key: 'owner-settings', icon: IconAuth, label: '设置中心',
      children: [
        {
          key: '系统与规则', label: '系统与规则',
          children: [
            { key: '/owner/settings', label: '系统配置' },
            { key: '/admin/cs-settings', label: '客服设置', ratioKey: 'cs' },
            { key: '/admin/payroll', label: '工资规则', ratioKey: 'admin' },
            { key: '/admin/finance/price-rules', label: '价格规则' },
          ],
        },
        {
          // 老板 2026-10-07：6 个功能分三步并成一页，左侧菜单只剩这一条「客户端管理」
          // （原「客户端与设备 / 进程管控」两页现在是它里面的页签）。
          key: '/admin/client-management', label: '客户端管理',
        },
        { key: '/profile', label: '个人设置' },
      ],
    },
  ],
  [UserRole.ADMIN]: [
    // 待处理工作台（老板 2026-10-06）：上班第一件事就点这一页。
    { key: '/todos', icon: IconClock, label: '待处理' },
    {
      key: 'admin-home', icon: IconDashboard, label: '首页',
      children: [
        { key: '/admin', label: '运营看板' },
        { key: '/admin/revenue', label: '营收报表' },
      ],
    },
    {
      key: 'admin-dispatch', icon: IconDispatch, label: '派单管理',
      children: [
        { key: '/admin/dispatch', label: '派单工作台' },
      ],
    },
    {
      key: 'admin-orders', icon: IconOrders, label: '订单管理',
      children: [
        { key: '/admin/orders', label: '全部订单' },
        // 成交核对（老板 2026-10-06）：待拍板的失败单在这儿定责（谁的问题找谁）。
        { key: '/admin/order-review', label: '成交核对' },
      ],
    },
    {
      key: 'admin-customers', icon: IconCustomers, label: '客户管理',
      children: [
        { key: '/admin/customers', label: '客户列表' },
        { key: '/admin/customer-board', label: '客户看板' },
      ],
    },
    {
      key: 'admin-employees', icon: IconEmployees, label: '员工管理',
      children: [
        {
          key: 'admin-companion-mgmt', label: '陪玩管理',
          children: [
            { key: '/admin/companions?role=COMPANION', label: '陪玩列表' },
            { key: '/admin/work-wechats?type=COMPANION', label: '陪玩工作微信' },
            { key: '/admin/battle-screenshots', label: '战绩图审核' },
          ],
        },
        {
          key: 'admin-cs-mgmt', label: '客服管理',
          children: [
            { key: '/admin/employees?role=CS', label: '客服列表' },
            { key: '/admin/work-wechats?type=STUDIO', label: '客服工作微信' },
            { key: '/admin/traffic-accounts', label: '工作室账号管理' },
            { key: '/content-check', label: '内容查重风控' },
          ],
        },
        { key: '/admin/review', label: '实名审核' },
        { key: '/admin/attendance', label: '考勤管理' },
      ],
    },
    {
      key: 'admin-finance', icon: IconRevenue, label: '财务管理',
      children: [
        { key: '/admin/profit-calendar', label: '财务中心' },
        {
          key: 'admin-companion-salary', label: '陪玩工资管理', ratioKey: 'companion',
          children: [
            { key: '/admin/finance/expenses', label: '陪玩审核 + 支取' },
            {
              key: 'admin-companion-reconciliation', label: '陪玩报账对账',
              children: [
                { key: '/admin/finance/reconciliation', label: '应报 vs 实报' },
                { key: '/admin/companion-wallet-calendar', label: '报账与支取日历' },
              ],
            },
            { key: '/admin/finance/risk', label: '打私单风险' },
          ],
        },
        {
          key: 'admin-cs-finance', label: '客服财务管理', ratioKey: 'cs',
          children: [
            {
              key: 'admin-cs-commission', label: '客服提成',
              children: [
                { key: '/admin/finance/commission-today', label: '今日看板' },
                { key: '/admin/finance/commission', label: '月度结算' },
              ],
            },
            { key: '/admin/cs-wechat-flow', label: '客服微信收款明细' },
          ],
        },
      ],
    },
    {
      key: 'admin-settings', icon: IconAuth, label: '设置中心',
      children: [
        {
          key: '系统与规则', label: '系统与规则',
          children: [
            { key: '/admin/settings', label: '系统配置' },
            { key: '/admin/cs-settings', label: '客服设置', ratioKey: 'cs' },
            { key: '/admin/payroll', label: '工资规则', ratioKey: 'admin' },
            { key: '/admin/finance/price-rules', label: '价格规则' },
            { key: '/owner/bridges', label: '工作室桥接' },
          ],
        },
        {
          // 老板 2026-10-07：6 个功能分三步并成一页，左侧菜单只剩这一条「客户端管理」
          // （原「客户端与设备 / 进程管控」两页现在是它里面的页签）。
          key: '/admin/client-management', label: '客户端管理',
        },
        { key: '/profile', label: '个人设置' },
      ],
    },
  ],
  [UserRole.CS]: [
    // 待处理工作台（老板 2026-10-06）：上班第一件事就点这一页。
    { key: '/todos', icon: IconClock, label: '待处理' },
    {
      key: 'cs-home', icon: IconDashboard, label: '首页',
      children: [
        { key: '/cs/home', label: '运营看板' },
        { key: '/cs/stats', label: '每日统计' },
      ],
    },
    {
      key: 'cs-dispatch', icon: IconDispatch, label: '派单管理',
      children: [
        { key: '/cs/dispatch', label: '派单工作台' },
      ],
    },
    {
      key: 'cs-orders', icon: IconOrders, label: '订单管理',
      children: [
        { key: '/cs/orders', label: '全部订单' },
        // 客服也能看（自己的单被别人报「不成功」时要跟进）；拍板只有店长 / 老板能做。
        { key: '/cs/order-review', label: '成交核对' },
      ],
    },
    {
      key: 'cs-customers', icon: IconCustomers, label: '客户管理',
      children: [
        { key: '/cs/customers', label: '客户列表' },
        { key: '/admin/customer-board', label: '客户看板' },
      ],
    },
    {
      key: 'cs-employees', icon: IconEmployees, label: '员工管理',
      children: [
        {
          key: 'cs-companion-mgmt', label: '陪玩管理',
          children: [
            { key: '/cs/employees', label: '人员管理' },
            { key: '/cs/work-wechats?type=COMPANION', label: '陪玩工作微信' },
            { key: '/admin/battle-screenshots', label: '战绩图查看' },
          ],
        },
        {
          key: 'cs-cs-mgmt', label: '客服管理',
          children: [
            { key: '/cs/work-wechats?type=STUDIO', label: '客服工作微信' },
            { key: '/cs/traffic-accounts', label: '工作室账号管理' },
            { key: '/content-check', label: '内容查重风控' },
          ],
        },
      ],
    },
    {
      key: 'cs-finance', icon: IconRevenue, label: '财务管理',
      children: [
        { key: '/cs/finance/commission-today', label: '我的提成看板' },
        { key: '/cs/billing', label: '报账系统' },
      ],
    },
    {
      key: 'cs-settings', icon: IconAuth, label: '设置',
      children: [
        { key: '/profile', label: '个人设置' },
      ],
    },
  ],
  [UserRole.COMPANION]: [
    {
      key: 'companion-home', icon: IconDashboard, label: '首页',
      children: [{ key: '/companion', label: '我的首页' }],
    },
    {
      key: 'companion-dispatch', icon: IconDispatch, label: '派单管理',
      children: [
        { key: '/companion/pool', label: '订单池' },
        { key: '/companion/live-board', label: '实时看板' },
      ],
    },
    {
      key: 'companion-orders', icon: IconOrders, label: '订单管理',
      children: [{ key: '/companion/orders', label: '我的订单' }],
    },
    {
      key: 'companion-customers', icon: IconCustomers, label: '客户管理',
      children: [
        { key: '/companion/customers', label: '我的客户' },
        { key: '/companion/customer-board', label: '客户看板' },
      ],
    },
    {
      key: 'companion-battle-screenshots', icon: IconPicture, label: '战绩图上传',
      children: [{ key: '/companion/battle-screenshots', label: '上传战绩图' }],
    },
    {
      key: 'companion-finance', icon: IconRevenue, label: '财务管理',
      children: [
        { key: '/companion/billing', label: '报账系统' },
        { key: '/companion/wallet-calendar', label: '报账与支取日历' },
        { key: '/companion/stats', label: '每日统计' },
      ],
    },
    {
      key: 'companion-settings', icon: IconAuth, label: '设置',
      children: [{ key: '/profile', label: '个人设置' }],
    },
  ],
};

const roleLabels: Record<UserRole, string> = {
  [UserRole.OWNER]: '老板',
  [UserRole.ADMIN]: '店长',
  [UserRole.CS]: '客服',
  [UserRole.COMPANION]: '陪玩',
};

/**
 * 左侧栏一级菜单的「模块配色」。
 * 按菜单 key 的后半段取色（owner-home / admin-finance / cs-orders … 都命中同一张表），
 * 所以加新菜单不用再维护第二份颜色；页面里不要再各写一套。
 */
// 取色规则：按 key 的后半段查 MODULE_TINTS —— 颜色表已搬到 styles/tokens.ts（与页面共用一份）。
const tintOfMenuKey = (key: string): string =>
  MODULE_TINTS[String(key).split('-').slice(1).join('-')] || BRAND.primary;

/**
 * 菜单角标（红色）：label 后面跟一个数量。
 *   叶子挂「这个页面自己的未读数」；父级挂「子树汇总」—— 子菜单被手动收起时，
 *   父级上的角标也能看到里面还有几条没读（老板 2026-10-04：「把子项的未读数合计到父级」）。
 */
const menuBadgeLabel = (label: React.ReactNode, count: number, hint?: string) => {
  const badge = <Badge count={count} size="small" overflowCount={99} color="#FF4D4F" />;
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
      {label}
      {/* 老板 2026-10-05：「有未读，点进去不知道是什么」——鼠标停在红点上直接写清是哪几条待办。 */}
      {hint ? <Tooltip title={hint}>{badge}</Tooltip> : badge}
    </span>
  );
};

/**
 * 把「流水比例」小字挂到左侧栏标题后面。
 *
 * 老板 2026-09-21：店长 / 客服 / 陪玩的工资页要一眼看到他们各拿流水的百分之几，
 * 数字和「设置 → 分账规则」是同一份配置，改完设置刷新页面就同步。
 *
 * 必须放在徽标逻辑**之后**执行：那一段是拿 label 字符串比对的，先换成节点就比不中了。
 */
const decorateMenu = (
  items: any[],
  ratios: Record<string, number | null>,
  depth = 0,
): any[] =>
  items.map((item) => {
    const next: any = { ...item };
    // 一级菜单的图标按模块上色，横向一眼能认出「钱 / 单 / 人 / 店」
    if (depth === 0 && item.icon) {
      next.icon = (
        <span style={{ color: tintOfMenuKey(item.key), display: 'inline-flex' }}>{item.icon}</span>
      );
    }
    const pct = item.ratioKey ? ratios[item.ratioKey] : null;
    if (item.ratioKey && pct != null && typeof item.label === 'string') {
      next.label = (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, maxWidth: '100%' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
            {item.label}
          </span>
          <span
            style={{
              flex: '0 0 auto',
              fontSize: 11,
              lineHeight: '16px',
              color: BRAND.primary,
              background: BRAND.soft,
              borderRadius: 6,
              padding: '0 4px',
            }}
          >
            {pct}%
          </span>
        </span>
      );
    }
    if (Array.isArray(item.children)) {
      next.children = decorateMenu(item.children, ratios, depth + 1);
    }
    return next;
  });

/** 通知里的「查看 ›」跳哪：同一模块四个角色的路由都不一样，按角色查一次 */
const ROLE_PAGES: Record<string, Record<string, string>> = {
  COMPANION: { pool: '/companion/pool', orders: '/companion/orders', billing: '/companion/billing', audits: '/companion', customers: '/companion/customers', battle: '/companion/battle-screenshots' },
  // 待处理工作台三个角色共用一条路由
  TODOS: { CS: '/todos', ADMIN: '/todos', OWNER: '/todos' },
  CS: { pool: '/cs/dispatch', orders: '/cs/orders', billing: '/cs/billing', audits: '/cs/employees', 'work-wechats': '/cs/work-wechats?type=COMPANION', customers: '/cs/customers', battle: '/admin/battle-screenshots', bridges: '/owner/bridges' },
  ADMIN: { pool: '/admin/dispatch', orders: '/admin/orders', billing: '/admin/finance/expenses', audits: '/admin/companions?role=COMPANION', 'work-wechats': '/admin/work-wechats?type=COMPANION', customers: '/admin/customers', battle: '/admin/battle-screenshots', bridges: '/owner/bridges' },
  OWNER: { pool: '/admin/dispatch', orders: '/owner/orders', billing: '/admin/finance/expenses', audits: '/owner/review', 'work-wechats': '/owner/work-wechats?type=COMPANION', customers: '/owner/customers', battle: '/admin/battle-screenshots', bridges: '/owner/bridges' },
};

const rolePage = (role: string | undefined, module: string): string => ROLE_PAGES[role || '']?.[module] || '';

// AppLayout 真正要用的就这几样（图标只导出它在别处直接渲染的那三个）。
export { roleMenus, roleLabels, menuBadgeLabel, decorateMenu, rolePage, IconLogout, IconFold, IconUnfold };
export type { MenuItemDef };
