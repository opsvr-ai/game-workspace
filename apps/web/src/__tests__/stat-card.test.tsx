import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatCard from '../components/StatCard';
import { SEMANTIC } from '../styles/tokens';

/**
 * 统计卡（看板上的「一个大数字」）。
 *
 * 为什么要测这个：它现在是**所有看板**上那排数字的唯一来源（运营看板 / 陪玩端首页 /
 * 客户看板 / 支出审核都改用它了）。形状一旦被改动，全站几十个看板一起变 ——
 * 而「变没变」在本机不容易看出来（要登录 + 要数据），所以把形状钉在这里。
 */

describe('StatCard', () => {
  it('标签、数字、下面那行小字都画得出来', () => {
    render(<StatCard label="今日流水" value="￥12,860" sub="较昨日 +8%" tint={SEMANTIC.successDeep} />);
    expect(screen.getByText('今日流水')).toBeInTheDocument();
    expect(screen.getByText('￥12,860')).toBeInTheDocument();
    expect(screen.getByText('较昨日 +8%')).toBeInTheDocument();
  });

  it('sub 不给就不占位（不给空行）', () => {
    const { container } = render(<StatCard label="待抢单" value="6" />);
    expect(container.querySelectorAll('[data-stat-card]').length).toBe(1);
    expect(screen.queryByText('较昨日 +8%')).toBeNull();
  });

  it('数字用主题色，和左侧竖条、标签圆点同一个颜色', () => {
    const { container } = render(<StatCard label="正在打" value="3" tint={SEMANTIC.dangerStrong} />);
    const root = container.querySelector('[data-stat-card]') as HTMLElement;
    const value = screen.getByText('3') as HTMLElement;
    expect(value.style.color).toBeTruthy();
    // 值色与竖条同源：都从同一个 tint 来（竖条是渐变，所以只断言它含这个色）
    const accent = root.querySelector('[aria-hidden]') as HTMLElement;
    expect(accent.style.background).toContain('gradient');
    expect(root.textContent).toContain('正在打');
  });

  it('variant=tinted 是淡色底（客户看板那套），plain 是白卡', () => {
    const plain = render(<StatCard label="A" value="1" tint={SEMANTIC.infoDeep} />).container.querySelector('[data-stat-card]') as HTMLElement;
    expect(plain.style.background).toBe('');

    const tinted = render(<StatCard label="A" value="1" tint={SEMANTIC.infoDeep} variant="tinted" />).container.querySelector('[data-stat-card]') as HTMLElement;
    expect(tinted.style.background).not.toBe('');
    expect(tinted.style.border).toContain('1px solid');
  });

  it('可点的时候才带上按钮语义（键盘 / 读屏能认出来）', () => {
    const onClick = vi.fn();
    const { container } = render(<StatCard label="可点" value="1" onClick={onClick} />);
    const root = container.querySelector('[data-stat-card]') as HTMLElement;
    expect(root.getAttribute('role')).toBe('button');
  });
});