import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Verifies the authenticated user is a participant of the ChatRoom
 * referenced by :id route param.
 */
@Injectable()
export class ParticipantGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;
    const roomId = request.params?.id;

    if (!userId || !roomId) {
      throw new ForbiddenException('无权访问该会话');
    }

    const room = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: { participantA: true, participantB: true },
    });

    if (!room) {
      throw new ForbiddenException('会话不存在');
    }

    if (room.participantA !== userId && room.participantB !== userId) {
      throw new ForbiddenException('无权访问该会话');
    }

    return true;
  }
}
