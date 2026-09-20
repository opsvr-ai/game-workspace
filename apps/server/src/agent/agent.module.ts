import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { WsModule } from '../ws/ws.module';

@Module({
  imports: [WsModule, JwtModule.register({ secret: process.env.JWT_SECRET || 'x' })],
  controllers: [AgentController],
  providers: [AgentService],
})
export class AgentModule {}
