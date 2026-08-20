import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Req,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FilesInterceptor } from '@nestjs/platform-express';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { UserRole, type ApiResponse } from '@chunlv/shared';
import { BattleScreenshotsService } from './battle-screenshots.service';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { mkdirSync, rmSync } from 'fs';
import type { Request } from 'express';

const UPLOAD_DIR = join(process.cwd(), '..', '..', 'uploads', 'battle-screenshots');
const ALLOWED_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.heic', '.heif', '.tif', '.tiff'];
const MAX_FILES = 10;
const MAX_SIZE = 20 * 1024 * 1024;

@Controller('battle-screenshots')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class BattleScreenshotsController {
  constructor(private readonly service: BattleScreenshotsService) {}

  @Post()
  @Roles(UserRole.COMPANION)
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES, {
      storage: diskStorage({
        destination: (
          _req: Request,
          _file: Express.Multer.File,
          cb: (error: Error | null, destination: string) => void,
        ) => {
          try {
            mkdirSync(UPLOAD_DIR, { recursive: true });
          } catch {
            rmSync(UPLOAD_DIR, { force: true });
            mkdirSync(UPLOAD_DIR, { recursive: true });
          }
          cb(null, UPLOAD_DIR);
        },
        filename: (
          _req: Request,
          file: Express.Multer.File,
          cb: (error: Error | null, filename: string) => void,
        ) => {
          const ext = extname(file.originalname).toLowerCase();
          cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
        },
      }),
      fileFilter: (
        _req: Request,
        file: Express.Multer.File,
        cb: (error: Error | null, acceptFile: boolean) => void,
      ) => {
        const ext = extname(file.originalname).toLowerCase();
        if (!ALLOWED_EXTS.includes(ext)) {
          return cb(new BadRequestException('仅支持图片格式（JPG/PNG/WebP/GIF/BMP/HEIC）'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: MAX_SIZE },
    }),
  )
  async create(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: { customerId?: string },
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    if (!files || files.length < 3) {
      throw new BadRequestException('最少上传 3 张战绩图为一组');
    }
    const images = files.map((f) => `/uploads/battle-screenshots/${f.filename}`);
    const data = await this.service.create({
      studioId: req.user.studioId,
      companionId: req.user.companionId,
      customerId: body?.customerId || null,
      images,
    });
    return { code: 200, message: '已提交，等待管理端审核', data };
  }

  @Get('mine')
  @Roles(UserRole.COMPANION)
  async mine(@Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.service.listMine(req.user.companionId);
    return { code: 200, message: 'ok', data };
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async list(@Req() req: any, @Query('status') status?: string): Promise<ApiResponse<unknown>> {
    const data = await this.service.listAll(req.user.studioId, status);
    return { code: 200, message: 'ok', data };
  }

  @Post(':id/review')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async review(
    @Param('id') id: string,
    @Body() body: { action: 'approve' | 'reject'; note?: string },
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    if (!body?.action || !['approve', 'reject'].includes(body.action)) {
      throw new BadRequestException('请选择采纳或驳回');
    }
    const data = await this.service.review(id, req.user.id, body.action, body.note);
    return { code: 200, message: body.action === 'approve' ? '已采纳并加分' : '已驳回', data };
  }
}
