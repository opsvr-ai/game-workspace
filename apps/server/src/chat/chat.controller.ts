// craftsman-ignore: TS001
import { Controller, Get, Post, Param, Body, Req, Query, UseGuards, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ChatService } from './chat.service';
import { WsGateway } from '../ws/ws.gateway';
import { PrismaService } from '../prisma/prisma.service';

@Controller('chat')
@UseGuards(AuthGuard('jwt'))
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly wsGateway: WsGateway,
    private readonly prisma: PrismaService,
  ) {}

  @Get('conversations')
  async listConversations(@Req() req: any) {
    if (!req.user?.id || !req.user?.studioId) {
      throw new UnauthorizedException('未登录');
    }
    const conversations = await this.chatService.listConversations(req.user.id, req.user.studioId);
    return { data: { conversations } };
  }

  @Post('conversations')
  async createConversation(@Req() req: any, @Body() body: { participantId: string; orderInfo?: string }) {
    if (!req.user?.id || !req.user?.studioId) {
      throw new UnauthorizedException('未登录');
    }
    const conv = await this.chatService.getOrCreateConversation(
      req.user.studioId,
      req.user.id,
      body.participantId,
      body.orderInfo,
    );
    return { data: { id: conv.id } };
  }

  @Get('conversations/:id/messages')
  async getMessages(
    @Req() req: any,
    @Param('id') id: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    if (!req.user?.id) throw new UnauthorizedException('未登录');
    return {
      data: await this.chatService.getConversationMessages(id, before, Number(limit) || 50),
    };
  }

  @Post('conversations/:id/messages')
  async sendMessage(@Req() req: any, @Param('id') id: string, @Body() body: { text: string }) {
    if (!req.user?.id) throw new UnauthorizedException('未登录');
    const text = (body.text || '').trim();
    if (!text || text.length > 5000) {
      return { code: 400, message: '消息不能为空且不超过5000字', data: null };
    }

    const msg = await this.chatService.sendMessage(id, req.user.id, text);

    // Notify the other participant via WebSocket
    const fullConv = await this.prisma.conversation.findUnique({
      where: { id },
      select: { participantA: true, participantB: true, orderInfo: true },
    });
    if (fullConv) {
      const otherUserId = fullConv.participantA === req.user.id ? fullConv.participantB : fullConv.participantA;
      this.wsGateway.notifyNewMessage(otherUserId, {
        conversationId: id,
        orderInfo: fullConv.orderInfo || undefined,
        message: {
          id: msg.id,
          senderId: msg.senderId,
          text: msg.text,
          createdAt: msg.createdAt.toISOString(),
        },
      });
    }

    return {
      data: {
        message: {
          id: msg.id,
          senderId: msg.senderId,
          text: msg.text,
          createdAt: msg.createdAt.toISOString(),
        },
      },
    };
  }

  @Post('conversations/:id/read')
  async markRead(@Req() req: any, @Param('id') id: string) {
    if (!req.user?.id) throw new UnauthorizedException('未登录');
    await this.chatService.markRead(id, req.user.id);
    return { data: { ok: true } };
  }

  @Get('unread-count')
  async unreadCount(@Req() req: any) {
    if (!req.user?.id || !req.user?.studioId) {
      throw new UnauthorizedException('未登录');
    }
    const total = await this.chatService.getTotalUnread(req.user.id, req.user.studioId);
    return { data: { total } };
  }

  @Get('users/:userId/profile')
  async getUserProfile(@Param('userId') userId: string) {
    const user = await this.chatService.getUserProfile(userId);
    if (!user) return { code: 404, message: '用户不存在', data: null };
    return {
      data: {
        userId: user.id,
        username: user.username,
        displayName: user.displayName || undefined,
        avatar: user.avatar || undefined,
        role: user.role,
      },
    };
  }
}
