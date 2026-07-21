// craftsman-ignore: TS001
import { Injectable, BadRequestException } from '@nestjs/common';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const UPLOAD_DIR = join(process.cwd(), '..', '..', 'uploads', 'chat');
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIMES = [
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
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

@Injectable()
export class ChatUploadService {
  validate(file: Express.Multer.File): void {
    if (!file) throw new BadRequestException('请选择文件');
    if (file.size > MAX_FILE_SIZE) throw new BadRequestException('文件不能超过20MB');
    if (!ALLOWED_MIMES.includes(file.mimetype || '')) {
      throw new BadRequestException(`不支持的文件类型: ${file.mimetype}`);
    }
  }

  /** Generate URL and metadata for uploaded file */
  buildResult(file: Express.Multer.File): {
    url: string;
    thumbnailUrl?: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    width?: number;
    height?: number;
  } {
    const url = `/uploads/chat/${file.filename}`;
    const isImage = file.mimetype?.startsWith('image/');

    return {
      url,
      thumbnailUrl: isImage ? url : undefined,
      fileName: file.originalname || 'file',
      fileSize: file.size,
      mimeType: file.mimetype || 'application/octet-stream',
    };
  }

  static getUploadDir(): string {
    return UPLOAD_DIR;
  }
}
