import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from '../pages/LoginPage';

/**
 * 登录页冒烟（2026-10-07，前端第一份「真渲染」测试）。
 *
 * 它拦的是最丢人的那一类事故：**白屏**。
 * 前端没有任何测试的时候，「谁把某个 import 删了 / 某个 store 改名了」这种改动，
 * 表现形式不是红，而是老板打开网页看见一片白 —— 而且只有他能发现。
 * 这里不连后端、不登录，只确认页面能渲染出来、关键控件在。
 */
describe('登录页冒烟（不连后端）', () => {
  it('能渲染出品牌名、账号 / 密码输入框和登录按钮', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(screen.getByText('陪玩管理系统')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('姓名')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('密码')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /登\s*录/ })).toBeInTheDocument();
  });
});
