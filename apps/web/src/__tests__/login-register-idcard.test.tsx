import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * 注册的身份证正反面是硬门槛（老板 2026-10-10）。
 *
 * 老板原话：「为什么陪玩上传身份证的时候你说稍后也行？没有就注册不了，懂了么」。
 * 以前点一下「照片一直传不上去？先不带照片提交（店长稍后补传）」就能带着空身份证注册，
 * 结果实名审核那一栏一直是空的，说好补传的也没人补。现在：
 *   ① 那个入口整条拿掉（页面里再也搜不到这句话）；
 *   ② 缺一张就当场拦住、不往服务器发请求（服务端还有一道同样的闸）。
 */
const msg = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));
vi.mock('../utils/feedback', () => ({ message: msg }));

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../api/client', () => ({
  default: http,
  readSessionReplaced: () => null,
  clearSessionReplaced: vi.fn(),
}));

vi.mock('../api/diagnostics', () => ({
  reportClientError: vi.fn(),
  diagnoseUploadPath: vi.fn(async () => []),
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: any) => selector({ login: vi.fn(), fetchUser: vi.fn() }),
}));

import LoginPage from '../pages/LoginPage';

/** 合法身份证号（校验位算过的），免得卡在格式提示上 */
const ID_NUMBER = '110101199003077213';

async function renderRegisterForm() {
  const view = render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByText('注册新账号 →'));
  // 挂载后那一轮异步请求（工作室列表 / 前端版本号）收在 act 里，免得留下状态更新警告
  await act(async () => { await Promise.resolve(); });
  return view;
}

async function fillForm(container: HTMLElement) {
  fireEvent.change(screen.getByPlaceholderText('真实姓名 *'), { target: { value: '张三' } });
  fireEvent.change(screen.getByPlaceholderText('身份证号 *'), { target: { value: ID_NUMBER } });
  fireEvent.change(screen.getByPlaceholderText('手机号 *'), { target: { value: '13800000000' } });
  fireEvent.change(screen.getByPlaceholderText('设置密码 *'), { target: { value: 'abc123' } });
  // 工作室列表是挂载后异步拉的，先等它进 state，再开下拉
  await act(async () => { await Promise.resolve(); });
  // 工作室下拉：第 2 个 combobox（第 1 个是注册角色）
  const selectors = container.querySelectorAll('.ant-select-selector');
  fireEvent.mouseDown(selectors[1]);
  fireEvent.click(await screen.findByText('测试工作室 (线下工作室)'));
}

describe('注册必须带身份证正反面（老板 2026-10-10）', () => {
  beforeEach(() => {
    msg.warning.mockReset();
    msg.error.mockReset();
    msg.success.mockReset();
    http.get.mockReset();
    http.post.mockReset();
    http.get.mockImplementation(async (url: string) => {
      if (String(url).startsWith('/studios/public')) {
        return { data: { data: [{ id: 's1', name: '测试工作室', type: 'DIRECT' }] } };
      }
      return { data: { data: null } };
    });
    http.post.mockResolvedValue({ data: { code: 201, data: { userId: 'u1' } } });
  });

  it('注册页里再也找不到「先不带照片提交」这个跳过入口', async () => {
    await renderRegisterForm();
    expect(screen.queryByText(/先不带照片提交/)).toBeNull();
    expect(screen.queryByText(/稍后补传/)).toBeNull();
  });

  it('没传身份证就点提交：当场拦住、一条请求都不发', async () => {
    const { container } = await renderRegisterForm();
    await fillForm(container);

    fireEvent.click(screen.getByRole('button', { name: '提交注册' }));

    await waitFor(() => expect(msg.warning).toHaveBeenCalled());
    expect(String(msg.warning.mock.calls[0][0])).toContain('身份证正反面');
    expect(http.post).not.toHaveBeenCalled();
  });
});
