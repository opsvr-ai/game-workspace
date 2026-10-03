import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WatermarkController } from './watermark.controller';
import { WatermarkService } from './watermark.service';

/** 客户微信隐形水印的「溯源」入口（老板 2026-10-04）。 */
@Module({
  imports: [PrismaModule],
  controllers: [WatermarkController],
  providers: [WatermarkService],
  exports: [WatermarkService],
})
export class WatermarkModule {}