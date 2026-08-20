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
  Res,
  NotFoundException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FilesInterceptor } from '@nestjs/platform-express';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { UserRole, type ApiResponse } from '@chunlv/shared';
import { BattleScreenshotsService } from './battle-screenshots.service';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { mkdirSync, rmSync, renameSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import type { Request } from 'express';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';

const UPLOAD_DIR = join(process.cwd(), '..', '..', 'uploads', 'battle-screenshots');
const ALLOWED_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.heic', '.heif', '.tif', '.tiff'];
const MAX_FILES = 10;
const MAX_SIZE = 20 * 1024 * 1024;
const execFileAsync = promisify(execFile);

const safeName = (s: string) => String(s || '未知').replace(/[\\/:*?"<>|]/g, '_').trim();
const chinaDate = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

@Controller('battle-screenshots')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class BattleScreenshotsController {
  constructor(
    private readonly service: BattleScreenshotsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @Roles(UserRole.COMPANION)
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES, {
      storage: diskStorage({
        destination: (
          req: Request,
          _file: Express.Multer.File,
          cb: (error: Error | null, destination: string) => void,
        ) => {
          const companionFolder = safeName((req as any).user?.username);
          const dateFolder = chinaDate();
          const dir = join(UPLOAD_DIR, companionFolder, dateFolder);
          try {
            mkdirSync(dir, { recursive: true });
          } catch {
            rmSync(dir, { force: true });
            mkdirSync(dir, { recursive: true });
          }
          cb(null, dir);
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
    const companionFolder = safeName(req.user.username);
    const dateFolder = chinaDate();
    const images = files.map((f, i) => {
      const ext = extname(f.filename).toLowerCase() || '.jpg';
      const newName = `${i + 1}${ext}`;
      const oldPath = join(UPLOAD_DIR, companionFolder, dateFolder, f.filename);
      const newPath = join(UPLOAD_DIR, companionFolder, dateFolder, newName);
      try { renameSync(oldPath, newPath); } catch {}
      return `/uploads/battle-screenshots/${companionFolder}/${dateFolder}/${newName}`;
    });
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

  @Get(':id/download')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async download(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const item = await this.prisma.battleScreenshot.findUnique({
      where: { id },
      include: { companion: { include: { user: { select: { username: true, displayName: true } } } } },
    });
    if (!item) throw new NotFoundException('记录不存在');

    const tmpDir = join(os.tmpdir(), `battle-${id}`);
    try {
      rmSync(tmpDir, { recursive: true, force: true });
      mkdirSync(tmpDir, { recursive: true });
      // 复制图片到临时目录，按 1.jpg/2.jpg/3.jpg 顺序命名，方便文件夹里查看。
      const absFiles: string[] = [];
      item.images.forEach((url, i) => {
        const rel = String(url).replace(/^\/uploads\/battle-screenshots\//, '');
        const src = join(UPLOAD_DIR, rel);
        if (!rel) return;
        const dst = join(tmpDir, `${i + 1}.jpg`);
        require('fs').copyFileSync(src, dst);
        absFiles.push(dst);
      });
      const zipPath = join(os.tmpdir(), `battle-${id}.zip`);
      rmSync(zipPath, { force: true });
      await execFileAsync('zip', ['-j', zipPath, ...absFiles]);
      const name = item.companion?.user?.displayName || item.companion?.user?.username || '陪玩';
      const safeName = String(name).replace(/[\\/:*?"<>|]/g, '_');
      res.download(zipPath, `战绩图_${safeName}_${new Date(item.createdAt).toISOString().slice(0, 10)}.zip`, () => {
        try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
        try { rmSync(zipPath, { force: true }); } catch {}
      });
    } catch (err: any) {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      throw new BadRequestException(`打包失败: ${err?.message || String(err)}`);
    }
  }
}
