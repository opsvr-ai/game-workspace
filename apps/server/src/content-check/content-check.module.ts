import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ContentCheckController } from './content-check.controller';
import { ContentCheckService } from './content-check.service';

@Module({
  imports: [PrismaModule],
  controllers: [ContentCheckController],
  providers: [ContentCheckService],
})
export class ContentCheckModule {}
