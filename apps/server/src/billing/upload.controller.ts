import {
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { UserRole } from '@chunlv/shared';
import type { ApiResponse } from '@chunlv/shared';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { mkdirSync, rmSync } from 'fs';
import type { Request } from 'express';

const UPLOAD_DIR = join(process.cwd(), '..', '..', 'uploads', 'screenshots');

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/heic', 'image/heif', 'image/tiff'];
const ALLOWED_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.heic', '.heif', '.tif', '.tiff'];
const MAX_SIZE = 20 * 1024 * 1024; // 20MB

@Controller()
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class UploadController {
  @Post('upload/screenshot')
  @Roles(UserRole.COMPANION)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (
          _req: Request,
          _file: Express.Multer.File,
          cb: (error: Error | null, destination: string) => void,
        ) => {
          try {
            mkdirSync(UPLOAD_DIR, { recursive: true });
          } catch {
            // 处理同名文件或坏符号链接：清掉后重建真实目录
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
          const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          const ext = extname(file.originalname).toLowerCase();
          cb(null, `${uniqueSuffix}${ext}`);
        },
      }),
      fileFilter: (
        _req: Request,
        file: Express.Multer.File,
        cb: (error: Error | null, acceptFile: boolean) => void,
      ) => {
        const ext = extname(file.originalname).toLowerCase();
        const mimeOk = !file.mimetype || ALLOWED_MIMES.includes(file.mimetype);
        if (!mimeOk || !ALLOWED_EXTS.includes(ext)) {
          return cb(new BadRequestException('仅支持图片格式（JPG/PNG/WebP/GIF/BMP/HEIC）'), false);
        }
        cb(null, true);
      },
      limits: {
        fileSize: MAX_SIZE,
      },
    }),
  )
  async uploadScreenshot(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<ApiResponse<{ url: string }>> {
    if (!file) {
      throw new BadRequestException('请上传截图文件');
    }

    const url = `/uploads/screenshots/${file.filename}`;
    return { code: 200, message: '上传成功', data: { url } };
  }
}
