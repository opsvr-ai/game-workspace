// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CompanionWechatService } from '../companions/companion-wechat.service';
import { createMockPrisma } from '../__mocks__/prisma.mock';

/**
 * 陪玩自己提交工作微信 + 管理端审核（老板 2026-10-02）。
 *
 *   「让陪玩自己填写自己的微信号，但是需要管理端审核，以后想换可以换，
 *    但是管理端审核过了以后才显示新的。」
 *
 * 口径：提交只是「申请」（WorkWechatRequest）；真正生效、界面上显示、抢单判重用的
 * 仍是 WorkWechat 上绑定的那一条 —— 只有管理端审核通过才会去改。
 */
describe('陪玩提交工作微信 + 管理端审核', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let svc: CompanionWechatService;

  beforeEach(() => {
    prisma = createMockPrisma();
    svc = new CompanionWechatService(prisma as any);
    vi.clearAllMocks();
    (prisma.workWechatRequest.findMany as any).mockResolvedValue([]);
    (prisma.workWechatRequest.count as any).mockResolvedValue(0);
  });

  // ── 提交 ──────────────────────────────────────────────

  it('没绑过 + 号没人用 → 写一条待审核申请（不碰 WorkWechat）', async () => {
    prisma.companion.findUnique.mockResolvedValue({ studioId: 'studio-1' });
    prisma.workWechat.findUnique.mockResolvedValue(null);
    prisma.workWechatRequest.findFirst.mockResolvedValue(null);
    prisma.workWechatRequest.create.mockImplementation(async (args: any) => ({ id: 'req-1', ...args.data }));

    const res: any = await svc.submitMyWorkWechat('companion-1', '  my_wechat01 ');
    expect(res).toMatchObject({ id: 'req-1', wechatId: 'my_wechat01', status: 'PENDING' });
    // 只建申请，绝不改绑定的工作微信
    expect(prisma.workWechat.create).not.toHaveBeenCalled();
    expect(prisma.workWechat.update).not.toHaveBeenCalled();
  });

  it('已经是当前生效的号 → 不用再提交', async () => {
    prisma.companion.findUnique.mockResolvedValue({ studioId: 'studio-1' });
    prisma.workWechat.findUnique.mockResolvedValue({ wechatId: 'my_wechat01' });

    await expect(svc.submitMyWorkWechat('companion-1', 'my_wechat01')).rejects.toThrow(ConflictException);
    expect(prisma.workWechatRequest.create).not.toHaveBeenCalled();
  });

  it('号已经绑给别的陪玩 → 拦下', async () => {
    prisma.companion.findUnique.mockResolvedValue({ studioId: 'studio-1' });
    prisma.workWechat.findUnique.mockResolvedValue({ companionId: 'someone-else', csUserId: null, type: 'COMPANION' });

    await expect(svc.submitMyWorkWechat('companion-1', 'taken123')).rejects.toThrow(ConflictException);
  });

  it('号是客服在用 → 拦下', async () => {
    prisma.companion.findUnique.mockResolvedValue({ studioId: 'studio-1' });
    prisma.workWechat.findUnique.mockResolvedValue({ companionId: null, csUserId: 'cs-1', type: 'STUDIO' });

    await expect(svc.submitMyWorkWechat('companion-1', 'cs_only')).rejects.toThrow(ConflictException);
  });

  it('号是「客服工作微信」类型（没绑人）→ 也不给陪玩用', async () => {
    prisma.companion.findUnique.mockResolvedValue({ studioId: 'studio-1' });
    prisma.workWechat.findUnique.mockResolvedValue({ companionId: null, csUserId: null, type: 'STUDIO' });

    await expect(svc.submitMyWorkWechat('companion-1', 'studio_wx')).rejects.toThrow(ConflictException);
  });

  it('已有待审核的申请 → 改成新的，不重复堆', async () => {
    prisma.companion.findUnique.mockResolvedValue({ studioId: 'studio-1' });
    prisma.workWechat.findUnique.mockResolvedValue(null);
    prisma.workWechatRequest.findFirst.mockResolvedValue({ id: 'req-old', status: 'PENDING' });
    prisma.workWechatRequest.update.mockImplementation(async (args: any) => ({ id: 'req-old', ...args.data }));

    const res: any = await svc.submitMyWorkWechat('companion-1', 'new_wechat');
    expect(res.wechatId).toBe('new_wechat');
    expect(prisma.workWechatRequest.create).not.toHaveBeenCalled();
    expect((prisma.workWechatRequest.update as any).mock.calls[0][0].where).toEqual({ id: 'req-old' });
  });

  it('空号 / 带空格 / 超长 → 400', async () => {
    await expect(svc.submitMyWorkWechat('companion-1', '   ')).rejects.toThrow(BadRequestException);
    await expect(svc.submitMyWorkWechat('companion-1', 'a b')).rejects.toThrow(BadRequestException);
    await expect(svc.submitMyWorkWechat('companion-1', 'x'.repeat(33))).rejects.toThrow(BadRequestException);
  });

  it('不是陪玩（没有 companionId）→ 403', async () => {
    await expect(svc.submitMyWorkWechat('', 'abc123')).rejects.toThrow(ForbiddenException);
  });

  // ── 审核通过 ──────────────────────────────────────────

  it('审核通过 + 号已在库里（没绑人）→ 绑给这个陪玩，申请置 APPROVED', async () => {
    prisma.workWechatRequest.findUnique.mockResolvedValue({
      id: 'req-1',
      companionId: 'companion-1',
      wechatId: 'my_wechat01',
      status: 'PENDING',
    });
    prisma.companion.findUnique.mockResolvedValue({ studioId: 'studio-1' });
    prisma.workWechat.findUnique.mockResolvedValue({
      id: 'wx-row-1',
      companionId: null,
      csUserId: null,
      type: 'COMPANION',
    });

    const res: any = await svc.approveWorkWechatRequest('req-1', 'owner-1');
    expect(res).toMatchObject({ companionId: 'companion-1', wechatId: 'my_wechat01', status: 'APPROVED' });

    // 老的号退下来（updateMany），这条号绑上去（update）
    expect(prisma.workWechat.updateMany).toHaveBeenCalled();
    const bindCall = (prisma.workWechat.update as any).mock.calls[0][0];
    expect(bindCall.where).toEqual({ id: 'wx-row-1' });
    expect(bindCall.data).toMatchObject({ companionId: 'companion-1', status: 'BOUND', type: 'COMPANION' });

    const reqUpdate = (prisma.workWechatRequest.update as any).mock.calls[0][0];
    expect(reqUpdate.data).toMatchObject({ status: 'APPROVED', reviewedById: 'owner-1' });
  });

  it('审核通过 + 号在库里没有 → 新建一条并绑定', async () => {
    prisma.workWechatRequest.findUnique.mockResolvedValue({
      id: 'req-2',
      companionId: 'companion-2',
      wechatId: 'brand_new',
      status: 'PENDING',
    });
    prisma.companion.findUnique.mockResolvedValue({ studioId: 'studio-1' });
    prisma.workWechat.findUnique.mockResolvedValue(null);

    await svc.approveWorkWechatRequest('req-2', 'owner-1');
    const createCall = (prisma.workWechat.create as any).mock.calls[0][0];
    expect(createCall.data).toMatchObject({
      studioId: 'studio-1',
      wechatId: 'brand_new',
      companionId: 'companion-2',
      status: 'BOUND',
    });
  });

  it('审核通过时号已经绑给别人 → 拒绝，且一个字都不写', async () => {
    prisma.workWechatRequest.findUnique.mockResolvedValue({
      id: 'req-3',
      companionId: 'companion-1',
      wechatId: 'taken123',
      status: 'PENDING',
    });
    prisma.companion.findUnique.mockResolvedValue({ studioId: 'studio-1' });
    prisma.workWechat.findUnique.mockResolvedValue({
      companionId: 'someone-else',
      csUserId: null,
      type: 'COMPANION',
    });

    await expect(svc.approveWorkWechatRequest('req-3', 'owner-1')).rejects.toThrow(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('同一个人其它还挂着的待审核申请 → 一并作废', async () => {
    prisma.workWechatRequest.findUnique.mockResolvedValue({
      id: 'req-4',
      companionId: 'companion-1',
      wechatId: 'wx_a',
      status: 'PENDING',
    });
    prisma.companion.findUnique.mockResolvedValue({ studioId: 'studio-1' });
    prisma.workWechat.findUnique.mockResolvedValue(null);

    await svc.approveWorkWechatRequest('req-4', 'owner-1');
    const calls = (prisma.workWechatRequest.updateMany as any).mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0][0].where).toMatchObject({ companionId: 'companion-1', status: 'PENDING' });
    expect(calls[0][0].data).toMatchObject({ status: 'REJECTED' });
  });

  it('申请不存在 → 404', async () => {
    prisma.workWechatRequest.findUnique.mockResolvedValue(null);
    await expect(svc.approveWorkWechatRequest('nope', 'owner-1')).rejects.toThrow(NotFoundException);
    await expect(svc.rejectWorkWechatRequest('nope', 'x', 'owner-1')).rejects.toThrow(NotFoundException);
  });

  // ── 驳回 ──────────────────────────────────────────────

  it('驳回：只把申请置 REJECTED，当前生效的号不动', async () => {
    prisma.workWechatRequest.findUnique.mockResolvedValue({
      id: 'req-5',
      companionId: 'companion-1',
      wechatId: 'bad_wx',
      status: 'PENDING',
    });
    prisma.workWechatRequest.update.mockImplementation(async (args: any) => ({ id: 'req-5', ...args.data }));

    const res: any = await svc.rejectWorkWechatRequest('req-5', '这个号不是你的', 'owner-1');
    expect(res.status).toBe('REJECTED');
    expect(prisma.workWechat.update).not.toHaveBeenCalled();
    expect(prisma.workWechat.updateMany).not.toHaveBeenCalled();
    const call = (prisma.workWechatRequest.update as any).mock.calls[0][0];
    expect(call.data).toMatchObject({ status: 'REJECTED', rejectReason: '这个号不是你的', reviewedById: 'owner-1' });
  });

  // ── 陪玩查看自己 ──────────────────────────────────────

  it('陪玩看自己：生效的号 + 审核中的申请 + 最近被驳回的', async () => {
    prisma.workWechat.findUnique.mockResolvedValue({ wechatId: 'now_wx', nickname: '我的号' });
    prisma.workWechatRequest.findFirst
      .mockResolvedValueOnce({ id: 'p1', wechatId: 'pending_wx', createdAt: new Date('2026-10-02T01:00:00Z') })
      .mockResolvedValueOnce({ id: 'r1', wechatId: 'old_wx', rejectReason: '不是你的号', reviewedAt: new Date('2026-10-01T01:00:00Z') });

    const res: any = await svc.getMyWorkWechat('companion-1');
    expect(res.effective).toBe('now_wx');
    expect(res.effectiveNickname).toBe('我的号');
    expect(res.pending).toMatchObject({ id: 'p1', wechatId: 'pending_wx' });
    expect(res.lastRejected).toMatchObject({ id: 'r1', wechatId: 'old_wx', reason: '不是你的号' });
  });

  it('陪玩还没绑过任何号 → effective 是 null，也不报错', async () => {
    prisma.workWechat.findUnique.mockResolvedValue(null);
    prisma.workWechatRequest.findFirst.mockResolvedValue(null);

    const res: any = await svc.getMyWorkWechat('companion-1');
    expect(res.effective).toBeNull();
    expect(res.pending).toBeNull();
    expect(res.lastRejected).toBeNull();
  });

  // ── 管理端列表 / 计数 ─────────────────────────────────

  it('管理端列表：按状态筛 + 带陪玩名字', async () => {
    await svc.listWorkWechatRequests('studio-1', 'PENDING');
    const where = (prisma.workWechatRequest.findMany as any).mock.calls[0][0].where;
    expect(where).toEqual({ studioId: 'studio-1', status: 'PENDING' });
  });

  it('老板（全站）看所有工作室的提交，并带上工作室名字', async () => {
    (prisma.workWechatRequest.findMany as any).mockResolvedValue([
      { id: 'a', studioId: 'st-1' },
      { id: 'b', studioId: 'st-2' },
    ]);
    (prisma.studio.findMany as any).mockResolvedValue([
      { id: 'st-1', name: '蠢驴电竞' },
      { id: 'st-2', name: '光耀电竞' },
    ]);

    const rows: any = await svc.listWorkWechatRequests('st-first', undefined, { allStudios: true });
    // 老板不带工作室过滤
    expect((prisma.workWechatRequest.findMany as any).mock.calls[0][0].where).toEqual({});
    expect(rows.map((r: any) => r.studioName)).toEqual(['蠢驴电竞', '光耀电竞']);
  });

  it('店长 / 客服只看自己店（带工作室过滤）', async () => {
    (prisma.workWechatRequest.findMany as any).mockResolvedValue([]);
    await svc.listWorkWechatRequests('st-1', 'PENDING', { allStudios: false });
    expect((prisma.workWechatRequest.findMany as any).mock.calls[0][0].where).toEqual({
      studioId: 'st-1',
      status: 'PENDING',
    });
  });

  it('待审核计数', async () => {
    (prisma.workWechatRequest.count as any).mockResolvedValue(3);
    const n = await svc.countPendingWorkWechatRequests('studio-1');
    expect(n).toBe(3);
    expect((prisma.workWechatRequest.count as any).mock.calls[0][0].where).toEqual({
      status: 'PENDING',
      studioId: 'studio-1',
    });
  });
});
