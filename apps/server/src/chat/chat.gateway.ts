// craftsman-ignore: TS001
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

interface ConnectedUser {
  userId: string;
  username: string;
  role: string;
  studioId: string | null;
  companionId?: string;
}

/**
 * Chat 3.0 WebSocket Gateway
 * Handles real-time messaging events: typing indicators, message ACKs,
 * and pushes new messages to connected users.
 */
@WebSocketGateway({
  cors: {
    origin: (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:8000').split(','),
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  /** Map userId → socketId for direct message delivery */
  private readonly userSockets = new Map<string, string>();

  /** Map socketId → user data */
  private readonly socketUsers = new Map<string, ConnectedUser>();

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  // ─── Connection Lifecycle ───

  handleConnection(client: Socket): void {
    const user = this.extractUser(client);
    if (!user) {
      client.disconnect();
      return;
    }

    this.userSockets.set(user.userId, client.id);
    this.socketUsers.set(client.id, user);

    // Join personal room for direct message delivery
    client.join(`user:${user.userId}`);
    this.logger.log(`Chat WS connected: ${user.username} (${user.userId})`);
  }

  handleDisconnect(client: Socket): void {
    const user = this.socketUsers.get(client.id);
    if (user) {
      this.userSockets.delete(user.userId);
      this.socketUsers.delete(client.id);
      this.logger.log(`Chat WS disconnected: ${user.username}`);
    }
  }

  // ─── Inbound Events ───

  /** Client acknowledges receiving messages up to a given seq */
  @SubscribeMessage('message:ack')
  handleMessageAck(@ConnectedSocket() _client: Socket, @MessageBody() data: { roomId: string; lastSeq: number }): void {
    // Store the ACK state — used for sync gap detection
    // In production, persist to Redis for multi-instance support
    this.redis
      .setex(
        `chat:ack:${data.roomId}:${_client.data?.user?.userId}`,
        300, // TTL 5 min
        String(data.lastSeq),
      )
      .catch(() => {});
  }

  /** Typing indicator: start */
  @SubscribeMessage('typing:start')
  handleTypingStart(@ConnectedSocket() client: Socket, @MessageBody() data: { roomId: string }): void {
    const user = this.socketUsers.get(client.id);
    if (!user || !data?.roomId) return;

    // Notify the other participant in the room
    client.to(`user:${this.getOtherParticipant(data.roomId, user.userId)}`).emit('typing:notify', {
      roomId: data.roomId,
      userId: user.userId,
      userName: user.username,
      active: true,
    });
  }

  /** Typing indicator: stop */
  @SubscribeMessage('typing:stop')
  handleTypingStop(@ConnectedSocket() client: Socket, @MessageBody() data: { roomId: string }): void {
    const user = this.socketUsers.get(client.id);
    if (!user || !data?.roomId) return;

    client.to(`user:${this.getOtherParticipant(data.roomId, user.userId)}`).emit('typing:notify', {
      roomId: data.roomId,
      userId: user.userId,
      userName: user.username,
      active: false,
    });
  }

  // ─── Outbound Methods (called by ChatService/ChatController) ───

  /** Push a new message to a specific user */
  notifyNewMessage(
    userId: string,
    payload: {
      roomId: string;
      message: Record<string, unknown>;
    },
  ): void {
    const socketId = this.userSockets.get(userId);
    if (socketId) {
      this.server.to(socketId).emit('message:new', payload);

      // Store in Redis offline queue as backup
      this.redis
        .lpush(`chat:offline:${userId}:${payload.roomId}`, JSON.stringify(payload))
        .then(() => {
          this.redis.expire(`chat:offline:${userId}:${payload.roomId}`, 86400); // TTL 24h
        })
        .catch(() => {});
    } else {
      // User offline — store in Redis queue for later delivery
      this.redis
        .lpush(`chat:offline:${userId}:${payload.roomId}`, JSON.stringify(payload))
        .then(() => {
          this.redis.expire(`chat:offline:${userId}:${payload.roomId}`, 86400);
        })
        .catch(() => {});
    }
  }

  /** Deliver missed offline messages to a reconnected user */
  async deliverOfflineMessages(userId: string, roomIds: string[]): Promise<void> {
    const socketId = this.userSockets.get(userId);
    if (!socketId) return;

    for (const roomId of roomIds) {
      const key = `chat:offline:${userId}:${roomId}`;
      const messages = await this.redis.lrange(key, 0, -1).catch(() => []);
      for (const raw of messages) {
        try {
          const payload = JSON.parse(raw);
          this.server.to(socketId).emit('message:new', payload);
        } catch {
          /* skip malformed */
        }
      }
      await this.redis.del(key).catch(() => {});
    }
  }

  /** Notify a user that a room's metadata changed */
  notifyRoomUpdated(roomId: string, userId: string, data: Record<string, unknown>): void {
    const socketId = this.userSockets.get(userId);
    if (socketId) {
      this.server.to(socketId).emit('room:updated', { roomId, ...data });
    }
  }

  /** Notify a user that a message was updated (recall/edit) */
  notifyMessageUpdated(roomId: string, userId: string, message: Record<string, unknown>): void {
    const socketId = this.userSockets.get(userId);
    if (socketId) {
      this.server.to(socketId).emit('message:updated', { roomId, message });
    }
  }

  /** Trigger sync on client (gap detected) */
  requestSync(userId: string, reason: string): void {
    const socketId = this.userSockets.get(userId);
    if (socketId) {
      this.server.to(socketId).emit('sync:required', { reason });
    }
  }

  // ─── Helpers ───

  private extractUser(client: Socket): ConnectedUser | null {
    const token = client.handshake.auth?.token || client.handshake.query?.token;
    if (!token) return null;

    try {
      const jwt = require('jsonwebtoken');
      const payload = jwt.verify(token, process.env.JWT_SECRET || 'secret') as any;
      return {
        userId: payload.sub,
        username: payload.username,
        role: payload.role,
        studioId: payload.studioId || null,
        companionId: payload.companionId,
      };
    } catch {
      return null;
    }
  }

  private getOtherParticipant(roomId: string, _userId: string): string {
    // Since we don't have the room data here, emit to the room-level channel
    // The specific other-user routing is done in the main WsGateway
    return `room:${roomId}:other`;
  }
}
