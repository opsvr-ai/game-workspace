import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  BadRequestException,
  HttpStatus,
} from '@nestjs/common';

interface ValidationErrorItem {
  field: string;
  messages: string[];
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse();

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

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      reply.status(statusCode).send({
        code: statusCode,
        message: exception.message,
      });
      return;
    }

    // Catch-all for unexpected errors
    reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      code: HttpStatus.INTERNAL_SERVER_ERROR,
      message: '服务器内部错误',
    });
  }

  private formatValidationErrors(
    messages: string | string[],
  ): string | ValidationErrorItem[] {
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
        messages: err.constraints
          ? Object.values(err.constraints)
          : [String(err)],
      }));
    }

    return '请求参数验证失败';
  }
}
