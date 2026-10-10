import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompanionsService } from '../companions/companions.service';
import { ForbiddenException } from '@nestjs/common';
import { createMockPrisma, type MockPrisma } from '../__mocks__/prisma.mock';
import { businessDayKey } from '../common/business-day';

function createMockRevenueService() {
  return {
    getRanking: vi.fn(),
    getWallet: vi.fn(),
    checkEntertainmentBlocked: vi.fn(),
  };
}

function createMockAttendanceService() {
  return {
    ensureAttendance: vi.fn(),
    finalizeAttendance: vi.fn(),
    getAttendance: vi.fn(),
  };
}

function createMockWechatService() {
  return {
    listWorkWechats: vi.fn(),
    addWorkWechat: vi.fn(),
    bindWechat: vi.fn(),
    unbindWechat: vi.fn(),
  };
}

function createMockExcellenceService() {
  return {
    computeForCompanions: vi.fn().mockResolvedValue(new Map()),
    computeOne: vi.fn().mockResolvedValue({ tier: 'MIDDLE', score: 0 }),
    get: vi.fn(),
  };
}

function createMockBridgeService() {
  return {
    getBridgedStudioIds: vi.fn().mockResolvedValue([]),
  };
}

describe('CompanionsService', () => {
  let service: CompanionsService;
  let mockPrisma: MockPrisma;
  let mockRevenueService: ReturnType<typeof createMockRevenueService>;
  let mockAttendanceService: ReturnType<typeof createMockAttendanceService>;
  let mockWechatService: ReturnType<typeof createMockWechatService>;
  let mockExcellenceService: ReturnType<typeof createMockExcellenceService>;
  let mockBridgeService: ReturnType<typeof createMockBridgeService>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    mockRevenueService = createMockRevenueService();
    mockAttendanceService = createMockAttendanceService();
    mockWechatService = createMockWechatService();
    mockExcellenceService = createMockExcellenceService();
    mockBridgeService = createMockBridgeService();
    const mockStudiosService = {
      resignEmployee: vi.fn().mockResolvedValue({ success: true }),
    };
    service = new CompanionsService(
      mockPrisma as any,
      mockRevenueService as any,
      mockAttendanceService as any,
      mockWechatService as any,
      mockExcellenceService as any,
      mockBridgeService as any,
      mockStudiosService as any,
    );

    // Set up default return values for additional prisma calls used by findAll
    mockPrisma.processKillLog.groupBy.mockResolvedValue([]);
    mockPrisma.processKillLog.findMany.mockResolvedValue([]);
    mockPrisma.order.groupBy.mockResolvedValue([]);
    mockPrisma.order.findMany.mockResolvedValue([]);
  });

  describe('findAll', () => {
    it('默认把已离职的人过滤掉（老板 2026-10-03：秦硕离职了还留在名单里）', async () => {
      const user = { id: 'u1', username: 'admin', role: 'ADMIN' as const, studioId: 'studio-1' };
      mockPrisma.companion.findMany.mockResolvedValue([]);

      await service.findAll(user);

      const arg = mockPrisma.companion.findMany.mock.calls.at(-1)![0] as any;
      expect(arg.where.isResigned).toBe(false);
      expect(arg.where.user).toEqual({ resignedAt: null });
    });

    it('includeResigned=true 时不加离职过滤，历史考勤 / 报表要用', async () => {
      const user = { id: 'u1', username: 'admin', role: 'ADMIN' as const, studioId: 'studio-1' };
      mockPrisma.companion.findMany.mockResolvedValue([]);

      await service.findAll(user, false, true);

      const arg = mockPrisma.companion.findMany.mock.calls.at(-1)![0] as any;
      expect(arg.where.isResigned).toBeUndefined();
      expect(arg.where.user).toBeUndefined();
      expect(arg.where.studioId).toBe('studio-1');
    });

    it('returns companions with PC status', async () => {
      const user = {
        id: 'u1',
        username: 'admin',
        role: 'ADMIN' as const,
        studioId: 'studio-1',
      };

      const companions = [
        {
          id: 'comp-1',
          status: 'ONLINE',
          user: { username: 'zhangsan' },
          pc: { currentMode: 'AUTO', isThrottled: false, lastHeartbeat: '2024-01-01T00:00:00Z' },
        },
      ];

      mockPrisma.companion.findMany.mockResolvedValue(companions);

      const result = await service.findAll(user);

      expect(mockPrisma.companion.findMany).toHaveBeenCalledWith({
        where: { studioId: 'studio-1', isResigned: false, user: { resignedAt: null } },
        include: {
          user: { select: { id: true, username: true, avatar: true, displayName: true } },
          pc: { select: { currentMode: true, isThrottled: true, lastHeartbeat: true } },
        },
      });
      // Result is decorated with processStatus and todayOrderCount
      expect(result).toHaveLength(1);
      expect(result[0].processStatus).toBe('NORMAL');
      expect(result[0].todayOrderCount).toBe(0);
    });
  });

  describe('updateStatus', () => {
    it('listPersonnel: 在线状态由服务端按服务器时间判定', async () => {
      const fresh = { lastHeartbeat: new Date(), currentMode: 'ENTERTAINMENT' };
      const stale = { lastHeartbeat: new Date(Date.now() - 10 * 60 * 1000), currentMode: null };
      const base = {
        username: 'zhangsan',
        role: 'COMPANION',
        displayName: '张三',
        avatar: null,
        isAuthorized: true,
        resignedAt: null,
        studio: { id: 'studio-1', name: '店', type: 'OWN' },
      };
      const companionRow = (pc: any, status = 'AVAILABLE') => ({
        ...base,
        id: 'u-comp',
        companion: {
          id: 'comp-1',
          status,
          games: [],
          realName: null,
          phone: null,
          monthlyRevenue: 0,
          isResigned: false,
          isSeniorStaff: false,
          pc,
        },
      });
      const owner = { id: 'u-owner', username: 'hanlei', role: 'OWNER', studioId: null };

      // 心跳新鲜 = 在线
      mockPrisma.user.findMany.mockResolvedValue([companionRow(fresh)]);
      const [online] = await service.listPersonnel(owner);
      expect(online.isOnline).toBe(true);

      // 心跳过期 = 离线（即使状态还写着空闲）
      mockPrisma.user.findMany.mockResolvedValue([companionRow(stale)]);
      const [offline] = await service.listPersonnel(owner);
      expect(offline.isOnline).toBe(false);

      // 没有心跳（老数据/没装客户端）时退回工作状态
      mockPrisma.user.findMany.mockResolvedValue([companionRow(null)]);
      const [byStatus] = await service.listPersonnel(owner);
      expect(byStatus.isOnline).toBe(true);

      // 客服：客户端心跳新鲜 = 在线，过期 = 离线
      const csRow = { ...base, id: 'cs-1', username: 'kefu01', role: 'CS', companion: null };
      mockPrisma.user.findMany.mockResolvedValue([csRow]);
      mockPrisma.systemConfig.findMany.mockResolvedValue([
        { key: 'cs.client.version.cs-1', value: { version: '1.0.0', lastSeen: new Date().toISOString() } },
      ]);
      const [csOnline] = await service.listPersonnel(owner);
      expect(csOnline.isOnline).toBe(true);

      mockPrisma.systemConfig.findMany.mockResolvedValue([
        {
          key: 'cs.client.version.cs-1',
          value: { version: '1.0.0', lastSeen: new Date(Date.now() - 30 * 60 * 1000).toISOString() },
        },
      ]);
      const [csOffline] = await service.listPersonnel(owner);
      expect(csOffline.isOnline).toBe(false);
    });

    it('companion switches own status to a non-BUSY mode', async () => {
      const companionUser = {
        id: 'u5',
        username: 'zhangsan',
        role: 'COMPANION' as const,
        studioId: 'studio-1',
        companionId: 'comp-1',
      };

      mockPrisma.companionPC.upsert.mockResolvedValue({ id: 'pc-1' });
      mockPrisma.companion.findUnique.mockResolvedValue({ status: 'AVAILABLE' });
      mockPrisma.orderSession.findFirst.mockResolvedValue(null);
      mockPrisma.companionTimeLog.findFirst.mockResolvedValue(null);
      mockPrisma.companionTimeLog.create.mockResolvedValue({ id: 'log-1' });
      // 娱乐是「要花钱」的状态：钱包里得够玩满 1 分钟，否则会被当成玩不起挡在门外（老板 2026-10-08）。
      mockPrisma.companion.findUnique.mockResolvedValue({
        status: 'AVAILABLE',
        balance: 100,
        deposit: 0,
        studioId: 'studio-1',
      });

      const updatedCompanion = { id: 'comp-1', status: 'ENTERTAINMENT' };
      mockPrisma.companion.update.mockResolvedValue(updatedCompanion);

      const result = await service.updateStatus('comp-1', 'ENTERTAINMENT', companionUser);

      expect(mockPrisma.companion.update).toHaveBeenCalledWith({
        where: { id: 'comp-1' },
        data: { status: 'ENTERTAINMENT' },
      });
      expect(result).toEqual(updatedCompanion);
    });

    it('业绩/押金不够、又没到免单线 → 当场拒绝进娱乐，娱乐名单根本不下发（老板 2026-10-08 张权那单）', async () => {
      // 线上现场：业绩 0、押金 0、娱乐费率 10 元/小时、免单线 0（= 没开）。
      // 以前不判就让他进，下一个心跳（≤30 秒）又把他踢回空闲 —— 这十几秒里娱乐名单（python.exe）
      // 和空闲名单（三角洲）各套了一遍：python 被杀、他一启动三角洲又被杀。现在进之前就拦掉。
      const companionUser = {
        id: 'u5',
        username: 'zhangsan',
        role: 'COMPANION' as const,
        studioId: 'studio-1',
        companionId: 'comp-1',
      };
      mockPrisma.companionPC.upsert.mockResolvedValue({ id: 'pc-1' });
      mockPrisma.companion.findUnique.mockResolvedValue({
        status: 'AVAILABLE',
        balance: 0,
        deposit: 0,
        studioId: 'studio-1',
      });
      mockPrisma.orderSession.findFirst.mockResolvedValue(null);
      mockPrisma.systemConfig.findMany.mockResolvedValue([
        { key: 'entertainment.hourly_rate', value: 10 },
        { key: 'entertainment.revenue_threshold', value: 0 },
      ]);

      await expect(service.updateStatus('comp-1', 'ENTERTAINMENT', companionUser)).rejects.toThrow(
        /钱包业绩 \+ 押金不够玩娱乐/,
      );
      expect(mockPrisma.companion.update).not.toHaveBeenCalled();
    });

    it('今天业绩到了免单线 → 业绩 0 也能进娱乐', async () => {
      const companionUser = {
        id: 'u5',
        username: 'zhangsan',
        role: 'COMPANION' as const,
        studioId: 'studio-1',
        companionId: 'comp-1',
      };
      mockPrisma.companionPC.upsert.mockResolvedValue({ id: 'pc-1' });
      mockPrisma.companion.findUnique.mockResolvedValue({
        status: 'AVAILABLE',
        balance: 0,
        deposit: 0,
        studioId: 'studio-1',
      });
      mockPrisma.orderSession.findFirst.mockResolvedValue(null);
      mockPrisma.companionTimeLog.findFirst.mockResolvedValue(null);
      mockPrisma.companionTimeLog.create.mockResolvedValue({ id: 'log-1' });
      mockPrisma.order.findMany.mockResolvedValue([
        { companionId: 'comp-1', coCompanionId: null, amount: 300, coAmount: null, customFields: {} },
      ]);
      mockPrisma.systemConfig.findMany.mockResolvedValue([
        { key: 'entertainment.hourly_rate', value: 10 },
        { key: 'entertainment.revenue_threshold', value: 300 },
      ]);
      mockPrisma.companion.update.mockResolvedValue({ id: 'comp-1', status: 'ENTERTAINMENT' });

      const result = await service.updateStatus('comp-1', 'ENTERTAINMENT', companionUser);
      expect(result).toEqual({ id: 'comp-1', status: 'ENTERTAINMENT' });
    });
    it('rejects a manual switch to BUSY (接单状态只能由开始服务进入)', async () => {
      const companionUser = {
        id: 'u5',
        username: 'zhangsan',
        role: 'COMPANION' as const,
        studioId: 'studio-1',
        companionId: 'comp-1',
      };

      mockPrisma.companionPC.upsert.mockResolvedValue({ id: 'pc-1' });
      mockPrisma.companion.findUnique.mockResolvedValue({ status: 'AVAILABLE' });

      await expect(service.updateStatus('comp-1', 'BUSY', companionUser)).rejects.toThrow(
        '接单状态由开始服务自动进入，无法手动切换',
      );
      expect(mockPrisma.companion.update).not.toHaveBeenCalled();
    });

    it("throws ForbiddenException when updating other's status", async () => {
      const otherUser = {
        id: 'u3',
        username: 'admin',
        role: 'ADMIN' as const,
        studioId: 'studio-1',
        companionId: undefined,
      };

      await expect(service.updateStatus('comp-1', 'BUSY', otherUser)).rejects.toThrow(ForbiddenException);

      await expect(service.updateStatus('comp-1', 'BUSY', otherUser)).rejects.toThrow('只能更新自己的状态');

      // Also test a user with a different companionId
      const otherCompanionUser = {
        id: 'u4',
        username: 'lisi',
        role: 'COMPANION' as const,
        studioId: 'studio-1',
        companionId: 'comp-2',
      };

      await expect(service.updateStatus('comp-1', 'BUSY', otherCompanionUser)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('autoRestOnIdle (无操作自动休息)', () => {
    const companionUser = {
      id: 'u5',
      username: 'zhangsan',
      role: 'COMPANION' as const,
      studioId: 'studio-1',
      companionId: 'comp-1',
    };

    const armMocks = (status: string, activeSession: any = null) => {
      mockPrisma.companionPC.upsert.mockResolvedValue({ id: 'pc-1' });
      mockPrisma.companion.findUnique.mockResolvedValue({ status });
      mockPrisma.orderSession.findFirst.mockResolvedValue(activeSession);
      mockPrisma.companionTimeLog.findFirst.mockResolvedValue(null);
      mockPrisma.companionTimeLog.create.mockResolvedValue({ id: 'log-1' });
      mockPrisma.companion.update.mockResolvedValue({ id: 'comp-1', status: 'RESTING' });
    };

    it('空闲中 1 小时无操作 → 自动切到休息', async () => {
      armMocks('AVAILABLE');

      const result = await service.autoRestOnIdle('comp-1', companionUser);

      expect(mockPrisma.companion.update).toHaveBeenCalledWith({
        where: { id: 'comp-1' },
        data: { status: 'RESTING' },
      });
      expect(result).toEqual({ id: 'comp-1', status: 'RESTING' });
    });

    it('娱乐中不自动休息：人走了照常按娱乐计费，想停自己切休息', async () => {
      // 老板 2026-10-04：「他点娱乐中 他人就没了，该计费计费 谁让他不切换的」
      armMocks('ENTERTAINMENT');

      await expect(service.autoRestOnIdle('comp-1', companionUser)).rejects.toThrow(
        '当前状态不能自动休息',
      );
      expect(mockPrisma.companion.update).not.toHaveBeenCalled();
    });

    it('接单中（有进行中会话）一律拒绝，绝不能把正在打单的机器睡过去', async () => {
      armMocks('AVAILABLE', { id: 'session-1' });

      await expect(service.autoRestOnIdle('comp-1', companionUser)).rejects.toThrow(
        '正在接单，不能自动休息',
      );
      expect(mockPrisma.companion.update).not.toHaveBeenCalled();
    });

    it('已经是休息 / 接单中 不重复切', async () => {
      armMocks('RESTING');
      await expect(service.autoRestOnIdle('comp-1', companionUser)).resolves.toEqual({
        id: 'comp-1',
        status: 'RESTING',
        alreadyInStatus: true,
      });

      armMocks('BUSY');
      await expect(service.autoRestOnIdle('comp-1', companionUser)).rejects.toThrow(
        '当前状态不能自动休息',
      );
    });

    it('只能操作自己的状态', async () => {
      await expect(
        service.autoRestOnIdle('comp-1', { ...companionUser, companionId: 'comp-2' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getRanking', () => {
    it('returns top 10 companions by revenue score', async () => {
      mockRevenueService.getRanking.mockResolvedValue([
        { name: 'Zhang San', totalAmount: 300, totalCount: 2, score: 300 },
        { name: 'lisi', totalAmount: 0, totalCount: 0, score: 0 },
      ]);

      const result = await service.getRanking('studio-1', 'revenue');

      expect(mockRevenueService.getRanking).toHaveBeenCalledWith('studio-1', 'revenue', false);
      expect(result).toHaveLength(2);
      expect(result[0].totalAmount).toBe(300);
      expect(result[0].totalCount).toBe(2);
      expect(result[0].score).toBe(300);
    });
  });

  describe('getRevenue', () => {
    it('aggregates approved transactions', async () => {
      const transactions = [
        { id: 't1', companionId: 'comp-1', amount: 100, status: 'APPROVED' },
        { id: 't2', companionId: 'comp-1', amount: 200, status: 'APPROVED' },
        { id: 't3', companionId: 'comp-1', amount: 50, status: 'APPROVED' },
      ];

      mockPrisma.transaction.findMany.mockResolvedValue(transactions);

      const result = await service.getRevenue('comp-1');

      expect(mockPrisma.transaction.findMany).toHaveBeenCalledWith({
        where: { companionId: 'comp-1', status: 'APPROVED' },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      expect(result).toEqual({
        companionId: 'comp-1',
        transactions,
        total: 350,
      });
    });
  });

  describe('getNotifyPrefs / setNotifyPrefs（订单通知偏好，老板 2026-10-08）', () => {
    it('把当前状态一起给出去 —— 陪玩端设置面板靠它写「现在到底弹不弹」', async () => {
      mockPrisma.companion.findUnique.mockResolvedValue({
        notifyWhileBusy: false,
        notifyWhileEntertainment: true,
        status: 'BUSY',
      } as any);

      const prefs = await service.getNotifyPrefs('comp-1');

      expect(prefs).toEqual({
        notifyWhileBusy: false,
        notifyWhileEntertainment: true,
        status: 'BUSY',
      });
      const arg = mockPrisma.companion.findUnique.mock.calls.at(-1)![0] as any;
      expect(arg.select.status).toBe(true);
    });

    it('查不到人也照样给默认值（接单中默认不弹、娱乐中默认弹），不炸', async () => {
      mockPrisma.companion.findUnique.mockResolvedValue(null);

      const prefs = await service.getNotifyPrefs('nobody');

      expect(prefs).toEqual({
        notifyWhileBusy: false,
        notifyWhileEntertainment: true,
        status: null,
      });
    });

    it('只改传进来的那一项，改完回读也带 status', async () => {
      mockPrisma.companion.update.mockResolvedValue({} as any);
      mockPrisma.companion.findUnique.mockResolvedValue({
        notifyWhileBusy: true,
        notifyWhileEntertainment: true,
        status: 'AVAILABLE',
      } as any);

      const prefs = await service.setNotifyPrefs('comp-1', { notifyWhileBusy: true });

      expect(mockPrisma.companion.update).toHaveBeenCalledWith({
        where: { id: 'comp-1' },
        data: { notifyWhileBusy: true },
      });
      expect(prefs).toEqual({
        notifyWhileBusy: true,
        notifyWhileEntertainment: true,
        status: 'AVAILABLE',
      });
    });
  });

  /**
   * 手工补录「今日业绩」（老板 2026-10-11）。
   * 老板原话：「我说的改动就是改动他的总业绩啊，没业绩怎么点娱乐，我要先测试娱乐」——
   * 娱乐门槛认的是「今日业绩」，所以「编辑业绩」要能把今天这个数直接设成值。
   */
  describe('updateFinance：手工补录今日业绩', () => {
    it('填了今日业绩 → 存的是「差额」并记在今天的营业日上，而且不写钱包台账', async () => {
      mockPrisma.companion.findUnique.mockResolvedValue({ monthlyRevenue: 0 } as any);
      // 今天已经打了 100 的单，老板把今日业绩设成 300 → 只补 200 的差额。
      mockPrisma.order.findMany.mockResolvedValue([
        { companionId: 'comp-1', coCompanionId: null, amount: 100, coAmount: 0, customFields: null },
      ] as any);

      await service.updateFinance('comp-1', { todayRevenue: 300 }, 'op-1');

      expect(mockPrisma.companion.update).toHaveBeenCalledTimes(1);
      const arg = mockPrisma.companion.update.mock.calls[0][0] as any;
      expect(arg.where).toEqual({ id: 'comp-1' });
      expect(arg.data.todayRevenueBoost).toBe(200);
      expect(arg.data.todayRevenueBoostDay).toBe(businessDayKey(new Date()));
      // 今日业绩不是钱，不能凭空往钱包里记一笔收入
      expect(mockPrisma.walletTransaction.create).not.toHaveBeenCalled();
    });

    it('没填今日业绩 → 一个字都不写（不能把别人的补录冲掉）', async () => {
      await service.updateFinance('comp-1', { totalRevenue: 8888 }, 'op-1');

      const boosted = mockPrisma.companion.update.mock.calls.some(
        (c: any[]) => c[0]?.data?.todayRevenueBoost !== undefined,
      );
      expect(boosted).toBe(false);
      expect(mockPrisma.order.findMany).not.toHaveBeenCalled();
    });
  });
});
