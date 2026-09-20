// craftsman-ignore: TS001
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  Query,
  UseGuards,
  UploadedFile,
  UseInterceptors,
  UnauthorizedException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { WsGateway } from '../ws/ws.gateway';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { UserRole } from '@chunlv/shared';
import { ParticipantGuard } from './guards/participant.guard';
import { SendMessageDto } from './dto/send-message.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { SyncRequestDto } from './dto/sync-request.dto';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { v4 as uuid } from 'uuid';

const UPLOAD_DIR = join(process.cwd(), '..', '..', 'uploads', 'chat');
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

@Controller('chat')
@UseGuards(AuthGuard('jwt'))
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly chatGateway: ChatGateway,
    @Inject(forwardRef(() => WsGateway)) private readonly wsGateway: WsGateway,
  ) {}

  private getUserId(req: any): string {
    if (!req.user?.id) throw new UnauthorizedException('未登录');
    return req.user.id;
  }

  private getStudioId(req: any): string {
    // OWNER may have null studioId — allowed, rooms will be cross-studio (studioId=null)
    return req.user?.studioId || '';
  }

  // ── Rooms ──

  @Get('studio-group')
  async getStudioGroup(@Req() req: any) {
    let studioId = this.getStudioId(req);
    if (!studioId) {
      studioId = await this.chatService.getFirstStudioId();
    }
    const room = await this.chatService.getOrCreateStudioGroup(studioId);
    if (!room) throw new BadRequestException('当前账号没有工作室');
    await this.chatService.ensureUserInStudioGroup(this.getUserId(req), studioId);
    return {
      code: 200,
      message: 'ok',
      data: {
        id: room.id,
        groupName: room.groupName || '工作室群聊',
        isGroup: true,
      },
    };
  }

  @Get('rooms')
  async listRooms(@Req() req: any, @Query('pinned') pinned?: string, @Query('search') search?: string) {
    const rooms = await this.chatService.listRooms(this.getUserId(req), this.getStudioId(req), {
      pinned: pinned === '1' || pinned === 'true',
      search,
    });
    return { code: 200, message: 'ok', data: { rooms } };
  }

  /**
   * 群聊广播：客服/店长在群聊里发一条广播，内容进群聊，
   * 同时让本工作室所有在线陪玩的电脑右下角弹出 Windows 提醒（5 秒后自动消失），
   * 解决"陪玩不看群消息、问某单接不接没人回"的问题。
   */
  @Post('studio-broadcast')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CS, UserRole.ADMIN, UserRole.OWNER)
  async studioBroadcast(@Req() req: any, @Body() body: { content?: string }) {
    const senderId = this.getUserId(req);
    let result: Awaited<ReturnType<ChatService['sendStudioBroadcast']>>;
    try {
      result = await this.chatService.sendStudioBroadcast(
        senderId,
        this.getStudioId(req),
        body?.content || '',
      );
    } catch (err: any) {
      throw new BadRequestException(err?.message || '广播发送失败');
    }
    const { studioId, room, message, sender } = result;

    // 1) 群里实时出现这条广播（开着聊天窗的人立刻看到）
    const memberIds = await this.chatService.getGroupMemberUserIds(room.id, senderId);
    const payload = {
      roomId: room.id,
      message: this.serializeMessage(message),
      isGroup: true,
      groupName: room.groupName || undefined,
      sender: sender
        ? {
            userId: sender.id,
            username: sender.username,
            displayName: sender.displayName || undefined,
            avatar: sender.avatar || undefined,
            role: sender.role,
          }
        : undefined,
    };
    for (const memberId of memberIds) {
      this.chatGateway.notifyNewMessage(memberId, payload);
    }

    // 2) 全工作室在线陪玩：本机右下角 Windows 弹窗（5 秒）
    this.wsGateway.broadcastToStudio(studioId, 'chat:broadcast', {
      roomId: room.id,
      messageId: message.id,
      senderId,
      senderName: sender?.displayName || sender?.username || '客服',
      senderRole: sender?.role || 'CS',
      content: (message.content as string) || '',
      createdAt: new Date().toISOString(),
    });

    return { code: 200, message: '广播已发送', data: { roomId: room.id, messageId: message.id } };
  }

  @Post('rooms')
  async createRoom(@Req() req: any, @Body() body: CreateRoomDto) {
    const room = await this.chatService.getOrCreateRoom(
      this.getStudioId(req),
      this.getUserId(req),
      body.participantId,
      body.orderInfo,
    );
    return { code: 200, message: 'ok', data: { room: { id: room.id } } };
  }

  @Patch('rooms/:id')
  @UseGuards(ParticipantGuard)
  async updateRoom(
    @Param('id') id: string,
    @Body() body: { pinned?: boolean; archived?: boolean; orderInfo?: string },
  ) {
    const room = await this.chatService.updateRoom(id, body);
    return { code: 200, message: 'ok', data: { room } };
  }

  @Post('rooms/read-all')
  async markAllRead(@Req() req: any) {
    await this.chatService.markAllRead(this.getUserId(req), this.getStudioId(req));
    return { code: 200, message: 'ok', data: { ok: true } };
  }

  // ── Messages ──

  @Get('rooms/:id/messages')
  @UseGuards(ParticipantGuard)
  async getMessages(
    @Req() req: any,
    @Param('id') id: string,
    @Query('before') before?: string,
    @Query('after') after?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.chatService.getRoomMessages(
      id,
      before ? Number(before) : undefined,
      after ? Number(after) : undefined,
      Number(limit) || 50,
      this.getUserId(req),
    );
    return { code: 200, message: 'ok', data: result };
  }

  @Post('rooms/:id/messages')
  @UseGuards(ParticipantGuard)
  async sendMessage(@Req() req: any, @Param('id') id: string, @Body() body: SendMessageDto) {
    const senderId = this.getUserId(req);

    const message = await this.chatService.sendMessage(id, senderId, {
      type: body.type,
      content: body.content,
      attachments: body.attachments,
      replyToId: body.replyToId,
      mentionUserIds: body.mentionUserIds,
    });

    // Load room to find other participant
    const room = await this.chatService.getRoom(id);

    if (room) {
      const senderProfile = await this.chatService.getUserProfile(senderId);
      const payload = {
        roomId: id,
        message: this.serializeMessage(message),
        sender: senderProfile
          ? {
              userId: senderProfile.id,
              username: senderProfile.username,
              displayName: senderProfile.displayName || undefined,
              avatar: senderProfile.avatar || undefined,
              role: senderProfile.role,
            }
          : undefined,
        isGroup: room.isGroup,
        groupName: room.isGroup ? room.groupName || undefined : undefined,
      };
      if (room.isGroup) {
        const memberIds = await this.chatService.getGroupMemberUserIds(id, senderId);
        for (const memberId of memberIds) {
          this.chatGateway.notifyNewMessage(memberId, payload);
        }
      } else {
        const otherUserId = room.participantA === senderId ? room.participantB : room.participantA;
        this.chatGateway.notifyNewMessage(otherUserId, payload);
      }
    }

    return { code: 200, message: 'ok', data: { message: this.serializeMessage(message) } };
  }

  @Get('rooms/:id/members')
  @UseGuards(ParticipantGuard)
  async getRoomMembers(@Param('id') id: string) {
    const members = await this.chatService.getGroupMembers(id);
    return { code: 200, message: 'ok', data: { members } };
  }

  @Delete('rooms/:id/messages/:msgId')
  @UseGuards(ParticipantGuard)
  async recallMessage(@Req() req: any, @Param('id') roomId: string, @Param('msgId') msgId: string) {
    await this.chatService.recallMessage(roomId, msgId, this.getUserId(req));
    return { code: 200, message: 'ok', data: { ok: true } };
  }

  // ── Reactions ──

  @Post('rooms/:id/messages/:msgId/reactions')
  @UseGuards(ParticipantGuard)
  async addReaction(@Req() req: any, @Param('msgId') msgId: string, @Body() body: { emoji: string }) {
    if (!body.emoji) throw new BadRequestException('emoji is required');
    const reactions = await this.chatService.addReaction(msgId, this.getUserId(req), body.emoji);
    return { code: 200, message: 'ok', data: { reactions } };
  }

  @Delete('rooms/:id/messages/:msgId/reactions/:emoji')
  @UseGuards(ParticipantGuard)
  async removeReaction(@Req() req: any, @Param('msgId') msgId: string, @Param('emoji') emoji: string) {
    const reactions = await this.chatService.removeReaction(msgId, this.getUserId(req), emoji);
    return { code: 200, message: 'ok', data: { reactions } };
  }

  // ── Read Tracking ──

  @Post('rooms/:id/read')
  @UseGuards(ParticipantGuard)
  async markRead(@Req() req: any, @Param('id') id: string) {
    const userId = this.getUserId(req);
    const { readSeq, peerUserId, isGroup } = await this.chatService.markRead(id, userId);
    // 立刻告诉发消息的人「对方已阅读」，不用等对方刷新页面。
    if (!isGroup && peerUserId) {
      this.chatGateway.notifyRead(peerUserId, { roomId: id, readerId: userId, readSeq });
    }
    return { code: 200, message: 'ok', data: { readSeq } };
  }

  @Get('unread-summary')
  async unreadSummary(@Req() req: any) {
    const total = await this.chatService.getTotalUnread(this.getUserId(req), this.getStudioId(req));
    return { code: 200, message: 'ok', data: { totalUnread: total } };
  }

  // ── Sync ──

  @Post('sync')
  async sync(@Req() req: any, @Body() body: SyncRequestDto) {
    const result = await this.chatService.syncRooms(this.getUserId(req), body.rooms);
    return { code: 200, message: 'ok', data: result };
  }

  // ── Upload ──

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, file, cb) => {
          const ext = extname(file.originalname);
          cb(null, `${uuid()}${ext}`);
        },
      }),
      limits: { fileSize: 20 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const allowed = [
          'image/png',
          'image/jpeg',
          'image/gif',
          'image/webp',
          'application/pdf',
          'application/zip',
          'audio/mp3',
          'audio/wav',
          'audio/mpeg',
        ];
        if (allowed.includes(file.mimetype || '')) {
          cb(null, true);
        } else {
          cb(new BadRequestException(`不支持的文件类型: ${file.mimetype}`), false);
        }
      },
    }),
  )
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('请选择文件');

    const url = `/uploads/chat/${file.filename}`;
    const isImage = file.mimetype?.startsWith('image/');

    return {
      data: {
        url,
        thumbnailUrl: isImage ? url : undefined,
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
        width: undefined,
        height: undefined,
        duration: undefined,
      },
    };
  }

  // ── Typing ──

  @Post('rooms/:id/typing')
  @UseGuards(ParticipantGuard)
  async typing(@Req() _req: any, @Param('id') _roomId: string, @Body() _body: { active: boolean }) {
    // Typing relay is handled via WebSocket directly
    // This REST endpoint provides HTTP fallback
    return { code: 200, message: 'ok', data: { ok: true } };
  }

  // ── Search ──

  @Get('search')
  async search(@Req() req: any, @Query('q') q: string, @Query('roomId') roomId?: string) {
    if (!q || q.trim().length === 0) throw new BadRequestException('搜索关键词不能为空');
    const results = await this.chatService.searchMessages(this.getUserId(req as any), q, roomId);
    return { code: 200, message: 'ok', data: { results } };
  }

  // ── User Profile ──

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

  // ── Legacy compatibility (during migration) ──

  @Get('conversations')
  async legacyListConversations(@Req() req: any) {
    // Redirect to new endpoint
    const rooms = await this.chatService.listRooms(this.getUserId(req), this.getStudioId(req));
    return { code: 200, message: 'ok', data: { conversations: rooms } };
  }

  @Post('conversations')
  async legacyCreateConversation(@Req() req: any, @Body() body: { participantId: string; orderInfo?: string }) {
    const room = await this.chatService.getOrCreateRoom(
      this.getStudioId(req),
      this.getUserId(req),
      body.participantId,
      body.orderInfo,
    );
    return { code: 200, message: 'ok', data: { id: room.id } };
  }

  @Get('conversations/:id/messages')
  @UseGuards(ParticipantGuard)
  async legacyGetMessages(
    @Req() req: any,
    @Param('id') id: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.chatService.getRoomMessages(
      id,
      before ? Number(before) : undefined,
      undefined,
      Number(limit) || 50,
      this.getUserId(req),
    );
    return { code: 200, message: 'ok', data: result };
  }

  @Post('conversations/:id/messages')
  @UseGuards(ParticipantGuard)
  async legacySendMessage(@Req() req: any, @Param('id') id: string, @Body() body: { text: string }) {
    const senderId = this.getUserId(req);
    const message = await this.chatService.sendMessage(id, senderId, {
      type: 'TEXT',
      content: body.text,
    });
    return {
      data: {
        message: this.serializeMessage(message),
      },
    };
  }

  @Post('conversations/:id/read')
  @UseGuards(ParticipantGuard)
  async legacyMarkRead(@Req() req: any, @Param('id') id: string) {
    const userId = this.getUserId(req);
    const { readSeq, peerUserId, isGroup } = await this.chatService.markRead(id, userId);
    if (!isGroup && peerUserId) {
      this.chatGateway.notifyRead(peerUserId, { roomId: id, readerId: userId, readSeq });
    }
    return { code: 200, message: 'ok', data: { ok: true } };
  }

  @Get('unread-count')
  async legacyUnreadCount(@Req() req: any) {
    const total = await this.chatService.getTotalUnread(this.getUserId(req), this.getStudioId(req));
    return { code: 200, message: 'ok', data: { total } };
  }

  // ── Helpers ──

  private serializeMessage(m: any): Record<string, unknown> {
    if (!m) return {};
    return {
      id: m.id,
      senderId: m.senderId,
      type: m.type,
      content: m.content,
      seq: m.seq,
      mentions: m.mentions || [],
      replyTo: m.replyTo || undefined,
      deletedAt: m.deletedAt?.toISOString?.() || m.deletedAt || undefined,
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
      reactions: (m.reactions || []).map((r: any) => ({ userId: r.userId, emoji: r.emoji })),
      createdAt: m.createdAt?.toISOString?.() || m.createdAt,
    };
  }
}
