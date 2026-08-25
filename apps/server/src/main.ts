// craftsman-ignore: TS001
import { NestFactory } from '@nestjs/core';
import { logger } from './common/logger';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { join } from 'path';
import { existsSync } from 'fs';
import express from 'express';
import helmet from 'helmet';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  // Startup safety checks
  if (!process.env.JWT_SECRET) {
    throw new Error('FATAL: JWT_SECRET environment variable is not set. Refusing to start.');
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // 关闭 ETag/304：Express 默认会对响应生成 ETag，客户端带 If-None-Match 时会返回 304。
  // Electron 的 axios 拿到 304 时 body 为空，会导致「后端有数据、前端却显示空」。
  // 这里统一禁用 ETag，配合 no-store，确保每次请求都返回完整 200 数据。
  app.getHttpAdapter().getInstance().set('etag', false);

  // Body size limits — needed for large payloads (installer uploads, process reports)
  app.use(express.json({ limit: '200mb' }));
  app.use(express.urlencoded({ limit: '200mb', extended: true }));

  // Security middleware
  app.use(
    helmet({
      contentSecurityPolicy: false, // Allow inline scripts for Electron + React
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.setGlobalPrefix('api');

  const corsOriginEnv =
    process.env.CORS_ORIGINS ||
    'http://localhost:5173,http://localhost:8000,http://192.168.0.106:8000,http://192.168.0.106:5173';
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

  // Serve uploaded files (resolve from dist/ → ../../../ = repo root)
  app.useStaticAssets(join(__dirname, '../../../uploads'), {
    prefix: '/uploads',
  });

  // Serve web frontend (if built, at apps/server/web-dist)
  const webDistPath = join(__dirname, '../web-dist');
  if (existsSync(webDistPath)) {
    const expressApp = app.getHttpAdapter().getInstance();
    // 防止 API 响应被缓存（ETag/304 会导致 Electron 订单池拿到旧数据不刷新）
    expressApp.use('/api', (_req: express.Request, res: express.Response, next: express.NextFunction) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      next();
    });
    // 前端资源全部强制不缓存：Electron 客户端历史上多次因磁盘/会话缓存拿到旧 bundle，
    // 导致订单池等页面「数据有但界面不显示」。这里统一 no-store，彻底杜绝旧前端。
    expressApp.use(
      express.static(webDistPath, {
        etag: false,
        maxAge: 0,
        setHeaders: (res) => {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        },
      }),
    );
    // Fallback: SPA routing — serve index.html for non-API routes
    const indexHtml = join(webDistPath, 'index.html');
    if (existsSync(indexHtml)) {
      expressApp.get('*', (req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        // 关键：sendFile 会自带 ETag，即使全局关了 etag 也会对 If-None-Match 回 304，
        // 导致 Electron 客户端永远拿旧 index.html。这里显式关闭 etag/lastModified。
        res.sendFile(indexHtml, { etag: false, lastModified: false, cacheControl: false });
      });
    }
    logger.info('Web frontend served from', { path: webDistPath });
  }

  const server = await app.listen(3001);
  // Build requests can take minutes (electron-builder on Wine)
  server.setTimeout(600_000);
  logger.info('Server started', { port: 3001 });
  logger.info('Server running', { url: 'http://localhost:3001' });
}

bootstrap();
