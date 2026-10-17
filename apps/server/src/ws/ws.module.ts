import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { WsGateway } from './ws.gateway';
import { HeartbeatService } from './heartbeat.service';
import { BlacklistIngestService } from './blacklist-ingest.service';
import { WsConnectionService } from './ws-connection.service';
import { WsEmitterService } from './ws-emitter.service';
import { WsBlacklistService } from './ws-blacklist.service';
import { WsVoiceService } from './ws-voice.service';
import { WsStatusService } from './ws-status.service';
import { WsCommandService } from './ws-command.service';
import { CompanionsModule } from '../companions/companions.module';
import { StudiosModule } from '../studios/studios.module';

@Module({
  imports: [
    JwtModule.register({ secret: process.env.JWT_SECRET }),
    forwardRef(() => CompanionsModule),
    StudiosModule,
  ],
  providers: [
    WsGateway,
    HeartbeatService,
    BlacklistIngestService,
    // ws.gateway.ts 拆出来的语义层：连接 / 事件语义 / 黑名单 / 语音 / 状态 / 指令回执。
    // 网关构造时如果拿到实例就用实例（Nest 路径），拿不到就自建（单测直接 new 的路径）。
    WsConnectionService,
    WsEmitterService,
    WsBlacklistService,
    WsVoiceService,
    WsStatusService,
    WsCommandService,
  ],
  exports: [WsGateway],
})
export class WsModule {}
