import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { MachineController } from './machine.controller';
import { MachineService } from './machine.service';
import { WsModule } from '../ws/ws.module';

@Module({
  imports: [WsModule, JwtModule.register({ secret: process.env.JWT_SECRET || 'x' })],
  controllers: [AgentController, MachineController],
  providers: [AgentService, MachineService],
})
export class AgentModule {}
