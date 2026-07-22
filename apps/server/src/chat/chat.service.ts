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

  // ─── Room Management ───

  /** Create or get existing ChatRoom between two users. studioId=null for cross-studio rooms. */
  async getOrCreateRoom(studioId: string, userId: string, participantId: string, orderInfo?: string) {
    const [participantA, participantB] = [userId, participantId].sort();

    // Determine if this is a cross-studio conversation
    const otherUser = await this.prisma.user.findUnique({
      where: { id: participantId },
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

    if (!room) {
      room = await this.prisma.chatRoom.create({
        data: { studioId: effectiveStudioId as any, participantA, participantB, orderInfo },
      });
    } else if (orderInfo && !room.orderInfo) {
      room = await this.prisma.chatRoom.update({
        where: { id: room.id },
        data: { orderInfo },
      });
    }

    return room;
  }

  /** List rooms for a user, including cross-studio rooms (studioId=null) */
  async listRooms(userId: string, studioId: string, opts?: { pinned?: boolean; search?: string }) {
    const baseCondition = { OR: [{ participantA: userId }, { participantB: userId }] };
    const where: any = {
      OR: [
        { studioId, ...baseCondition },
        { studioId: null, ...baseCondition },
      ],
      ...(opts?.pinned ? { pinned: true } : {}),
    };

    const rooms = await this.prisma.chatRoom.findMany({
      where,
      orderBy: [{ pinned: 'desc' }, { lastMessageAt: 'desc' }],
    });

    const result = [];
    for (const r of rooms) {
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

      const unreadCount = await this.getUnreadCount(r.id, userId);
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
      });
    }

    return result;
  }

  /** Update room metadata (pin/archive) */
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
    },
  ) {
    const { type = 'TEXT', content, attachments = [], replyToId } = data;

    // Verify sender is a participant
    const room = await this.prisma.chatRoom.findUnique({ where: { id: roomId } });
    if (!room) throw new Error('CHAT_ROOM_NOT_FOUND');
    if (room.participantA !== senderId && room.participantB !== senderId) {
      throw new Error('CHAT_NOT_PARTICIPANT');
    }

    // Validate: must have content OR attachments (except for ORDER_CARD/SYSTEM)
    if (!content && attachments.length === 0) {
      throw new Error('消息不能为空');
    }

    // Content moderation: basic sensitive word filter
    if (content && this.containsSensitiveWords(content)) {
      throw new Error('CHAT_SENSITIVE_WORD');
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
  async getRoomMessages(roomId: string, before?: number, after?: number, limit = 50) {
    const where: any = { roomId };

    if (before) {
      where.seq = { lt: before };
    }
    if (after) {
      where.seq = { gt: after };
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

    return {
      messages: result.map((m) => this.serializeMessage(m)),
      hasMore,
    };
  }

  /** Get messages since a given seq (for sync/poll) */
  async getMessagesSince(roomId: string, sinceSeq: number) {
    const messages = await this.prisma.chatMessageV3.findMany({
      where: { roomId, seq: { gt: sinceSeq } },
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
        select: { participantA: true, participantB: true },
      });
      if (!room || (room.participantA !== userId && room.participantB !== userId)) continue;

      const messages = await this.getMessagesSince(roomId, lastKnownSeq);
      if (messages.length > 0) {
        missedMessages.push(...messages.map((m) => ({ ...m, roomId })));
        updatedRooms.push({ roomId, latestSeq: messages[messages.length - 1].seq });
      }
    }

    return { missedMessages, updatedRooms };
  }

  /** Mark room as read up to a given seq */
  async markRead(roomId: string, userId: string) {
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: { participantA: true, participantB: true, lastMessageSeq: true },
    });
    if (!room) return;

    const latestSeq = room.lastMessageSeq;
    const data = room.participantA === userId ? { aReadSeq: latestSeq } : { bReadSeq: latestSeq };

    await this.prisma.chatRoom.update({ where: { id: roomId }, data });
    return latestSeq;
  }

  /** Get unread count for a user in a room */
  async getUnreadCount(roomId: string, userId: string): Promise<number> {
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: { participantA: true, participantB: true, aReadSeq: true, bReadSeq: true },
    });
    if (!room) return 0;

    const myReadSeq = room.participantA === userId ? room.aReadSeq : room.bReadSeq;

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
        studioId,
        OR: [{ participantA: userId }, { participantB: userId }],
        archived: false,
      },
      select: {
        id: true,
        participantA: true,
        participantB: true,
        aReadSeq: true,
        bReadSeq: true,
        lastMessageSeq: true,
      },
    });

    let total = 0;
    for (const r of rooms) {
      const myReadSeq = r.participantA === userId ? r.aReadSeq : r.bReadSeq;
      if (myReadSeq < r.lastMessageSeq) {
        total += await this.getUnreadCount(r.id, userId);
      }
    }

    return total;
  }

  /** Mark all rooms as read */
  async markAllRead(userId: string, studioId: string) {
    const rooms = await this.prisma.chatRoom.findMany({
      where: {
        studioId,
        OR: [{ participantA: userId }, { participantB: userId }],
      },
      select: { id: true, participantA: true, participantB: true, lastMessageSeq: true },
    });

    for (const r of rooms) {
      if (r.participantA === userId) {
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
        room: { select: { participantA: true, participantB: true } },
        attachments: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // Filter to only rooms the user participates in
    return messages
      .filter((m) => m.room.participantA === userId || m.room.participantB === userId)
      .map((m) => this.serializeMessage(m));
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
