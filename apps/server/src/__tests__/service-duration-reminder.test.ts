// craftsman-ignore: TS001
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServiceDurationReminderService } from '../orders/service-duration-reminder.service';

/**
 * 老板 2026-10-05：「你也给陪玩提示一下，不点结束不会计入影响评分增加，让他们主动点」——
 * 这条服务端提醒现在两件事一起做：
 *   ① 文案里必须写清「不点结束 = 不计业绩、不算分」；
 *   ② 只要这段还挂着没点「结束服务」，**每 30 分钟再提醒一次**（以前只提醒一次、之后再也不吭声，
 *      陪玩就一直挂着不点结束 —— 那这一单在业绩 / 首单成功率 / 续单率 / 复购率里全都不算数）。
 */

const HOUR = 3600 * 1000;
const MIN = 60 * 1000;

function setup(rows: any[]) {
  const pushed: any[] = [];
  const updated: any[] = [];
  const prisma = {
    orderSession: {
      findMany: vi.fn(() => Promise.resolve(rows)),
      update: vi.fn((args: any) => {
        updated.push(args);
        return Promise.resolve({});
      }),
    },
  };
  const ws = {
    pushToCompanion: vi.fn((id: string, event: string, data: any) => {
      pushed.push({ id, event, data });
    }),
  };
  const svc = new ServiceDurationReminderService(prisma as any, ws as any);
  return { svc, pushed, updated, prisma };
}

const row = (over: any = {}) => ({
  id: 's1',
  companionId: 'c1',
  duration: 1,
  startedAt: new Date(Date.now() - 2 * HOUR),
  durationRemindedAt: null,
  parentOrder: { id: 'o1', gameName: '三角洲行动' },
  ...over,
});

describe('服务时长到点提醒（不点结束就一直提醒）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('还没到点：不提醒', async () => {
    const { svc, pushed } = setup([row({ startedAt: new Date(Date.now() - 10 * MIN) })]);
    await svc.tick();
    expect(pushed).toHaveLength(0);
  });

  it('到点：推一条，文案写清「不点结束不计业绩 / 不算分」，并记下这次提醒时间', async () => {
    const { svc, pushed, updated } = setup([row()]);
    await svc.tick();
    expect(pushed).toHaveLength(1);
    expect(pushed[0].id).toBe('c1');
    expect(pushed[0].event).toBe('service:duration_reminder');
    expect(pushed[0].data.message).toContain('结束服务');
    expect(pushed[0].data.message).toContain('续单'); // 客户接着打就先点续单，别让人白打
    expect(pushed[0].data.message).toContain('不计业绩');
    expect(pushed[0].data.message).toContain('不算首单成交');
    expect(pushed[0].data.overdueMin).toBeGreaterThan(50);
    expect(updated).toHaveLength(1);
    expect(updated[0].data.durationRemindedAt).toBeInstanceOf(Date);
  });

  it('刚提醒过（10 分钟前）：不再打扰', async () => {
    const { svc, pushed } = setup([row({ durationRemindedAt: new Date(Date.now() - 10 * MIN) })]);
    await svc.tick();
    expect(pushed).toHaveLength(0);
  });

  it('提醒过但已经过了 30 分钟、单还挂着：再提醒一次（一直提醒到点结束）', async () => {
    const { svc, pushed } = setup([row({ durationRemindedAt: new Date(Date.now() - 31 * MIN) })]);
    await svc.tick();
    expect(pushed).toHaveLength(1);
    expect(pushed[0].data.message).toContain('超时');
  });

  it('超时很久：文案带上「已经超时 X 小时 Y 分钟」', async () => {
    const { svc, pushed } = setup([row({ startedAt: new Date(Date.now() - 5 * HOUR), duration: 1 })]);
    await svc.tick();
    expect(pushed[0].data.message).toContain('已经超时 4 小时');
  });

  it('没有陪玩（companionId 为空）：只记提醒时间，不推送', async () => {
    const { svc, pushed, updated } = setup([row({ companionId: null })]);
    await svc.tick();
    expect(pushed).toHaveLength(0);
    expect(updated).toHaveLength(1);
  });
});
