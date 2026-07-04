import { NestFactory } from '@nestjs/core';
import { logger } from './common/logger';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: [
      'http://localhost:5173',
      'http://localhost:8000',
      'http://127.0.0.1:8000',
      'http://192.168.0.106:8000',
    ],
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());

  // Serve uploaded files
  app.useStaticAssets(join(process.cwd(), '../../uploads'), {
    prefix: '/uploads',
  });

  await app.listen(3001);
  logger.info('Server started', { port: 3001 });
  console.log('Server running on http://localhost:3001');
}

bootstrap();
