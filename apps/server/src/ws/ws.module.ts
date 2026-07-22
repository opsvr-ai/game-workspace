import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { WsGateway } from './ws.gateway';
import { HeartbeatService } from './heartbeat.service';
import { BlacklistIngestService } from './blacklist-ingest.service';
import { CompanionsModule } from '../companions/companions.module';
import { StudiosModule } from '../studios/studios.module';

@Module({
  imports: [
    JwtModule.register({ secret: process.env.JWT_SECRET }),
    forwardRef(() => CompanionsModule),
    StudiosModule,
  ],
  providers: [WsGateway, HeartbeatService, BlacklistIngestService],
  exports: [WsGateway],
})
export class WsModule {}
