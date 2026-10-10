// Mock PrismaService — 所有 service 单元测试共用
import { vi } from 'vitest';

export function createMockPrisma() {
  const mock = {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      // 单点登录（2026-10-01）：login() 会 `update({ data: { sessionVersion: { increment: 1 } } })`
      // 并读回新的号码写进令牌。默认给一个能读的返回值，
      // 免得所有走登录的用例都卡在这里（真实 Prisma 一定会返回这一行）。
      update: vi.fn().mockImplementation(async (args: any) => ({
        ...(args?.data || {}),
        id: args?.where?.id || 'user-001',
        sessionVersion: 1,
      })),
      delete: vi.fn(),
      count: vi.fn(),
    },
    order: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      // 抢单 / 完成 / 取消走的都是「带条件的一次性写」（updateMany + where 里夹状态），
      // 用来防并发重复抢；mock 里必须有这个方法，否则跑不到那一步。
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      delete: vi.fn(),
      // 删客户时连「从未成交」的僵尸单一起清（老板 2026-10-04）
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      aggregate: vi.fn(),
      groupBy: vi.fn(),
      // 复购兜底校验（老板 2026-10-04）：按客户数成交单 / 数自己服务过的单
      count: vi.fn(),
    },
    customer: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      delete: vi.fn(),
    },
    orderSession: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
      // 客户看板按 parentOrderId 汇总时长（今日 / 累计各一次）
      groupBy: vi.fn(),
    },
    companion: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      delete: vi.fn(),
      upsert: vi.fn(),
    },
    companionPC: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({ id: "pc-1" }),
    },
    companionTimeLog: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    systemConfig: {
      findUnique: vi.fn(),
      // findMany 默认给空数组：真实 Prisma 查到 0 条也返回 []，
      // 返回 undefined 会让「按店解析配置」（common/studio-config.ts）直接炸掉。
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
    studioConfig: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    companionStatusBlacklist: {
      findMany: vi.fn(),
    },
    customerProfile: {
      findUnique: vi.fn(),
    },
    walletTransaction: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      // 老板 2026-10-11：「他一条条记录里记错的要能点开删掉」→ deleteWalletRecord 走它
      delete: vi.fn(),
      aggregate: vi.fn(),
      count: vi.fn(),
    },
    transaction: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    expense: {
      findMany: vi.fn(),
      create: vi.fn(),
      aggregate: vi.fn(),
    },
    studio: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    pCOperationLog: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    processBlacklist: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    companionBlacklistOverride: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    processWhitelist: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      upsert: vi.fn(),
    },
    companionProcessReport: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
    processKillLog: {
      findMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    workWechat: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      delete: vi.fn(),
    },
    // 陪玩自己提交工作微信 + 管理端审核（老板 2026-10-02）
    workWechatRequest: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn().mockResolvedValue(0),
    },
    // 每日抢单名额台账（老板 2026-10-04：抢单即扣、点开能看到每天加/用多少）
    companionQuotaLog: {
      // 真实 Prisma 一定返回创建后的行；这里给个默认值，
      // 免得 `.catch()` 链在 mock 返回值 undefined 上炸掉。
      create: vi.fn().mockResolvedValue({ id: 'quota-log-1' }),
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    // 补单申请 + 到期核查（老板 2026-10-04）
    supplementRequest: {
      findUnique: vi.fn(),
      // 真库这里永远回一个 Promise（查不到就是 null）；桩也必须这样，
      // 否则调用方 `.catch(...)` 会直接炸在 undefined 上（2026-10-08 全链路复查）
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn().mockResolvedValue(0),
    },
    // 订单转让（留痕 + 申请，老板 2026-10-03：转让要经被转让方同意）
    orderTransfer: {
      create: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    orderTransferRequest: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn().mockResolvedValue(0),
    },
    // 陪玩端「申请删除」统一工单（老板 2026-10-11：客户 + 聊天消息都走申请，客服/店长批了才删，全程留痕）
    deletionRequest: {
      findUnique: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn().mockResolvedValue(0),
    },
    chatMessageV3: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
    },
    chatRoom: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    chatAuditLog: {
      create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    $queryRaw: vi.fn(),
    // 两种用法都要支持：回调式 `$transaction(async (tx) => ...)` 和数组式 `$transaction([op1, op2])`
    // （订单转让走的是数组式，两个 op 在同一事务里换手 + 落留痕）。
    $transaction: vi.fn((arg: any) => {
      if (typeof arg === 'function') return arg(mock);
      if (Array.isArray(arg)) return Promise.all(arg);
      return arg;
    }),
  };
  return mock;
}

export type MockPrisma = ReturnType<typeof createMockPrisma>;
