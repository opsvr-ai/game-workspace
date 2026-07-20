import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  /** Create or get existing conversation between two users */
  async getOrCreateConversation(studioId: string, userId: string, participantId: string, orderInfo?: string) {
    const participantA = [userId, participantId].sort()[0];
    const participantB = [userId, participantId].sort()[1];

    let conv = await this.prisma.conversation.findUnique({
      where: { studioId_participantA_participantB: { studioId, participantA, participantB } },
    });

    if (!conv) {
      conv = await this.prisma.conversation.create({
        data: { studioId, participantA, participantB, orderInfo },
      });
    } else if (orderInfo && !conv.orderInfo) {
      // Update orderInfo if not previously set
      conv = await this.prisma.conversation.update({
        where: { id: conv.id },
        data: { orderInfo },
      });
    }

    return conv;
  }

  /** List conversations for a user, resolving participant info */
  async listConversations(userId: string, studioId: string) {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        studioId,
        OR: [{ participantA: userId }, { participantB: userId }],
      },
      orderBy: { lastMessageAt: 'desc' },
    });

    // Resolve participant info for the OTHER user in each conversation
    const result = [];
    for (const c of conversations) {
      const otherUserId = c.participantA === userId ? c.participantB : c.participantA;
      const user = await this.prisma.user.findUnique({
        where: { id: otherUserId },
        select: { id: true, username: true, displayName: true, avatar: true, role: true },
      });
      if (!user) continue;

      const unreadCount = await this.getUnreadCount(c.id, userId);

      result.push({
        id: c.id,
        participant: {
          userId: user.id,
          username: user.username,
          displayName: user.displayName || undefined,
          avatar: user.avatar || undefined,
          role: user.role,
        },
        lastMessage: c.lastMessage,
        lastMessageAt: c.lastMessageAt?.toISOString() || null,
        unreadCount,
      });
    }

    return result;
  }

  /** Send a message */
  async sendMessage(conversationId: string, senderId: string, text: string) {
    // Verify sender is a participant
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conv) throw new Error('Conversation not found');
    if (conv.participantA !== senderId && conv.participantB !== senderId) {
      throw new Error('Sender is not a participant');
    }

    const msg = await this.prisma.chatMessage.create({
      data: { conversationId, senderId, text },
    });

    // Update conversation last message
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessage: text.slice(0, 100), lastMessageAt: new Date() },
    });

    return msg;
  }

  /** Get messages for a conversation (cursor-based pagination) */
  async getConversationMessages(conversationId: string, before?: string, limit = 50) {
    const where: { conversationId: string; createdAt?: { lt: Date } } = { conversationId };
    if (before) {
      where.createdAt = { lt: new Date(before) };
    }

    const messages = await this.prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });

    const hasMore = messages.length > limit;
    const result = messages.slice(0, limit).reverse();

    return {
      messages: result.map((m) => ({
        id: m.id,
        senderId: m.senderId,
        text: m.text,
        createdAt: m.createdAt.toISOString(),
      })),
      hasMore,
    };
  }

  /** Mark conversation as read */
  async markRead(conversationId: string, userId: string) {
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conv) return;

    const now = new Date();
    if (conv.participantA === userId) {
      await this.prisma.conversation.update({ where: { id: conversationId }, data: { aReadAt: now } });
    } else if (conv.participantB === userId) {
      await this.prisma.conversation.update({ where: { id: conversationId }, data: { bReadAt: now } });
    }
  }

  /** Get unread count for a user in a conversation */
  async getUnreadCount(conversationId: string, userId: string) {
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conv) return 0;

    const myReadAt = conv.participantA === userId ? conv.aReadAt : conv.bReadAt;
    if (!myReadAt) {
      // Never read — count all messages not from this user
      return this.prisma.chatMessage.count({
        where: { conversationId, senderId: { not: userId } },
      });
    }

    return this.prisma.chatMessage.count({
      where: {
        conversationId,
        senderId: { not: userId },
        createdAt: { gt: myReadAt },
      },
    });
  }

  /** Get total unread count across all conversations */
  async getTotalUnread(userId: string, studioId: string) {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        studioId,
        OR: [{ participantA: userId }, { participantB: userId }],
      },
      select: { id: true, participantA: true, participantB: true, aReadAt: true, bReadAt: true },
    });

    let total = 0;
    for (const c of conversations) {
      total += await this.getUnreadCount(c.id, userId);
    }
    return total;
  }

  /** Get user profile for chat display */
  async getUserProfile(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, displayName: true, avatar: true, role: true },
    });
  }

  // ── Legacy methods (keep old endpoints working during migration) ──

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
