import { describe, it, expect, vi } from 'vitest';
import { PayrollController } from '../payroll/payroll.controller';

/**
 * 考勤登记：店长不能给自己登记（老板 2026-10-10）。
 *
 * 背景：店长工资 = 基本工资 + 提成 − 考勤扣款，而扣款是按 `StaffAttendance` 算的
 * （`PayrollService.generate`：缺勤 × 缺勤扣款 + 迟到 × 迟到扣款）。
 * 于是「店长能给自己登记考勤」= 变相改自己的工资，跟同一页那句
 * 「店长不能设置自己的工资」（`POST /payroll/configs` 里拦着）自相矛盾。
 *
 * 这里只守服务端这一道闸：**自己给自己**直接拒、不落库；给客服登记照旧放行；
 * 老板想给谁登记都行（店长的考勤本来就只有老板能定）。
 */
const makeController = () => {
  const service = { markAttendance: vi.fn(async (dto: any) => ({ userId: dto.userId })) } as any;
  return { controller: new PayrollController(service), service };
};

const dto = { userId: 'adm-me', date: '2026-10-10', status: 'PRESENT' };

describe('考勤登记：店长不能给自己登记（老板 2026-10-10）', () => {
  it('店长给自己登记 → 被拒，且一条都没落库', async () => {
    const { controller, service } = makeController();
    await expect(
      controller.attendance({ user: { id: 'adm-me', role: 'ADMIN' } }, dto),
    ).rejects.toThrow(/不能给自己登记考勤/);
    expect(service.markAttendance).not.toHaveBeenCalled();
  });

  it('店长给客服登记 → 照旧放行（店长管客服考勤）', async () => {
    const { controller, service } = makeController();
    const res: any = await controller.attendance(
      { user: { id: 'adm-me', role: 'ADMIN' } },
      { ...dto, userId: 'cs-1' },
    );
    expect(res.code).toBe(200);
    expect(service.markAttendance).toHaveBeenCalledTimes(1);
    expect(service.markAttendance.mock.calls[0][0].userId).toBe('cs-1');
  });

  it('老板给店长登记 → 放行（店长的考勤只有老板能定）', async () => {
    const { controller, service } = makeController();
    const res: any = await controller.attendance({ user: { id: 'owner-1', role: 'OWNER' } }, dto);
    expect(res.code).toBe(200);
    expect(service.markAttendance).toHaveBeenCalledTimes(1);
  });

  it('dto 没带 userId 时不在 controller 崩，交给 service 的校验去管', async () => {
    const { controller, service } = makeController();
    const res: any = await controller.attendance(
      { user: { id: 'adm-me', role: 'ADMIN' } },
      { date: '2026-10-10', status: 'PRESENT' } as any,
    );
    expect(res.code).toBe(200);
    expect(service.markAttendance).toHaveBeenCalledTimes(1);
  });
});
