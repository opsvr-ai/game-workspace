import { ExceptionFilter, Catch, ArgumentsHost, HttpException, BadRequestException, HttpStatus } from '@nestjs/common';
import { logger } from './logger';
import { MulterError } from 'multer';

interface ValidationErrorItem {
  field: string;
  messages: string[];
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse();

    // 上传错误：文件太大/字段不对/格式不对，直接给前端明确提示，不再显示“服务器内部错误”
    if (exception instanceof MulterError) {
      const msg =
        exception.code === 'LIMIT_FILE_SIZE'
          ? '图片文件太大，请压缩后再上传'
          : exception.code === 'LIMIT_UNEXPECTED_FILE'
            ? '上传字段不正确'
            : `图片上传失败：${exception.message}`;
      reply.status(HttpStatus.BAD_REQUEST).send({ code: HttpStatus.BAD_REQUEST, message: msg });
      return;
    }

    const errMessage = (exception as Error)?.message || '';
    if (errMessage.includes('仅支持')) {
      reply.status(HttpStatus.BAD_REQUEST).send({ code: HttpStatus.BAD_REQUEST, message: errMessage });
      return;
    }

    if (exception instanceof BadRequestException) {
      const response = exception.getResponse() as any;
      const statusCode = exception.getStatus();
      const formattedMessage = this.formatValidationErrors(response.message);

      reply.status(statusCode).send({
        code: statusCode,
        message: formattedMessage,
      });
      return;
    }

    // 上传超限：multer 抛上来的英文原文 “File too large” 容易让陪玩以为是网络坏了，
    // 这里统一成中文提示（返回 400，前端弹窗直接显示这句话）。
    if (
      exception instanceof HttpException &&
      (exception.getStatus() === HttpStatus.PAYLOAD_TOO_LARGE || /file too large/i.test(exception.message))
    ) {
      reply.status(HttpStatus.BAD_REQUEST).send({
        code: HttpStatus.BAD_REQUEST,
        message: '照片超过 10MB 上限，请换一张小一点的照片（或先在手机上压缩）再上传',
      });
      return;
    }

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      reply.status(statusCode).send({
        code: statusCode,
        message: exception.message,
      });
      return;
    }

    // Catch-all for unexpected errors
    const err = exception as Error;
    logger.error('Unhandled exception', { error: err.message, stack: err.stack });
    const friendly = err.message && !err.message.trim().startsWith('Invalid `prisma')
      ? err.message
      : '数据操作失败，请稍后重试';
    reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      code: HttpStatus.INTERNAL_SERVER_ERROR,
      message: friendly,
    });
  }

  private formatValidationErrors(messages: string | string[]): string | ValidationErrorItem[] {
    // If it's already a single string (custom BadRequestException), return as-is
    if (typeof messages === 'string') {
      return messages;
    }

    // class-validator returns an array of error strings like:
    // "title must be a string", "price must be a positive number"
    if (Array.isArray(messages) && messages.length > 0) {
      // Check if the first element is a string (simple array) or object (nested)
      if (typeof messages[0] === 'string') {
        // Join all validation messages with semicolons for Chinese readability
        return (messages as string[]).join('；');
      }

      // If nested objects with constraints from class-validator's default format
      return (messages as any[]).map((err) => ({
        field: err.property ?? 'unknown',
        messages: err.constraints ? Object.values(err.constraints) : [String(err)],
      }));
    }

    return '请求参数验证失败';
  }
}
