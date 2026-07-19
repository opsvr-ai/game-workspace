import { NestFactory } from '@nestjs/core';
import { logger } from './common/logger';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { join } from 'path';
import helmet from 'helmet';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  // Startup safety checks
  if (!process.env.JWT_SECRET) {
    throw new Error('FATAL: JWT_SECRET environment variable is not set. Refusing to start.');
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Security middleware
  app.use(helmet());

  app.setGlobalPrefix('api');

  const corsOriginEnv = process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:8000';
  app.enableCors({
    origin: corsOriginEnv.split(','),
    credentials: true,
  });

  // Swagger API documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('蠢驴电竞陪玩派单管理系统 API')
    .setDescription('Chunlv Esports Companion Dispatch Management System')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

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
