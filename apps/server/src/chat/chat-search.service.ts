// craftsman-ignore: TS001
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ChatSearchService {
  constructor(private readonly prisma: PrismaService) {}

  /** Search messages across user's rooms */
  async search(userId: string, query: string, roomId?: string, limit = 50) {
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
        reactions: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return messages
      .filter((m) => m.room.participantA === userId || m.room.participantB === userId)
      .map((m) => ({
        id: m.id,
        roomId: m.roomId,
        senderId: m.senderId,
        type: m.type,
        content: m.content,
        seq: m.seq,
        attachments: m.attachments,
        reactions: m.reactions,
        createdAt: m.createdAt.toISOString(),
      }));
  }

  /** Count messages matching query */
  async count(userId: string, query: string): Promise<number> {
    const rooms = await this.prisma.chatRoom.findMany({
      where: {
        OR: [{ participantA: userId }, { participantB: userId }],
      },
      select: { id: true },
    });
    const roomIds = rooms.map((r: { id: string }) => r.id);

    return this.prisma.chatMessageV3.count({
      where: {
        roomId: { in: roomIds },
        content: { contains: query, mode: 'insensitive' },
        deletedAt: null,
      },
    });
  }
}
