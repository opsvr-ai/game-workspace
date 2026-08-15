import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { ChatNotificationService } from './chat-notification.service';
import { ChatUploadService } from './chat-upload.service';
import { ChatSearchService } from './chat-search.service';
import { ParticipantGuard } from './guards/participant.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { WsModule } from '../ws/ws.module';
import { StudiosModule } from '../studios/studios.module';

@Module({
  imports: [
    JwtModule.register({ secret: process.env.JWT_SECRET }),
    PrismaModule,
    forwardRef(() => WsModule),
    StudiosModule,
  ],
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
