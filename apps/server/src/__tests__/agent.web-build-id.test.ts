// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentService } from '../agent/agent.service';
import { createMockPrisma, MockPrisma } from '../__mocks__/prisma.mock';

// ---------------------------------------------------------------------------
// 回归：客户端「动不动掉线」
// 以前 deployId = Date.now().toString(36)，服务端每重启一次就变，
// 客户端下一轮心跳就整页刷新一次。现在改成读 web-dist 真实构建产物，
// 必须做到：重启/换时间都不变，只有真的发了新前端才变。
// ---------------------------------------------------------------------------
describe('AgentService.deployId (前端构建标识)', () => {
  let mockPrisma: MockPrisma;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('同一份前端产物：无论什么时候起进程，值都一样', () => {
    const first = new AgentService(mockPrisma as any);
    const idBefore = first.deployId;

    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000));

    const second = new AgentService(mockPrisma as any);
    expect(second.deployId).toBe(idBefore);
  });

  it('多次读取稳定，且不带随机性', () => {
    const service = new AgentService(mockPrisma as any);
    const ids = new Set([service.deployId, service.deployId, service.deployId]);
    expect(ids.size).toBe(1);
    expect(service.deployId.length).toBeGreaterThan(0);
  });
});

describe('AgentService.isCompanionInService (服务中不刷页面)', () => {
  let service: AgentService;
  let mockPrisma: MockPrisma;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    service = new AgentService(mockPrisma as any);
    vi.clearAllMocks();
  });

  it('状态 BUSY 时算服务中', async () => {
    mockPrisma.companion.findUnique.mockResolvedValue({ status: 'BUSY' });
    mockPrisma.orderSession.count.mockResolvedValue(0);
    await expect(service.isCompanionInService('comp-1')).resolves.toBe(true);
  });

  it('有一条进行中的服务时算服务中（含搭档位）', async () => {
    mockPrisma.companion.findUnique.mockResolvedValue({ status: 'AVAILABLE' });
    mockPrisma.orderSession.count.mockResolvedValue(1);
    await expect(service.isCompanionInService('comp-1')).resolves.toBe(true);
    expect(mockPrisma.orderSession.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'ACTIVE',
          OR: [{ companionId: 'comp-1' }, { coCompanionId: 'comp-1' }],
        }),
      }),
    );
  });

  it('空闲且没有进行中的服务时不算服务中', async () => {
    mockPrisma.companion.findUnique.mockResolvedValue({ status: 'AVAILABLE' });
    mockPrisma.orderSession.count.mockResolvedValue(0);
    await expect(service.isCompanionInService('comp-1')).resolves.toBe(false);
  });

  it('查询异常时按「不在服务中」处理，不影响心跳', async () => {
    mockPrisma.companion.findUnique.mockRejectedValue(new Error('db down'));
    mockPrisma.orderSession.count.mockRejectedValue(new Error('db down'));
    await expect(service.isCompanionInService('comp-1')).resolves.toBe(false);
  });
});
