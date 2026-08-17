import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProfitSplitController } from './profit-split.controller';
import { ProfitSplitService } from './profit-split.service';

@Module({
  imports: [PrismaModule],
  controllers: [ProfitSplitController],
  providers: [ProfitSplitService],
})
export class ProfitSplitModule {}
