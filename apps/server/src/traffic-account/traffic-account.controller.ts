import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { UserRole } from '@chunlv/shared';
import type { ApiResponse } from '@chunlv/shared';
import { TrafficAccountService } from './traffic-account.service';

@Controller('traffic-accounts')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.CS, UserRole.COMPANION)
export class TrafficAccountController {
  constructor(private readonly service: TrafficAccountService) {}

  @Get()
  async list(@Req() req: any, @Query('scope') scope?: string): Promise<ApiResponse<unknown>> {
    return { code: 200, message: 'ok', data: await this.service.list(req.user, scope) };
  }

  @Post()
  async create(@Req() req: any, @Body() dto: any): Promise<ApiResponse<unknown>> {
    return { code: 201, message: '已添加', data: await this.service.create(req.user, dto) };
  }

  @Put(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() dto: any): Promise<ApiResponse<unknown>> {
    return { code: 200, message: '已更新', data: await this.service.update(req.user, id, dto) };
  }

  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string): Promise<ApiResponse<unknown>> {
    return { code: 200, message: '已删除', data: await this.service.remove(req.user, id) };
  }

  // ── 笔记记录（小红书数据分析） ──

  @Get(':accountId/notes')
  async listNotes(@Req() req: any, @Param('accountId') accountId: string): Promise<ApiResponse<unknown>> {
    return { code: 200, message: 'ok', data: await this.service.listNotes(req.user, accountId) };
  }

  @Post(':accountId/notes')
  async createNote(@Req() req: any, @Param('accountId') accountId: string, @Body() dto: any): Promise<ApiResponse<unknown>> {
    return { code: 201, message: '已添加笔记', data: await this.service.createNote(req.user, accountId, dto) };
  }

  @Put('note/:noteId')
  async updateNote(@Req() req: any, @Param('noteId') noteId: string, @Body() dto: any): Promise<ApiResponse<unknown>> {
    return { code: 200, message: '已更新笔记', data: await this.service.updateNote(req.user, noteId, dto) };
  }

  @Delete('note/:noteId')
  async removeNote(@Req() req: any, @Param('noteId') noteId: string): Promise<ApiResponse<unknown>> {
    return { code: 200, message: '已删除笔记', data: await this.service.removeNote(req.user, noteId) };
  }

  @Post(':accountId/notes/analyze')
  async analyzeNotes(@Req() req: any, @Param('accountId') accountId: string): Promise<ApiResponse<unknown>> {
    return { code: 200, message: 'ok', data: await this.service.analyzeNotes(req.user, accountId) };
  }

  @Post('note/recognize')
  async recognizeNote(@Body() dto: { imageBase64?: string; mimeType?: string }): Promise<ApiResponse<unknown>> {
    if (!dto.imageBase64) throw new BadRequestException('缺少图片数据');
    return { code: 200, message: 'ok', data: await this.service.recognizeNoteScreenshot(dto.imageBase64, dto.mimeType) };
  }

  @Post('play-guide')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.CS)
  async savePlayGuide(@Req() req: any, @Body() dto: { content?: string }): Promise<ApiResponse<unknown>> {
    return {
      code: 200,
      message: '已保存',
      data: await this.service.savePlayGuide(dto.content, req.user),
    };
  }
}
