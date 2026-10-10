import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CustomerTrackingService } from '../customer-tracking/customer-tracking.service';
import { createMockPrisma, type MockPrisma } from '../__mocks__/prisma.mock';
import { UserRole } from '@chunlv/shared';

/**
 * 陪玩端「申请删除」——老板 2026-10-11：
 * 「以后陪玩端所有的删除按钮都去掉，不要让他们随意删除，想删除得客服或者店长批准通过或者驳回，并且记录在案」。
 *
 * 这里钉住四件事：
 *   ① 陪玩只能申请删**自己发的**消息，别人的一律拦下；
 *   ② 申请单里必须留下**原文快照**（payload），批之前审核页就看得到，删完还查得到「删了什么」；
 *   ③ 审核「通过」才真的写 deletedAt，**驳回不许动原消息**；
 *   ④ 批没批都要写聊天审计日志（DELETE / DELETE_REJECTED）——「记录在案」。
 */
const companionUser = {
  id: 'u-comp-1',
  username: 'zhangsan',
  role: UserRole.COMPANION,
  studioId: 'studio-1',
  companionId: 'comp-1',
};

const bossUser = {
  id: 'u-owner-1',
  username: 'hanlei',
  role: UserRole.OWNER,
  studioId: 'studio-1',
};

function build() {
  const prisma = createMockPrisma();
  const service = new CustomerTrackingService(
    prisma as any,
    { consume: vi.fn(), refund: vi.fn() } as any,
  );
  return { prisma, service };
}

const myMessage = (over: any = {}) => ({
  id: 'msg-1',
  roomId: 'room-1',
  senderId: 'u-comp-1',
  content: '房间码 1234，进游戏加我',
  createdAt: new Date('2026-10-11T02:00:00.000Z'),
  deletedAt: null,
  ...over,
});

describe('陪玩端申请删除（客户 / 聊天消息）', () => {
  let prisma: MockPrisma;
  let service: CustomerTrackingService;

  beforeEach(() => {
    const b = build();
    prisma = b.prisma;
    service = b.service;
    prisma.chatRoom.findUnique.mockResolvedValue({ id: 'room-1', studioId: 'studio-1' } as any);
    prisma.user.findUnique.mockResolvedValue({ displayName: '张三', username: 'zhangsan' } as any);
  });

  it('只能申请删除自己发的消息：别人的直接拦下', async () => {
    prisma.chatMessageV3.findUnique.mockResolvedValue(myMessage({ senderId: 'u-comp-2' }) as any);

    await expect(
      service.submitMessageDeleteRequest(companionUser as any, {
        roomId: 'room-1',
        messageId: 'msg-1',
        reason: '发错了',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.deletionRequest.create).not.toHaveBeenCalled();
  });

  it('原因必填：不填不给提交', async () => {
    prisma.chatMessageV3.findUnique.mockResolvedValue(myMessage() as any);

    await expect(
      service.submitMessageDeleteRequest(companionUser as any, {
        roomId: 'room-1',
        messageId: 'msg-1',
        reason: '   ',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.deletionRequest.create).not.toHaveBeenCalled();
  });

  it('提交申请时把原消息内容快照进 payload，类型标成 CHAT_MESSAGE', async () => {
    prisma.chatMessageV3.findUnique.mockResolvedValue(myMessage() as any);
    prisma.deletionRequest.create.mockImplementation(async (args: any) => args.data);

    const created: any = await service.submitMessageDeleteRequest(companionUser as any, {
      roomId: 'room-1',
      messageId: 'msg-1',
      reason: '发错了',
    });

    expect(created.targetType).toBe('CHAT_MESSAGE');
    expect(created.targetId).toBe('msg-1');
    expect(created.studioId).toBe('studio-1');
    expect(created.reason).toBe('发错了');
    expect(created.payload).toMatchObject({
      roomId: 'room-1',
      text: '房间码 1234，进游戏加我',
      senderId: 'u-comp-1',
      senderName: '张三',
    });
  });

  it('同一条消息重复提交，返回还没处理的那张，不再新建', async () => {
    prisma.chatMessageV3.findUnique.mockResolvedValue(myMessage() as any);
    prisma.deletionRequest.findFirst.mockResolvedValue({ id: 'req-existing', status: 'PENDING' } as any);

    const data: any = await service.submitMessageDeleteRequest(companionUser as any, {
      roomId: 'room-1',
      messageId: 'msg-1',
      reason: '发错了',
    });

    expect(data.id).toBe('req-existing');
    expect(prisma.deletionRequest.create).not.toHaveBeenCalled();
  });

  it('审核通过聊天消息：真的写 deletedAt，并写一条 DELETE 审计', async () => {
    prisma.deletionRequest.findUnique.mockResolvedValue({
      id: 'req-1',
      targetType: 'CHAT_MESSAGE',
      targetId: 'msg-1',
      companionId: 'comp-1',
      customerId: null,
      payload: { roomId: 'room-1', text: '房间码 1234' },
    } as any);
    prisma.deletionRequest.update.mockImplementation(async (args: any) => args.data);
    prisma.chatMessageV3.update.mockResolvedValue({ id: 'msg-1' } as any);

    await service.reviewDeleteRequest(bossUser as any, 'req-1', true);

    expect(prisma.chatMessageV3.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'msg-1' } }),
    );
    expect(prisma.chatAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ roomId: 'room-1', action: 'DELETE' }),
      }),
    );
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  it('驳回聊天消息：原消息一个字不动，也要留一条 DELETE_REJECTED 审计', async () => {
    prisma.deletionRequest.findUnique.mockResolvedValue({
      id: 'req-2',
      targetType: 'CHAT_MESSAGE',
      targetId: 'msg-1',
      companionId: 'comp-1',
      customerId: null,
      payload: { roomId: 'room-1', text: '房间码 1234' },
    } as any);
    prisma.deletionRequest.update.mockImplementation(async (args: any) => args.data);

    await service.reviewDeleteRequest(bossUser as any, 'req-2', false, '证据不足');

    expect(prisma.chatMessageV3.update).not.toHaveBeenCalled();
    expect(prisma.chatAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'DELETE_REJECTED',
          metadata: expect.objectContaining({ rejectReason: '证据不足' }),
        }),
      }),
    );
  });

  it('审核通过客户删除申请：照旧把客户标成「被客户删除」（老流程没坏）', async () => {
    prisma.deletionRequest.findUnique.mockResolvedValue({
      id: 'req-3',
      targetType: 'CUSTOMER',
      targetId: 'cust-1',
      companionId: 'comp-1',
      customerId: 'cust-1',
      payload: null,
    } as any);
    prisma.deletionRequest.update.mockImplementation(async (args: any) => args.data);

    await service.reviewDeleteRequest(bossUser as any, 'req-3', true);

    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cust-1' },
        data: { isDeletedByCustomer: true },
      }),
    );
    expect(prisma.chatMessageV3.update).not.toHaveBeenCalled();
  });

  it('申请单不存在时报「删除申请不存在」', async () => {
    prisma.deletionRequest.findUnique.mockResolvedValue(null);

    await expect(service.reviewDeleteRequest(bossUser as any, 'nope', true)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
