import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * 「考勤设置」里「店长考勤」那一块只有老板能改（老板 2026-10-10）。
 *
 * 老板问「店长自己设置自己的工资跟考勤？」—— 工资那边本来就是只读（`POST /payroll/configs`
 * 拦着），考勤这边却留着两个口子：① 手动登记能选到自己；② 这一块的开关 / 上下班时间店长也能拨。
 * 而店长工资里的「迟到 / 缺勤扣款」就是按这套考勤算的 → 等于自己改自己的工资。
 *
 * 服务端那道闸在 `common/default-config.ts`（`attendance.manager.*` 归 OWNER_ONLY，店长保存会被跳过）
 * 和 `payroll.controller.ts`（店长给自己登记考勤直接 403），各有一条用例；
 * 这里守的是**界面这一侧**：店长看到的是只读的，保存时也不把这几个键打包发出去。
 */
const h = vi.hoisted(() => ({ role: 'ADMIN' as string }));

vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: any) => selector({ user: { id: 'u-self', username: 'me', role: h.role } }),
}));

const configApi = vi.hoisted(() => ({ getAll: vi.fn(), update: vi.fn() }));
vi.mock('../api/config', () => ({ configApi }));

vi.mock('../utils/feedback', () => ({
  message: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

import AttendanceSettings from '../pages/settings/AttendanceSettings';

const CFG: Record<string, any> = {
  'attendance.companion.enabled': false,
  'attendance.workStart': '09:00',
  'attendance.workEnd': '18:00',
  'attendance.cs.enabled': true,
  'attendance.cs.workStart': '09:00',
  'attendance.cs.workEnd': '18:00',
  'attendance.manager.enabled': true,
  'attendance.manager.workStart': '09:00',
  'attendance.manager.workEnd': '18:00',
};

describe('考勤设置：店长考勤只有老板能改（老板 2026-10-10）', () => {
  beforeEach(() => {
    h.role = 'ADMIN';
    configApi.getAll.mockReset();
    configApi.update.mockReset();
    configApi.getAll.mockResolvedValue({ data: { data: { ...CFG } } });
    configApi.update.mockResolvedValue({ data: { data: { saved: [], skipped: [] } } });
  });

  it('店长：三块开关都在，但「店长考勤」那一块锁住、挂「老板专属」标', async () => {
    render(<AttendanceSettings />);
    const switches = await screen.findAllByRole('switch');
    expect(switches).toHaveLength(3); // 陪玩 / 客服 / 店长
    expect(switches[1]).not.toBeDisabled(); // 客服考勤：店长照旧自己设
    expect(switches[2]).toBeDisabled(); // 店长考勤：只读
    expect(screen.getByText('老板专属 · 只能查看')).toBeInTheDocument();
    expect(screen.getByText(/这一块由老板设置，你只能查看/)).toBeInTheDocument();
  });

  it('店长点保存：只提交客服（和陪玩）那两块，不打包 attendance.manager.*', async () => {
    render(<AttendanceSettings />);
    await screen.findAllByRole('switch');
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));
    await waitFor(() => expect(configApi.update).toHaveBeenCalledTimes(1));
    const body = configApi.update.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(body).some((k) => k.startsWith('attendance.manager.'))).toBe(false);
    expect(body['attendance.cs.enabled']).toBe(true);
    expect(body['attendance.companion.enabled']).toBe(false);
  });

  it('老板：「店长考勤」不锁，保存时照旧带上这几个键', async () => {
    h.role = 'OWNER';
    render(<AttendanceSettings />);
    const switches = await screen.findAllByRole('switch');
    expect(switches[2]).not.toBeDisabled();
    expect(screen.queryByText('老板专属 · 只能查看')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /保存/ }));
    await waitFor(() => expect(configApi.update).toHaveBeenCalledTimes(1));
    const body = configApi.update.mock.calls[0][0] as Record<string, unknown>;
    expect(body['attendance.manager.enabled']).toBe(true);
    expect(body['attendance.manager.workStart']).toBe('09:00');
    expect(body['attendance.manager.workEnd']).toBe('18:00');
  });
});
