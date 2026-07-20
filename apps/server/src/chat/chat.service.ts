import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { logger } from '../common/logger';

export interface ChatMessageData {
  id: string;
  studioId: string;
  orderId: string | null;
  senderId: string;
  senderRole: string;
  text: string;
  createdAt: Date;
}

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  /** Save a message to PostgreSQL */
  async saveMessage(data: {
    studioId: string;
    orderId?: string;
    senderId: string;
    senderRole: string;
    text: string;
  }): Promise<ChatMessageData> {
    try {
      const msg = await this.prisma.chatMessage.create({
        data: {
          studioId: data.studioId,
          orderId: data.orderId ?? null,
          senderId: data.senderId,
          senderRole: data.senderRole,
          text: data.text,
        },
      });
      return msg;
    } catch (err) {
      logger.error('Failed to save chat message', { error: (err as Error).message });
      throw err;
    }
  }

  /** Get chat history for an order */
  async getMessages(studioId: string, orderId: string, limit = 200): Promise<ChatMessageData[]> {
    try {
      return await this.prisma.chatMessage.findMany({
        where: { studioId, orderId },
        orderBy: { createdAt: 'asc' },
        take: limit,
      });
    } catch (err) {
      logger.error('Failed to fetch chat messages', { studioId, orderId, error: (err as Error).message });
      return [];
    }
  }

  /** Get pending notifications for a studio (messages in last 30 seconds) */
  async getRecentMessages(studioId: string, since: Date): Promise<ChatMessageData[]> {
    try {
      return await this.prisma.chatMessage.findMany({
        where: { studioId, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
    } catch (err) {
      logger.error('Failed to fetch recent messages', { studioId, error: (err as Error).message });
      return [];
    }
  }

  /** Get complete chat history for a companion — all orders, both directions */
  async getMessagesByCompanion(
    studioId: string,
    companionId: string,
    userId?: string,
    limit = 200,
  ): Promise<ChatMessageData[]> {
    try {
      // Resolve Companion table ID to User primary key (senderId stores User PK)
      const companion = await this.prisma.companion.findUnique({
        where: { id: companionId },
        select: { userId: true },
      });
      const otherUserId = companion?.userId || companionId;

      // Find all orderIds assigned to this companion
      const orderIds = await this.prisma.order.findMany({
        where: { companionId },
        select: { id: true },
      });
      const ids = orderIds.map((o) => o.id);

      return await this.prisma.chatMessage.findMany({
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
    } catch (err) {
      logger.error('Failed to fetch companion chat history', {
        studioId,
        companionId,
        error: (err as Error).message,
      });
      return [];
    }
  }
}
