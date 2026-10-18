/**
 * 左侧导航「最多两级」的渲染守卫（老板 2026-10-08）。
 *
 * 数据层有没有三级菜单，roleMenus.test.ts 已经钉住了；这里再往前一步：**真渲染一遍 antd 的 Menu**，
 * 确认画出来也没有「折叠子菜单里还套折叠子菜单」—— 第三级全是不折叠的分组标题。
 * 于是「菜单又变深了」或「分组标题根本没渲染出来」这两类问题都会立刻红，不用等人肉点。
 */
import { act, fireEvent, render } from '@testing-library/react';
import { Menu } from 'antd';
import { describe, expect, it } from 'vitest';
import { UserRole } from '@chunlv/shared';
import { makeTitlesClickable, roleMenus } from './roleMenus';

/** 渲染完再等一拍：rc-menu 挂载后有异步的展开动画状态更新，不等它 Rest 会报 act(...) 警告。 */
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

/** 所有带子项的 key（受控 openKeys，保证子项真的被渲染出来）。 */
const openKeysOf = (items: any[]): string[] =>
  items.flatMap((it: any) => (it?.children?.length ? [it.key, ...openKeysOf(it.children)] : []));

const ROLES = [UserRole.OWNER, UserRole.ADMIN, UserRole.CS, UserRole.COMPANION];

describe('左侧导航渲染（最多两级）', () => {
  for (const role of ROLES) {
    it(role + '：渲染后没有「折叠子菜单套折叠子菜单」', async () => {
      const items = roleMenus[role] as any[];
      const { container } = render(<Menu mode="inline" items={items} openKeys={openKeysOf(items)} />);
      await settle();
      expect(container.querySelectorAll('.ant-menu-submenu .ant-menu-submenu').length).toBe(0);
    });
  }

  it('管理端：左侧 5 组，团队与财务里的分组标题不再是折叠项', async () => {
    const items = roleMenus[UserRole.ADMIN] as any[];
    const { container, getByText } = render(
      <Menu mode="inline" items={items} openKeys={openKeysOf(items)} />,
    );
    await settle();
    const titles = Array.from(container.querySelectorAll('.ant-menu-item-group-title')).map(
      (el) => el.textContent || '',
    );
    expect(titles).toContain('团队');
    expect(titles).toContain('财务');
    expect(titles).toContain('高级设置');
    expect(container.querySelectorAll('.ant-menu-item-group .ant-menu-submenu').length).toBe(0);
    getByText('工作台');
    getByText('订单');
    getByText('客户');
    getByText('团队与财务');
    getByText('设置与设备');
    getByText('陪玩列表');
    getByText('客服列表');
    getByText('陪玩/客服/店长考勤管理');
    getByText('店长/客服工资规则');
  });

  it('分组标题可点：点「团队」直接进第一个页面（老板 2026-10-10「点不开？」）', async () => {
    const jumps: string[] = [];
    const items = makeTitlesClickable(roleMenus[UserRole.ADMIN] as any[], (key) => jumps.push(key));
    const { container, getByText } = render(
      <Menu mode="inline" items={items} openKeys={openKeysOf(items)} />,
    );
    await settle();
    // 分组标题本身还是个不折叠的分组（「最多两级」规矩不变），只是文字被包成了可点节点。
    expect(container.querySelectorAll('.ant-menu-item-group-title span').length).toBeGreaterThan(0);
    fireEvent.click(getByText('团队'));
    expect(jumps).toEqual(['/admin/companions?role=COMPANION']);
    // 「财务」里第一个页面是「财务中心」。
    fireEvent.click(getByText('财务'));
    expect(jumps).toEqual(['/admin/companions?role=COMPANION', '/admin/profit-calendar']);
  });

  it('一级菜单可点：点「团队与财务」直接进它里面第一个页面（老板 2026-10-16）', async () => {
    const jumps: string[] = [];
    const items = makeTitlesClickable(roleMenus[UserRole.ADMIN] as any[], (key) => jumps.push(key));
    const { getByText } = render(<Menu mode="inline" items={items} openKeys={openKeysOf(items)} />);
    await settle();
    // 一级标题的文字被包成可点节点：点一下 = 进它里面第一个页面。
    expect(getByText('团队与财务').closest('span')).toBeTruthy();
    fireEvent.click(getByText('团队与财务'));
    expect(jumps).toEqual(['/admin/companions?role=COMPANION']);
    // 点一级不会顺带把「展开 / 收起」也触发（stopPropagation），二级项照旧自己点照旧跳。
    fireEvent.click(getByText('订单'));
    expect(jumps).toEqual(['/admin/companions?role=COMPANION', '/admin/dispatch']);
  });
});
