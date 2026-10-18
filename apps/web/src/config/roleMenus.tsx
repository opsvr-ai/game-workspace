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
  ShopOutlined,
  KeyOutlined,
  SendOutlined,
  AuditOutlined,
  FileTextOutlined,
  FundOutlined,
  PictureOutlined,
  TrophyOutlined,
  CustomerServiceOutlined,
  SolutionOutlined,
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
// 按「人」分的三个一级菜单（老板 2026-10-10）：谁的功能就去谁的菜单下找。
const IconCompanions = React.createElement(TrophyOutlined);
const IconCs = React.createElement(CustomerServiceOutlined);
const IconAdmins = React.createElement(SolutionOutlined);

interface MenuItemDef {
  key: string;
  icon?: React.ReactNode;
  label: string;
  /** 'group' = 只做视觉分段的分组标题，不折叠、点了不跳转（老板 2026-10-08：左侧最多两级）。 */
  type?: 'group';
  /** 左侧栏标题后面挂的「业绩比例」小字（如 70%），数据来自「设置 → 分账规则」。 */
  ratioKey?: 'companion' | 'admin' | 'cs';
  children?: MenuItemDef[];
}

/**
 * 分组标题（老板 2026-10-08：左侧菜单最多两级）。
 *
 * 以前「员工管理 → 陪玩管理 → 陪玩列表」要点两次才看得到人。现在第三级一律改成这种
 * **不会折叠**的分组标题：只做视觉分段，点它不跳转、也不用再展开。
 */
const group = (
  key: string,
  label: string,
  children: MenuItemDef[],
  extra?: Partial<MenuItemDef>,
): MenuItemDef => ({ key, label, type: 'group', children, ...extra });

/** 一个分组里第一个「能点的页面」的 key —— 分组标题点了就跳它。 */
const firstPageKeyOf = (node: any): string | null => {
  if (typeof node?.key === 'string' && node.key.startsWith('/')) return node.key;
  for (const kid of node?.children || []) {
    const found = firstPageKeyOf(kid);
    if (found) return found;
  }
  return null;
};

/**
 * 把「标题」做成**可点**：点一下直接进它里面第一个页面。
 *
 * - 一级菜单（带子项）—— 老板 2026-10-16：「点一下，再动鼠标点右侧的二级标题，很不顺手」。
 *   以前点一级的文字只是展开 / 收起，得再点一次二级才进得去；现在点文字 = 直接进第一个子页面，
 *   展开 / 收起改由这一行右边的箭头管（「最多两级」的规矩不变）。
 *
 * 老板 2026-10-10：「陪玩工资 70% 点不开？」—— 分组标题本来只是视觉分段（点了不跳转），
 * 但在左侧栏里它跟能点的菜单项长得一样，**看着像个菜单却点不动**比长一点更别扭。
 * 第三级不做折叠菜单这条规矩不变（老板 2026-10-08），只是给它一个「点一下就能进去」的出口。
 *
 * onClick 里先 stopPropagation：别顺带触发父级 Menu 的 onClick（那会按 key 再跳一次）。
 */
const makeTitlesClickable = (
  items: any[],
  onJump: (key: string) => void,
): any[] =>
  items.map((node) => {
    const kids = Array.isArray(node?.children)
      ? makeTitlesClickable(node.children, onJump)
      : undefined;
    if (!kids?.length) return node;
    const jump = firstPageKeyOf(node);
    if (!jump) return { ...node, children: kids };
    return {
      ...node,
      children: kids,
      label: (
        <span
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            onJump(jump);
          }}
          title="点这里进去"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
        >
          {node.label}
        </span>
      ),
    };
  });

const roleMenus: Record<UserRole, MenuItemDef[]> = {
  [UserRole.OWNER]: [
    {
      key: 'owner-home', icon: IconDashboard, label: '工作台',
      children: [
        { key: '/admin', label: '运营看板' },
        { key: '/admin/revenue', label: '各工作室营收' },
        { key: '/todos', label: '待处理' },
      ],
    },
    {
      key: 'owner-orders', icon: IconOrders, label: '订单管理',
      children: [
        { key: '/admin/dispatch', label: '派单工作台' },
        { key: '/admin/orders', label: '全部订单' },
        { key: '/admin/order-review', label: '成交核对' },
      ],
    },
    {
      key: 'owner-customers', icon: IconCustomers, label: '客户管理',
      children: [
        { key: '/admin/customers', label: '客户列表' },
        { key: '/admin/customer-board', label: '客户看板' },
      ],
    },
    {
      key: 'owner-team', icon: IconCompanions, label: '团队管理',
      children: [
        group('owner-group-companion', '陪玩', [
          { key: '/admin/companions?role=COMPANION', label: '陪玩列表', ratioKey: 'companion' },
          { key: '/admin/work-wechats?type=COMPANION', label: '陪玩工作微信' },
          { key: '/admin/review', label: '陪玩实名审核' },
          { key: '/admin/battle-screenshots', label: '陪玩战绩图审核' },
        ]),
        group('owner-group-cs', '客服', [
          { key: '/admin/employees?role=CS', label: '客服列表', ratioKey: 'cs' },
          { key: '/admin/work-wechats?type=STUDIO', label: '客服工作微信' },
        ]),
        group('owner-group-admin', '店长', [
          { key: '/admin/employees?role=ADMIN', label: '店长列表', ratioKey: 'admin' },
        ]),
        group('owner-group-attendance', '考勤与工资', [
          { key: '/admin/attendance', label: '陪玩/客服/店长考勤管理' },
          { key: '/admin/payroll', label: '店长/客服工资规则' },
        ]),
      ],
    },
    {
      key: 'owner-studios', icon: IconStudios, label: '工作室管理',
      children: [
        { key: '/owner/studios', label: '工作室/俱乐部管理' },
        { key: '/owner/bridges', label: '工作室桥接' },
        { key: '/owner/authorizations', label: '客户端授权' },
        { key: '/admin/traffic-accounts', label: '工作室账号' },
        { key: '/content-check', label: 'AI运营辅助' },
        { key: '/admin/client-management', label: '客户端与设备' },
      ],
    },
    {
      key: 'owner-finance', icon: IconRevenue, label: '财务',
      children: [
        { key: '/admin/profit-calendar', label: '财务中心' },
        { key: '/admin/finance/expenses', label: '陪玩审核 + 支取' },
        { key: '/admin/finance/reconciliation', label: '应报 vs 实报' },
        { key: '/admin/companion-wallet-calendar', label: '报账与支取日历' },
        { key: '/admin/finance/risk', label: '打私单风险' },
        { key: '/admin/finance/price-rules', label: '价格规则' },
        { key: '/admin/finance/commission-today', label: '客服今日看板' },
        { key: '/admin/finance/commission', label: '客服月度结算' },
        { key: '/admin/cs-wechat-flow', label: '客服微信收款明细' },
      ],
    },
    {
      key: 'owner-settings', icon: IconAuth, label: '设置',
      children: [
        { key: '/admin/settings', label: '系统配置' },
        { key: '/profile', label: '个人设置' },
        group('owner-group-advanced', '高级设置', [
          { key: '/admin/cs-settings', label: '客服设置' },
        ]),
      ],
    },
  ],
  [UserRole.ADMIN]: [
    {
      key: 'admin-home', icon: IconDashboard, label: '工作台',
      children: [
        { key: '/admin', label: '本店运营看板' },
        { key: '/admin/revenue', label: '本店营收' },
        { key: '/todos', label: '待处理' },
      ],
    },
    {
      key: 'admin-orders', icon: IconOrders, label: '订单管理',
      children: [
        { key: '/admin/dispatch', label: '派单工作台' },
        { key: '/admin/orders', label: '全部订单' },
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
      key: 'admin-team', icon: IconCompanions, label: '团队管理',
      children: [
        group('admin-group-companion', '陪玩', [
          { key: '/admin/companions?role=COMPANION', label: '陪玩列表', ratioKey: 'companion' },
          { key: '/admin/work-wechats?type=COMPANION', label: '陪玩工作微信' },
          { key: '/admin/review', label: '陪玩实名审核' },
          { key: '/admin/battle-screenshots', label: '陪玩战绩图审核' },
        ]),
        group('admin-group-cs', '客服', [
          { key: '/admin/employees?role=CS', label: '客服列表', ratioKey: 'cs' },
          { key: '/admin/work-wechats?type=STUDIO', label: '客服工作微信' },
        ]),
        group('admin-group-attendance', '考勤与工资', [
          { key: '/admin/attendance', label: '陪玩/客服/店长考勤管理' },
          { key: '/admin/payroll', label: '店长/客服工资规则' },
        ]),
      ],
    },
    {
      key: 'admin-studios', icon: IconStudios, label: '工作室管理',
      children: [
        { key: '/owner/bridges', label: '工作室桥接' },
        { key: '/admin/traffic-accounts', label: '工作室账号' },
        { key: '/content-check', label: 'AI运营辅助' },
        { key: '/admin/client-management', label: '客户端与设备' },
      ],
    },
    {
      key: 'admin-finance', icon: IconRevenue, label: '财务',
      children: [
        { key: '/admin/profit-calendar', label: '财务中心' },
        { key: '/admin/finance/expenses', label: '陪玩审核 + 支取' },
        { key: '/admin/finance/reconciliation', label: '应报 vs 实报' },
        { key: '/admin/companion-wallet-calendar', label: '报账与支取日历' },
        { key: '/admin/finance/risk', label: '打私单风险' },
        { key: '/admin/finance/price-rules', label: '价格规则' },
        { key: '/admin/finance/commission-today', label: '客服今日看板' },
        { key: '/admin/finance/commission', label: '客服月度结算' },
        { key: '/admin/cs-wechat-flow', label: '客服微信收款明细' },
      ],
    },
    {
      key: 'admin-settings', icon: IconAuth, label: '设置',
      children: [
        { key: '/admin/settings', label: '系统配置' },
        { key: '/profile', label: '个人设置' },
        group('admin-group-advanced', '高级设置', [
          { key: '/admin/cs-settings', label: '客服设置' },
        ]),
      ],
    },
  ],
  [UserRole.CS]: [
    {
      key: 'cs-home', icon: IconDashboard, label: '工作台',
      children: [
        { key: '/cs/home', label: '本店运营看板' },
        { key: '/todos', label: '待处理' },
      ],
    },
    {
      key: 'cs-orders', icon: IconOrders, label: '订单管理',
      children: [
        { key: '/cs/dispatch', label: '派单工作台' },
        { key: '/cs/orders', label: '全部订单' },
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
      key: 'cs-operations', icon: IconDispatch, label: '运营',
      children: [
        { key: '/cs/work-wechats?type=COMPANION', label: '陪玩工作微信' },
        { key: '/cs/work-wechats?type=STUDIO', label: '客服工作微信' },
        { key: '/cs/traffic-accounts', label: '工作室账号' },
        { key: '/content-check', label: 'AI运营辅助' },
      ],
    },
    {
      key: 'cs-finance', icon: IconRevenue, label: '财务',
      children: [
        { key: '/cs/finance/commission-today', label: '我的提成' },
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
      key: 'companion-home', icon: IconDashboard, label: '工作台',
      children: [{ key: '/companion', label: '我的工作台' }],
    },
    {
      key: 'companion-orders', icon: IconOrders, label: '订单管理',
      children: [
        { key: '/companion/pool', label: '订单池' },
        { key: '/companion/orders', label: '我的订单' },
        { key: '/companion/live-board', label: '实时看板' },
      ],
    },
    {
      key: 'companion-customers', icon: IconCustomers, label: '客户管理',
      children: [
        { key: '/companion/customers', label: '我的客户' },
        { key: '/companion/customer-board', label: '客户看板' },
      ],
    },
    {
      key: 'companion-finance', icon: IconRevenue, label: '财务',
      children: [
        { key: '/companion/billing', label: '报账系统' },
        { key: '/companion/wallet-calendar', label: '报账与支取日历' },
        { key: '/companion/stats', label: '每日统计' },
      ],
    },
    {
      key: 'companion-settings', icon: IconAuth, label: '设置',
      children: [
        { key: '/profile', label: '个人设置' },
        { key: '/companion/notifications', label: '通知设置' },
      ],
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
 * 把「业绩比例」小字挂到左侧栏标题后面。
 *
 * 老板 2026-09-21：店长 / 客服 / 陪玩的工资页要一眼看到他们各拿业绩的百分之几，
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
  OWNER: { pool: '/admin/dispatch', orders: '/admin/orders', billing: '/admin/finance/expenses', audits: '/admin/review', 'work-wechats': '/admin/work-wechats?type=COMPANION', customers: '/admin/customers', battle: '/admin/battle-screenshots', bridges: '/owner/bridges' },
};

const rolePage = (role: string | undefined, module: string): string => ROLE_PAGES[role || '']?.[module] || '';

// AppLayout 真正要用的就这几样（图标只导出它在别处直接渲染的那三个）。
export { roleMenus, roleLabels, menuBadgeLabel, decorateMenu, makeTitlesClickable, rolePage, IconLogout, IconFold, IconUnfold };
export type { MenuItemDef };
