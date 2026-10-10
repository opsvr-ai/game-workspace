/**
 * 左侧导航契约（apps/web/src/config/roleMenus.tsx）。
 *
 * 为什么先给这个文件上测试（前端第一份测试）：
 *   1. 它决定「每个角色能看到哪些菜单」——**权限边界**。以前它在 3000 行的 `AppLayout.tsx` 里，
 *      改外壳时很容易手滑把「工资规则」挂到客服菜单上，而**没有任何东西拦得住**。
 *   2. 菜单里的每个 key 都是**真实要跳转的 URL**（还会被陪玩端 / 客服端内嵌窗口复用），
 *      路径写错了就是「点了打不开」，靠人肉点是点不完的。
 *   3. 重构 AppLayout 之前先把这份「菜单长什么样」钉死，改动就会立刻显形。
 *
 * 这里的表都是 `it` 断言，不是随手 log —— 菜单变了就是测试红，而不是靠人眼看。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { UserRole } from '@chunlv/shared';
import { roleLabels, roleMenus } from './roleMenus';
import type { MenuItemDef } from './roleMenus';

const HERE = dirname(fileURLToPath(import.meta.url));

/** 页面路由清单（由 scripts/_export_web_routes.mjs 从 router.tsx 导出，CI 冻结）。 */
const WEB_ROUTES = JSON.parse(
  readFileSync(resolve(HERE, '../../../../docs/WEB-ROUTES.json'), 'utf8'),
) as { count: number; routes: { path: string }[] };

const ROUTE_PATHS = new Set(WEB_ROUTES.routes.map((r) => r.path));

/** '/owner/employees?role=ADMIN' → '/owner/employees' */
const pathOf = (key: string): string => key.split('?')[0];

interface Flat {
  key: string;
  label: string;
  leaf: boolean;
  ratioKey?: string;
}

function flatten(items: MenuItemDef[], acc: Flat[] = []): Flat[] {
  for (const item of items) {
    const kids = item.children ?? [];
    acc.push({
      key: item.key,
      label: typeof item.label === 'string' ? item.label : '<node>',
      leaf: kids.length === 0,
      ratioKey: item.ratioKey,
    });
    if (kids.length) flatten(kids, acc);
  }
  return acc;
}

const ROLES = [UserRole.OWNER, UserRole.ADMIN, UserRole.CS, UserRole.COMPANION];

describe('左侧导航菜单（roleMenus）', () => {
  it('四个角色都有菜单，且只有一个「待处理」入口挂在最上面', () => {
    for (const role of ROLES) {
      const menus = roleMenus[role];
      expect(menus, `${role} 没有菜单`).toBeTruthy();
      expect(menus.length, `${role} 菜单是空的`).toBeGreaterThan(0);
    }
    // 老板 2026-10-06：「上班第一件事点开待处理看一下」——三个管理端角色都要有。
    for (const role of [UserRole.OWNER, UserRole.ADMIN, UserRole.CS]) {
      expect(roleMenus[role][0].key, `${role} 第一个菜单应该是待处理`).toBe('/todos');
    }
  });

  it('角色中文名（左栏顶部 / 弹窗里都用它）', () => {
    expect(roleLabels).toEqual({
      [UserRole.OWNER]: '老板',
      [UserRole.ADMIN]: '店长',
      [UserRole.CS]: '客服',
      [UserRole.COMPANION]: '陪玩',
    });
  });

  it('每个「能点的」菜单都指向真实存在的路由（点了打不开就是这里挂）', () => {
    const broken: string[] = [];
    for (const role of ROLES) {
      for (const item of flatten(roleMenus[role])) {
        if (!item.leaf) continue;
        const p = pathOf(item.key);
        if (!p.startsWith('/')) {
          broken.push(`${role} 叶子菜单「${item.label}」的 key「${item.key}」不是路径`);
          continue;
        }
        if (!ROUTE_PATHS.has(p)) {
          broken.push(`${role} 菜单「${item.label}」指向不存在路由 ${p}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('分组（有子菜单那种）的 key 不能长得像路径，同一个角色里也不能重名', () => {
    const problems: string[] = [];
    for (const role of ROLES) {
      const groups = flatten(roleMenus[role]).filter((x) => !x.leaf);
      for (const g of groups) {
        if (g.key.startsWith('/')) {
          problems.push(`${role} 的分组「${g.label}」的 key 是路径「${g.key}」，会和真路由混`);
        }
      }
      const dup = groups.map((g) => g.key).filter((k, i, a) => a.indexOf(k) !== i);
      if (dup.length) problems.push(`${role} 分组 key 重复：${[...new Set(dup)].join(', ')}`);
    }
    expect(problems).toEqual([]);
  });

  it('同一个角色里，同一个页面不会挂两次', () => {
    const problems: string[] = [];
    for (const role of ROLES) {
      const keys = flatten(roleMenus[role])
        .filter((x) => x.leaf)
        .map((x) => x.key);
      const dup = keys.filter((k, i, a) => a.indexOf(k) !== i);
      if (dup.length) problems.push(`${role} 重复菜单：${[...new Set(dup)].join(', ')}`);
    }
    expect(problems).toEqual([]);
  });

  it('「业绩比例」小字只挂在工资 / 提成那几项上（值来自「设置 → 分账规则」）', () => {
    const withRatio = new Map<string, string[]>();
    for (const role of ROLES) {
      for (const item of flatten(roleMenus[role])) {
        if (!item.ratioKey) continue;
        const list = withRatio.get(item.key) ?? [];
        list.push(item.ratioKey);
        withRatio.set(item.key, list);
      }
    }
    // 只要有，就必须是这三个键之一（服务端只认这三种分账）
    for (const [, ratioKeys] of withRatio) {
      for (const r of ratioKeys) expect(['companion', 'admin', 'cs']).toContain(r);
    }
    expect(withRatio.size).toBeGreaterThan(0);
  });

  it('一级菜单都挂了图标（左栏靠图标一眼认模块；二级菜单按约定不挂，见下）', () => {
    // 约定（成立就好，不要随手改）：一级菜单 / 顶层分组挂图标；二级及以下一律不挂。
    // 既然后者本来就不挂，这里只锁「一级必须有」——漏一个图标在左栏就是一行空白，很难看。
    const missing: string[] = [];
    for (const role of ROLES) {
      for (const item of roleMenus[role]) {
        if (!item.icon) missing.push(role + ' 的一级菜单「' + item.label + '」没图标');
      }
    }
    expect(missing).toEqual([]);
  });

  it('左侧菜单最多两级（第三级一律换成不折叠的分组标题）', () => {
    // 老板 2026-10-08：「很多菜单都得点开好几个子菜单」—— 现在最多两级：
    // 一级点开就是能点的页面，中间那层换成 type: 'group' 的分组标题（点了不跳转、也不用再展开）。
    const problems: string[] = [];
    const walk = (items: MenuItemDef[], depth: number, lane: string): void => {
      for (const item of items) {
        const kids = item.children ?? [];
        if (depth >= 2 && kids.length > 0) {
          problems.push(lane + ' 的「' + String(item.label) + '」已经是第三级，下面还挂着子菜单');
        }
        if (kids.length) walk(kids, depth + 1, lane + ' / ' + String(item.label));
      }
    };
    for (const role of ROLES) walk(roleMenus[role], 0, role);
    expect(problems).toEqual([]);
  });

  it('分组标题（type: group）只做视觉分段：不空、key 不是路径、里面都是能点的页面', () => {
    const problems: string[] = [];
    for (const role of ROLES) {
      for (const top of roleMenus[role]) {
        for (const kid of top.children ?? []) {
          if (kid.type !== 'group') continue;
          if (!(kid.children ?? []).length) problems.push(role + ' 的分组「' + String(kid.label) + '」是空的');
          if (String(kid.key).startsWith('/')) {
            problems.push(role + ' 的分组「' + String(kid.label) + '」的 key 是路径「' + kid.key + '」');
          }
          for (const leaf of kid.children ?? []) {
            if ((leaf.children ?? []).length) {
              problems.push(role + ' 的分组「' + String(kid.label) + '」里的「' + String(leaf.label) + '」还挂着子菜单');
            }
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('「店长管理」只在老板端；店长端只按人分客服 / 陪玩（老板 2026-10-10）', () => {
    // 老板 2026-10-10：「店长管理只在老板端显示吧？店长显示的只有客服跟陪玩吧？」
    const topLabels = (role: UserRole) => roleMenus[role].map((m) => String(m.label));
    expect(topLabels(UserRole.OWNER)).toContain('店长管理');
    expect(topLabels(UserRole.ADMIN)).not.toContain('店长管理');
    // 店长端：按人分的两个一级菜单就是客服 / 陪玩
    expect(topLabels(UserRole.ADMIN)).toContain('客服管理');
    expect(topLabels(UserRole.ADMIN)).toContain('陪玩管理');
    // 老板端有 店长列表（店长管理里），店长端没有
    const leavesOf = (role: UserRole) => flatten(roleMenus[role]).filter((x) => x.leaf).map((x) => x.key);
    expect(leavesOf(UserRole.OWNER)).toContain('/owner/employees?role=ADMIN');
    expect(leavesOf(UserRole.ADMIN)).not.toContain('/owner/employees?role=ADMIN');
  });

  it('「价格规则」归陪玩管理（老板 2026-10-10）', () => {
    // 老板 2026-10-10：「价格规则……挪到陪玩管理」
    for (const role of [UserRole.OWNER, UserRole.ADMIN]) {
      const companionMenu = roleMenus[role].find((m) => String(m.label) === '陪玩管理');
      expect(companionMenu, role + ' 没有陪玩管理').toBeTruthy();
      const keys = flatten(companionMenu!.children ?? []).map((x) => x.key);
      expect(keys, role + ' 的陪玩管理里没有价格规则').toContain('/admin/finance/price-rules');
    }
  });

  it('整棵菜单树快照（重构 AppLayout 时，菜单一改这里就红）', () => {
    const tree = Object.fromEntries(
      ROLES.map((role) => [
        role,
        flatten(roleMenus[role]).map((x) => `${x.leaf ? '· ' : '▸ '}${x.key} | ${x.label}${x.ratioKey ? ' | ' + x.ratioKey : ''}`),
      ]),
    );
    expect(tree).toMatchSnapshot();
  });
});
