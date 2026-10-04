// craftsman-ignore: TS001
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WsGateway } from '../ws/ws.gateway';

/**
 * 老板 2026-10-04：「其他需要交互的地方也都双方都能提示了么」——
 * 补齐报账 / 支取 / 战绩图 / 客户删除申请 / 封存解封 / 桥接 / 注册的双向提示后，
 * 这里盯住通用通道本身：管理端一侧要发给「本店客服+店长 + 全站老板」，陪玩一侧只发给本人。
 */
function setup() {
  const prisma = {
    user: { findMany: vi.fn().mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]) },
  };
  const gw: any = new WsGateway(
    {} as any,
    prisma as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  gw.notifyUser = vi.fn();
  gw.notifyCompanion = vi.fn();
  return { gw, prisma };
}

describe('通用审核提醒（review:notice）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('管理端提醒发到本店客服/店长 + 全站老板每个人', async () => {
    const { gw, prisma } = setup();
    await gw.notifyStudioManagers('s1', 'review:notice', { title: 'x' });

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        isAuthorized: true,
        role: { in: ['OWNER', 'ADMIN', 'CS'] },
        OR: [{ studioId: 's1' }, { role: 'OWNER', studioId: null }],
      },
      select: { id: true },
    });
    expect(gw.notifyUser).toHaveBeenCalledTimes(2);
    expect(gw.notifyUser).toHaveBeenCalledWith('u1', 'review:notice', { title: 'x' });
    expect(gw.notifyUser).toHaveBeenCalledWith('u2', 'review:notice', { title: 'x' });
  });

  it('没有工作室时只找全站老板（不留全局广播）', async () => {
    const { gw, prisma } = setup();
    await gw.notifyStudioManagers(null, 'review:notice', { title: 'x' });
    expect(prisma.user.findMany.mock.calls[0][0].where).toMatchObject({ role: 'OWNER' });
    expect(prisma.user.findMany.mock.calls[0][0].where.OR).toBeUndefined();
  });

  it('陪玩一侧只发给本人，带 audience=COMPANION', () => {
    const { gw } = setup();
    gw.notifyCompanionNotice('c1', { title: '报账已通过' });
    expect(gw.notifyCompanion).toHaveBeenCalledWith('c1', 'review:notice', {
      title: '报账已通过',
      audience: 'COMPANION',
    });
  });

  it('查询失败时静默跳过，不把业务接口带崩', async () => {
    const { gw, prisma } = setup();
    prisma.user.findMany.mockRejectedValue(new Error('db down'));
    await expect(gw.notifyStudioManagers('s1', 'review:notice', {})).resolves.toBeUndefined();
    expect(gw.notifyUser).not.toHaveBeenCalled();
  });
});
