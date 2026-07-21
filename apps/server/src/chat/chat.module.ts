import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { ParticipantGuard } from './guards/participant.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { WsModule } from '../ws/ws.module';

@Module({
  imports: [PrismaModule, WsModule],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway, ParticipantGuard],
  exports: [ChatService, ChatGateway],
})
export class ChatModule {}
