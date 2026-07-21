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
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
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
  ) {}

  private getUserId(req: any): string {
    if (!req.user?.id) throw new UnauthorizedException('未登录');
    return req.user.id;
  }

  private getStudioId(req: any): string {
    if (!req.user?.studioId) throw new UnauthorizedException('未登录');
    return req.user.studioId;
  }

  // ── Rooms ──

  @Get('rooms')
  async listRooms(@Req() req: any, @Query('pinned') pinned?: string, @Query('search') search?: string) {
    const rooms = await this.chatService.listRooms(this.getUserId(req), this.getStudioId(req), {
      pinned: pinned === '1' || pinned === 'true',
      search,
    });
    return { data: { rooms } };
  }

  @Post('rooms')
  async createRoom(@Req() req: any, @Body() body: CreateRoomDto) {
    const room = await this.chatService.getOrCreateRoom(
      this.getStudioId(req),
      this.getUserId(req),
      body.participantId,
      body.orderInfo,
    );
    return { data: { room: { id: room.id } } };
  }

  @Patch('rooms/:id')
  @UseGuards(ParticipantGuard)
  async updateRoom(
    @Param('id') id: string,
    @Body() body: { pinned?: boolean; archived?: boolean; orderInfo?: string },
  ) {
    const room = await this.chatService.updateRoom(id, body);
    return { data: { room } };
  }

  @Post('rooms/read-all')
  async markAllRead(@Req() req: any) {
    await this.chatService.markAllRead(this.getUserId(req), this.getStudioId(req));
    return { data: { ok: true } };
  }

  // ── Messages ──

  @Get('rooms/:id/messages')
  @UseGuards(ParticipantGuard)
  async getMessages(
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
    );
    return { data: result };
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
    });

    // Load room to find other participant
    const room = await (this.chatService as any)['prisma']?.chatRoom?.findUnique?.({
      where: { id },
      select: { participantA: true, participantB: true },
    });

    if (room) {
      const otherUserId = room.participantA === senderId ? room.participantB : room.participantA;
      this.chatGateway.notifyNewMessage(otherUserId, {
        roomId: id,
        message: this.serializeMessage(message),
      });
    }

    return { data: { message: this.serializeMessage(message) } };
  }

  @Delete('rooms/:id/messages/:msgId')
  @UseGuards(ParticipantGuard)
  async recallMessage(@Req() req: any, @Param('id') roomId: string, @Param('msgId') msgId: string) {
    await this.chatService.recallMessage(roomId, msgId, this.getUserId(req));
    return { data: { ok: true } };
  }

  // ── Reactions ──

  @Post('rooms/:id/messages/:msgId/reactions')
  @UseGuards(ParticipantGuard)
  async addReaction(@Req() req: any, @Param('msgId') msgId: string, @Body() body: { emoji: string }) {
    if (!body.emoji) throw new BadRequestException('emoji is required');
    const reactions = await this.chatService.addReaction(msgId, this.getUserId(req), body.emoji);
    return { data: { reactions } };
  }

  @Delete('rooms/:id/messages/:msgId/reactions/:emoji')
  @UseGuards(ParticipantGuard)
  async removeReaction(@Req() req: any, @Param('msgId') msgId: string, @Param('emoji') emoji: string) {
    const reactions = await this.chatService.removeReaction(msgId, this.getUserId(req), emoji);
    return { data: { reactions } };
  }

  // ── Read Tracking ──

  @Post('rooms/:id/read')
  @UseGuards(ParticipantGuard)
  async markRead(@Req() req: any, @Param('id') id: string) {
    const seq = await this.chatService.markRead(id, this.getUserId(req));
    return { data: { readSeq: seq } };
  }

  @Get('unread-summary')
  async unreadSummary(@Req() req: any) {
    const total = await this.chatService.getTotalUnread(this.getUserId(req), this.getStudioId(req));
    return { data: { totalUnread: total } };
  }

  // ── Sync ──

  @Post('sync')
  async sync(@Req() req: any, @Body() body: SyncRequestDto) {
    const result = await this.chatService.syncRooms(this.getUserId(req), body.rooms);
    return { data: result };
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
    return { data: { ok: true } };
  }

  // ── Search ──

  @Get('search')
  async search(@Req() req: any, @Query('q') q: string, @Query('roomId') roomId?: string) {
    if (!q || q.trim().length === 0) throw new BadRequestException('搜索关键词不能为空');
    const results = await this.chatService.searchMessages(this.getUserId(req as any), q, roomId);
    return { data: { results } };
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
    return { data: { conversations: rooms } };
  }

  @Post('conversations')
  async legacyCreateConversation(@Req() req: any, @Body() body: { participantId: string; orderInfo?: string }) {
    const room = await this.chatService.getOrCreateRoom(
      this.getStudioId(req),
      this.getUserId(req),
      body.participantId,
      body.orderInfo,
    );
    return { data: { id: room.id } };
  }

  @Get('conversations/:id/messages')
  async legacyGetMessages(
    @Req() _req: any,
    @Param('id') id: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.chatService.getRoomMessages(
      id,
      before ? Number(before) : undefined,
      undefined,
      Number(limit) || 50,
    );
    return { data: result };
  }

  @Post('conversations/:id/messages')
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
  async legacyMarkRead(@Req() req: any, @Param('id') id: string) {
    await this.chatService.markRead(id, this.getUserId(req));
    return { data: { ok: true } };
  }

  @Get('unread-count')
  async legacyUnreadCount(@Req() req: any) {
    const total = await this.chatService.getTotalUnread(this.getUserId(req), this.getStudioId(req));
    return { data: { total } };
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
