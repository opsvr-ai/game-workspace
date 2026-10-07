/**
 * 左侧导航「最多两级」的渲染守卫（老板 2026-10-08）。
 *
 * 数据层有没有三级菜单，roleMenus.test.ts 已经钉住了；这里再往前一步：**真渲染一遍 antd 的 Menu**，
 * 确认画出来也没有「折叠子菜单里还套折叠子菜单」—— 第三级全是不折叠的分组标题。
 * 于是「菜单又变深了」或「分组标题根本没渲染出来」这两类问题都会立刻红，不用等人肉点。
 */
import { act, render } from '@testing-library/react';
import { Menu } from 'antd';
import { describe, expect, it } from 'vitest';
import { UserRole } from '@chunlv/shared';
import { roleMenus } from './roleMenus';

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

  it('店长端：第三级画成了分组标题（陪玩 / 客服 / 陪玩工资），不再是折叠项', async () => {
    const items = roleMenus[UserRole.ADMIN] as any[];
    const { container, getByText } = render(
      <Menu mode="inline" items={items} openKeys={openKeysOf(items)} />,
    );
    await settle();
    const titles = Array.from(container.querySelectorAll('.ant-menu-item-group-title')).map(
      (el) => el.textContent || '',
    );
    expect(titles).toContain('陪玩');
    expect(titles).toContain('客服');
    expect(titles).toContain('陪玩工资');
    expect(container.querySelectorAll('.ant-menu-item-group .ant-menu-submenu').length).toBe(0);
    getByText('陪玩列表');
    getByText('客服列表');
  });
});
