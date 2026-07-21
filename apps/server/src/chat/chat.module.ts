import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { ChatNotificationService } from './chat-notification.service';
import { ChatUploadService } from './chat-upload.service';
import { ChatSearchService } from './chat-search.service';
import { ParticipantGuard } from './guards/participant.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { WsModule } from '../ws/ws.module';

@Module({
  imports: [PrismaModule, WsModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    ChatGateway,
    ChatNotificationService,
    ChatUploadService,
    ChatSearchService,
    ParticipantGuard,
  ],
  exports: [ChatService, ChatGateway],
})
export class ChatModule {}
