// craftsman-ignore: TS001
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BridgeService } from '../studios/bridge.service';

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bridgeService: BridgeService,
  ) {}

  // ─── Studio Group Room ───

  /** Get or create the single studio-wide group chat, and sync current members. */
  async getOrCreateStudioGroup(studioId: string) {
    if (!studioId) return null;

    const studio = await this.prisma.studio.findUnique({
      where: { id: studioId },
      select: { name: true },
    });
    const groupName = `${studio?.name || '工作室'}群聊`;

    let room = await this.prisma.chatRoom.findFirst({
      where: { studioId, isGroup: true },
    });

    if (!room) {
      room = await this.prisma.chatRoom.create({
        data: {
          studioId,
          participantA: 'STUDIO_GROUP',
          participantB: 'STUDIO_GROUP',
          isGroup: true,
          groupName,
        },
      });
    } else if (room.groupName !== groupName) {
      room = await this.prisma.chatRoom.update({
        where: { id: room.id },
        data: { groupName },
      });
    }

    await this.syncStudioGroupMembers(studioId, room.id);
    return room;
  }

  async getFirstStudioId(): Promise<string> {
    const studio = await this.prisma.studio.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return studio?.id || '';
  }

  /** Make sure every user currently assigned to the studio is a member of its group room. */
  async syncStudioGroupMembers(studioId: string, roomId: string) {
    const users = await this.prisma.user.findMany({
      where: { studioId },
      select: { id: true },
    });
    if (users.length === 0) return;
    await this.prisma.chatRoomMember.createMany({
      data: users.map((u) => ({ roomId, userId: u.id })),
      skipDuplicates: true,
    });
  }

  async ensureUserInStudioGroup(userId: string, studioId: string) {
    if (!userId || !studioId) return;
    const room = await this.getOrCreateStudioGroup(studioId);
    if (!room) return;
    await this.prisma.chatRoomMember.upsert({
      where: { roomId_userId: { roomId: room.id, userId } },
      update: {},
      create: { roomId: room.id, userId },
    });
  }

  async getGroupMemberUserIds(roomId: string, excludeUserId?: string): Promise<string[]> {
    const members = await this.prisma.chatRoomMember.findMany({
      where: { roomId },
      select: { userId: true },
    });
    return members
      .map((m) => m.userId)
      .filter((id) => id !== excludeUserId);
  }

  async getGroupMembers(roomId: string) {
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: { isGroup: true },
    });
    if (!room?.isGroup) return [];

    const members = await this.prisma.chatRoomMember.findMany({
      where: { roomId },
      select: { userId: true },
    });
    const userIds = members.map((m) => m.userId);
    if (userIds.length === 0) return [];

    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatar: true,
        role: true,
      },
    });
    return users.map((u) => ({
      userId: u.id,
      username: u.username,
      displayName: u.displayName || u.username,
      avatar: u.avatar || undefined,
      role: u.role,
    }));
  }

  // ─── Room Management ───

  /** Create or get existing ChatRoom between two users. studioId=null for cross-studio rooms. */
  async getOrCreateRoom(studioId: string, userId: string, participantId: string, orderInfo?: string) {
    // Normalize companionId to its underlying userId when callers pass a companion id.
    let normalizedParticipantId = participantId;
    const participantUser = await this.prisma.user.findUnique({
      where: { id: participantId },
      select: { id: true },
    });
    if (!participantUser) {
      const companion = await this.prisma.companion.findUnique({
        where: { id: participantId },
        select: { userId: true },
      });
      if (companion) {
        normalizedParticipantId = companion.userId;
      } else {
        // 防止把 roomId 等非法 id 当成参与者，创建出幽灵会话。
        throw new Error('CHAT_INVALID_PARTICIPANT');
      }
    }

    const [participantA, participantB] = [userId, normalizedParticipantId].sort();

    // Determine if this is a cross-studio conversation
    const otherUser = await this.prisma.user.findUnique({
      where: { id: normalizedParticipantId },
      select: { studioId: true },
    });
    const isCrossStudio = otherUser?.studioId && otherUser.studioId !== studioId;

    let effectiveStudioId: string | null = studioId;
    if (isCrossStudio) {
      // Verify the two studios are bridged
      const bridgedIds = await this.bridgeService.getBridgedStudioIds(studioId);
      const otherStudioId = otherUser?.studioId;
      if (!otherStudioId || !bridgedIds.includes(otherStudioId)) {
        // Not bridged — fall back to own studio (shouldn't happen in practice)
        effectiveStudioId = studioId;
      } else {
        effectiveStudioId = null; // cross-studio room
      }
    }

    // Find existing room
    let room = null;
    room = await this.prisma.chatRoom.findFirst({
      where: { studioId: effectiveStudioId as any, participantA, participantB },
    });

    // 订单信息是“当前这次会话”的上下文，不是永久属性：
    // 打开订单沟通时带上，打开普通会话（人员列表/跨店聊天）时清掉，避免旧订单信息一直挂在聊天顶部。
    const nextOrderInfo = orderInfo || null;
    if (!room) {
      room = await this.prisma.chatRoom.create({
        data: { studioId: effectiveStudioId as any, participantA, participantB, orderInfo: nextOrderInfo },
      });
    } else if ((room.orderInfo || null) !== nextOrderInfo) {
      room = await this.prisma.chatRoom.update({
        where: { id: room.id },
        data: { orderInfo: nextOrderInfo },
      });
    }

    return room;
  }

  /** List rooms for a user, including cross-studio rooms (studioId=null) */
  async listRooms(userId: string, studioId: string, opts?: { pinned?: boolean; search?: string }) {
    if (studioId) {
      await this.ensureUserInStudioGroup(userId, studioId);
    }
    const where: any = {
      OR: [
        { studioId, OR: [{ participantA: userId }, { participantB: userId }] },
        { studioId: null, OR: [{ participantA: userId }, { participantB: userId }] },
        { studioId, isGroup: true, members: { some: { userId } } },
      ],
      ...(opts?.pinned ? { pinned: true } : {}),
    };

    const rooms = await this.prisma.chatRoom.findMany({
      where,
      orderBy: [{ pinned: 'desc' }, { lastMessageAt: 'desc' }],
    });

    const result = [];
    for (const r of rooms) {
      const unreadCount = await this.getUnreadCount(r.id, userId);

      if (r.isGroup) {
        const groupName = r.groupName || '工作室群聊';
        if (opts?.search) {
          const q = opts.search.toLowerCase();
          if (!groupName.toLowerCase().includes(q) && !(r.orderInfo || '').toLowerCase().includes(q)) continue;
        }
        result.push({
          id: r.id,
          participant: {
            userId: '',
            username: groupName,
            displayName: groupName,
            avatar: undefined,
            role: 'GROUP',
            studioName: undefined,
            isCrossStudio: false,
          },
          lastMessage: r.lastMessage,
          lastMessageAt: r.lastMessageAt?.toISOString() || null,
          unreadCount,
          orderInfo: r.orderInfo || undefined,
          pinned: r.pinned,
          archived: r.archived,
          isGroup: true,
          groupName,
          groupAvatar: r.groupAvatar || undefined,
        });
        continue;
      }

      const otherUserId = r.participantA === userId ? r.participantB : r.participantA;
      const user = await this.prisma.user.findUnique({
        where: { id: otherUserId },
        select: { id: true, username: true, displayName: true, avatar: true, role: true, studioId: true },
      });
      if (!user) continue;

      // Filter by search term if provided
      if (opts?.search) {
        const q = opts.search.toLowerCase();
        const name = (user.displayName || user.username).toLowerCase();
        const orderInfo = (r.orderInfo || '').toLowerCase();
        if (!name.includes(q) && !orderInfo.includes(q)) continue;
      }

      const isCrossStudio = r.studioId === null;
      let studioName: string | undefined;
      if (isCrossStudio && user.studioId) {
        const studio = await this.prisma.studio.findUnique({
          where: { id: user.studioId },
          select: { name: true },
        });
        studioName = studio?.name;
      }

      result.push({
        id: r.id,
        participant: {
          userId: user.id,
          username: user.username,
          displayName: user.displayName || undefined,
          avatar: user.avatar || undefined,
          role: user.role,
          studioName,
          isCrossStudio,
        },
        lastMessage: r.lastMessage,
        lastMessageAt: r.lastMessageAt?.toISOString() || null,
        unreadCount,
        orderInfo: r.orderInfo || undefined,
        pinned: r.pinned,
        archived: r.archived,
        isGroup: false,
      });
    }

    return result;
  }

  /** Update room metadata (pin/archive) */
  async getRoom(roomId: string) {
    return this.prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: {
        id: true,
        studioId: true,
        participantA: true,
        participantB: true,
        isGroup: true,
        groupName: true,
      },
    });
  }

  async updateRoom(roomId: string, data: { pinned?: boolean; archived?: boolean; orderInfo?: string }) {
    return this.prisma.chatRoom.update({
      where: { id: roomId },
      data: {
        ...(data.pinned !== undefined ? { pinned: data.pinned, pinnedAt: data.pinned ? new Date() : null } : {}),
        ...(data.archived !== undefined ? { archived: data.archived } : {}),
        ...(data.orderInfo !== undefined ? { orderInfo: data.orderInfo } : {}),
      },
    });
  }

  // ─── Message Operations ───

  /**
   * 群聊广播：内容照常写进工作室群聊（群里能看到、能回看），
   * 同时返回落库结果，交给 controller 推给全工作室在线陪玩（本机 Windows 弹窗）。
   */
  async sendStudioBroadcast(senderId: string, studioId: string, content: string) {
    const text = (content || '').trim().slice(0, 500);
    if (!text) throw new Error('广播内容不能为空');
    const sid = studioId || (await this.getFirstStudioId());
    if (!sid) throw new Error('当前账号没有工作室');
    const room = await this.getOrCreateStudioGroup(sid);
    if (!room) throw new Error('当前账号没有工作室');
    await this.ensureUserInStudioGroup(senderId, sid);
    const message = await this.sendMessage(room.id, senderId, { type: 'BROADCAST', content: text });
    const sender = await this.getUserProfile(senderId);
    return { studioId: sid, room, message, sender };
  }

  /** Send a message (HTTP path — main entry for sending) */
  async sendMessage(
    roomId: string,
    senderId: string,
    data: {
      type?: string;
      content?: string;
      attachments?: Array<{
        type: string;
        url: string;
        thumbnailUrl?: string;
        fileName?: string;
        fileSize?: number;
        mimeType?: string;
        width?: number;
        height?: number;
        duration?: number;
      }>;
      replyToId?: string;
      mentionUserIds?: string[];
    },
  ) {
    const { type = 'TEXT', content, attachments = [], replyToId, mentionUserIds = [] } = data;

    // Verify sender is a participant
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: { id: true, participantA: true, participantB: true, isGroup: true },
    });
    if (!room) throw new Error('CHAT_ROOM_NOT_FOUND');
    if (room.isGroup) {
      const member = await this.prisma.chatRoomMember.findUnique({
        where: { roomId_userId: { roomId, userId: senderId } },
        select: { userId: true },
      });
      if (!member) throw new Error('CHAT_NOT_PARTICIPANT');
    } else {
      if (room.participantA !== senderId && room.participantB !== senderId) {
        throw new Error('CHAT_NOT_PARTICIPANT');
      }
    }

    // Validate: must have content OR attachments (except for ORDER_CARD/SYSTEM)
    if (!content && attachments.length === 0) {
      throw new Error('消息不能为空');
    }

    // Content moderation: basic sensitive word filter
    if (content && this.containsSensitiveWords(content)) {
      throw new Error('CHAT_SENSITIVE_WORD');
    }

    let mentions: string[] = [];
    if (room.isGroup && mentionUserIds.length > 0) {
      const members = await this.prisma.chatRoomMember.findMany({
        where: { roomId, userId: { in: mentionUserIds } },
        select: { userId: true },
      });
      mentions = members.map((m) => m.userId);
    }

    // Atomic: increment seq + create message + update room
    const [msg] = await this.prisma.$transaction([
      // Read current max seq
      this.prisma.chatRoom.findUnique({ where: { id: roomId }, select: { lastMessageSeq: true } }),
    ]);

    const nextSeq = (msg?.lastMessageSeq ?? 0) + 1;

    const [message] = await this.prisma.$transaction([
      this.prisma.chatMessageV3.create({
        data: {
          roomId,
          senderId,
          type,
          content: content?.slice(0, 5000),
          seq: nextSeq,
          mentions,
          replyToId: replyToId || null,
          attachments: attachments.length > 0 ? { create: attachments } : undefined,
        },
        include: {
          attachments: true,
          replyTo: {
            select: { id: true, type: true, content: true, senderId: true },
          },
        },
      }),
      this.prisma.chatRoom.update({
        where: { id: roomId },
        data: {
          lastMessage: content?.slice(0, 100) || `[${type}]`,
          lastMessageAt: new Date(),
          lastMessageSeq: nextSeq,
          archived: false, // un-archive on new message
        },
      }),
    ]);

    // Audit log
    await this.prisma.chatAuditLog
      .create({
        data: { roomId, userId: senderId, action: 'SEND', metadata: { messageId: message.id, seq: nextSeq } },
      })
      .catch(() => {});

    return message;
  }

  /** Get messages for a room (cursor-based pagination by seq) */
  async getRoomMessages(roomId: string, before?: number, after?: number, limit = 50, viewerId?: string) {
    const where: any = { roomId };

    // seq 是 INT4：老前端会把毫秒时间戳当游标传进来，直接查会抛
    // "Unable to fit integer value ... into an INT4" 把请求打成 500。
    // 这里统一做安全裁剪：非整数 / 超出 INT4 的游标一律忽略。
    const safeSeq = (v?: number): number | undefined => {
      const n = Number(v);
      if (!Number.isFinite(n)) return undefined;
      const i = Math.floor(n);
      if (i <= 0 || i > 2147483647) return undefined;
      return i;
    };
    const beforeSeq = safeSeq(before);
    const afterSeq = safeSeq(after);

    if (beforeSeq !== undefined) {
      where.seq = { lt: beforeSeq };
    }
    if (afterSeq !== undefined) {
      where.seq = { gt: afterSeq };
    }

    const messages = await this.prisma.chatMessageV3.findMany({
      where,
      orderBy: { seq: 'desc' },
      take: limit + 1,
      include: {
        attachments: true,
        reactions: true,
        replyTo: {
          select: { id: true, type: true, content: true, senderId: true, seq: true },
        },
      },
    });

    const hasMore = messages.length > limit;
    const result = messages.slice(0, limit).reverse();

    // 对方读到哪一条了：前端据此在「我发的消息」下面标「已阅读 / 未读」。
    // 群聊没有单条已读的概念，这里只处理 1v1。
    let peerReadSeq: number | undefined;
    if (viewerId) {
      const room = await this.prisma.chatRoom.findUnique({
        where: { id: roomId },
        select: { participantA: true, participantB: true, isGroup: true, aReadSeq: true, bReadSeq: true },
      });
      if (room && !room.isGroup) {
        peerReadSeq = room.participantA === viewerId ? room.bReadSeq : room.aReadSeq;
      }
    }

    return {
      messages: result.map((m) => this.serializeMessage(m)),
      hasMore,
      peerReadSeq,
    };
  }

  /** Get messages since a given seq (for sync/poll) */
  async getMessagesSince(roomId: string, sinceSeq: number) {
    const since = Number.isFinite(Number(sinceSeq)) && Number(sinceSeq) > 0 && Number(sinceSeq) <= 2147483647
      ? Math.floor(Number(sinceSeq))
      : 0;
    const messages = await this.prisma.chatMessageV3.findMany({
      where: { roomId, seq: { gt: since } },
      orderBy: { seq: 'asc' },
      include: {
        attachments: true,
        reactions: true,
        replyTo: {
          select: { id: true, type: true, content: true, senderId: true, seq: true },
        },
      },
    });

    return messages.map((m) => this.serializeMessage(m));
  }

  /** Bulk sync — get missed messages across rooms */
  async syncRooms(userId: string, rooms: Array<{ roomId: string; lastKnownSeq: number }>) {
    const missedMessages: any[] = [];
    const updatedRooms: any[] = [];

    for (const { roomId, lastKnownSeq } of rooms) {
      // Verify participant
      const room = await this.prisma.chatRoom.findUnique({
        where: { id: roomId },
        select: { participantA: true, participantB: true, isGroup: true },
      });
      if (!room) continue;
      if (room.isGroup) {
        const member = await this.prisma.chatRoomMember.findUnique({
          where: { roomId_userId: { roomId, userId } },
          select: { userId: true },
        });
        if (!member) continue;
      } else if (room.participantA !== userId && room.participantB !== userId) {
        continue;
      }

      const messages = await this.getMessagesSince(roomId, lastKnownSeq);
      if (messages.length > 0) {
        missedMessages.push(...messages.map((m) => ({ ...m, roomId })));
        updatedRooms.push({ roomId, latestSeq: messages[messages.length - 1].seq });
      }
    }

    return { missedMessages, updatedRooms };
  }

  /**
   * Mark room as read up to a given seq.
   * 返回 { readSeq, peerUserId, isGroup }：调用方拿 peerUserId 去推「对方已读」。
   */
  async markRead(roomId: string, userId: string) {
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: { participantA: true, participantB: true, isGroup: true, lastMessageSeq: true },
    });
    if (!room) return { readSeq: 0, peerUserId: null as string | null, isGroup: false };

    const latestSeq = room.lastMessageSeq;
    if (room.isGroup) {
      await this.prisma.chatRoomMember
        .update({
          where: { roomId_userId: { roomId, userId } },
          data: { readSeq: latestSeq },
        })
        .catch(() => null);
      return { readSeq: latestSeq, peerUserId: null as string | null, isGroup: true };
    }

    const data = room.participantA === userId ? { aReadSeq: latestSeq } : { bReadSeq: latestSeq };
    const peerUserId = room.participantA === userId ? room.participantB : room.participantA;

    await this.prisma.chatRoom.update({ where: { id: roomId }, data });
    return { readSeq: latestSeq, peerUserId, isGroup: false };
  }

  /** Get unread count for a user in a room */
  async getUnreadCount(roomId: string, userId: string): Promise<number> {
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: {
        participantA: true,
        participantB: true,
        aReadSeq: true,
        bReadSeq: true,
        isGroup: true,
      },
    });
    if (!room) return 0;

    let myReadSeq: number;
    if (room.isGroup) {
      const member = await this.prisma.chatRoomMember.findUnique({
        where: { roomId_userId: { roomId, userId } },
        select: { readSeq: true },
      });
      myReadSeq = member?.readSeq ?? 0;
    } else {
      myReadSeq = room.participantA === userId ? room.aReadSeq : room.bReadSeq;
    }

    return this.prisma.chatMessageV3.count({
      where: {
        roomId,
        senderId: { not: userId },
        seq: { gt: myReadSeq },
        deletedAt: null,
      },
    });
  }

  /** Get total unread count across all rooms */
  async getTotalUnread(userId: string, studioId: string) {
    const rooms = await this.prisma.chatRoom.findMany({
      where: {
        OR: [
          { studioId, participantA: userId, archived: false },
          { studioId, participantB: userId, archived: false },
          { studioId: null, participantA: userId, archived: false },
          { studioId: null, participantB: userId, archived: false },
          { studioId, isGroup: true, archived: false, members: { some: { userId } } },
        ],
      },
      select: { id: true },
    });

    let total = 0;
    for (const r of rooms) {
      total += await this.getUnreadCount(r.id, userId);
    }

    return total;
  }

  /** Mark all rooms as read */
  async markAllRead(userId: string, studioId: string) {
    const rooms = await this.prisma.chatRoom.findMany({
      where: {
        OR: [
          { studioId, OR: [{ participantA: userId }, { participantB: userId }] },
          { studioId, isGroup: true, members: { some: { userId } } },
        ],
      },
      select: { id: true, participantA: true, participantB: true, isGroup: true, lastMessageSeq: true },
    });

    for (const r of rooms) {
      if (r.isGroup) {
        await this.prisma.chatRoomMember.update({
          where: { roomId_userId: { roomId: r.id, userId } },
          data: { readSeq: r.lastMessageSeq },
        });
      } else if (r.participantA === userId) {
        await this.prisma.chatRoom.update({
          where: { id: r.id },
          data: { aReadSeq: r.lastMessageSeq },
        });
      } else {
        await this.prisma.chatRoom.update({
          where: { id: r.id },
          data: { bReadSeq: r.lastMessageSeq },
        });
      }
    }
  }

  // ─── Message Actions ───

  /** Recall (soft-delete) a message within 2 minute window */
  async recallMessage(roomId: string, messageId: string, userId: string) {
    const message = await this.prisma.chatMessageV3.findUnique({
      where: { id: messageId },
      select: { senderId: true, createdAt: true, deletedAt: true },
    });

    if (!message || message.senderId !== userId) {
      throw new Error('CHAT_NOT_PARTICIPANT');
    }
    if (message.deletedAt) {
      throw new Error('消息已被撤回');
    }

    const elapsed = Date.now() - message.createdAt.getTime();
    if (elapsed > 2 * 60 * 1000) {
      throw new Error('CHAT_RECALL_TIMEOUT');
    }

    await this.prisma.chatMessageV3.update({
      where: { id: messageId },
      data: { deletedAt: new Date() },
    });

    await this.prisma.chatAuditLog
      .create({
        data: { roomId, userId, action: 'RECALL', metadata: { messageId } },
      })
      .catch(() => {});
  }

  /** Add reaction to a message */
  async addReaction(messageId: string, userId: string, emoji: string) {
    const message = await this.prisma.chatMessageV3.findUnique({
      where: { id: messageId },
      select: { roomId: true },
    });
    if (!message) throw new Error('消息不存在');

    await this.prisma.messageReaction.create({
      data: { messageId, userId, emoji },
    });

    await this.prisma.chatAuditLog
      .create({
        data: { roomId: message.roomId, userId, action: 'REACT', metadata: { messageId, emoji } },
      })
      .catch(() => {});

    return this.prisma.messageReaction.findMany({ where: { messageId } });
  }

  /** Remove a reaction */
  async removeReaction(messageId: string, userId: string, emoji: string) {
    await this.prisma.messageReaction.deleteMany({
      where: { messageId, userId, emoji },
    });

    return this.prisma.messageReaction.findMany({ where: { messageId } });
  }

  // ─── User Profile ───

  async getUserProfile(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, displayName: true, avatar: true, role: true },
    });
  }

  // ─── Search ───

  async searchMessages(userId: string, query: string, roomId?: string) {
    const where: any = {
      content: { contains: query, mode: 'insensitive' },
      deletedAt: null,
    };
    if (roomId) where.roomId = roomId;

    const messages = await this.prisma.chatMessageV3.findMany({
      where,
      include: {
        room: { select: { participantA: true, participantB: true, isGroup: true } },
        attachments: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // Filter to only rooms the user participates in
    const result = [];
    for (const m of messages) {
      let allowed = m.room.participantA === userId || m.room.participantB === userId;
      if (!allowed && m.room.isGroup) {
        const member = await this.prisma.chatRoomMember.findUnique({
          where: { roomId_userId: { roomId: m.roomId, userId } },
          select: { userId: true },
        });
        allowed = !!member;
      }
      if (allowed) result.push(this.serializeMessage(m));
    }
    return result;
  }

  // ── Serialization ──

  private serializeMessage(m: any) {
    return {
      id: m.id,
      roomId: m.roomId,
      senderId: m.senderId,
      type: m.type,
      content: m.content,
      seq: m.seq,
      mentions: m.mentions || [],
      replyTo: m.replyTo || undefined,
      deletedAt: m.deletedAt?.toISOString() || undefined,
      attachments: (m.attachments || []).map((a: any) => ({
        id: a.id,
        type: a.type,
        url: a.url,
        thumbnailUrl: a.thumbnailUrl,
        fileName: a.fileName,
        fileSize: a.fileSize,
        mimeType: a.mimeType,
        width: a.width,
        height: a.height,
        duration: a.duration,
      })),
      reactions: (m.reactions || []).map((r: any) => ({
        userId: r.userId,
        emoji: r.emoji,
      })),
      createdAt: m.createdAt.toISOString(),
    };
  }

  // ── Content Moderation ──

  private SENSITIVE_WORDS = ['赌博', '赌场', '色情', '毒品', '枪支'];

  private containsSensitiveWords(text: string): boolean {
    const lower = text.toLowerCase();
    return this.SENSITIVE_WORDS.some((word) => lower.includes(word));
  }

  // ── Legacy Methods (keep during migration) ──

  async saveMessage(data: { studioId: string; orderId?: string; senderId: string; senderRole: string; text: string }) {
    return this.prisma.chatMessageLegacy.create({ data });
  }

  async getRecentMessages(studioId: string, since: Date) {
    return this.prisma.chatMessageLegacy.findMany({
      where: { studioId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async getMessages(studioId: string, orderId: string, limit = 200) {
    return this.prisma.chatMessageLegacy.findMany({
      where: { studioId, orderId },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  async getMessagesByCompanion(studioId: string, companionId: string, userId?: string, limit = 200) {
    const companion = await this.prisma.companion.findUnique({
      where: { id: companionId },
      select: { userId: true },
    });
    const otherUserId = companion?.userId || companionId;
    const orderIds = await this.prisma.order.findMany({
      where: { companionId },
      select: { id: true },
    });
    const ids = orderIds.map((o: { id: string }) => o.id);
    return this.prisma.chatMessageLegacy.findMany({
      where: {
        studioId,
        OR: [
          { senderId: otherUserId },
          ...(userId && userId !== otherUserId ? [{ senderId: userId }] : []),
          ...(otherUserId !== companionId ? [{ senderId: companionId }] : []),
          ...(ids.length > 0 ? [{ orderId: { in: ids } }] : []),
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }
}
