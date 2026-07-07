import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { WsGateway } from './ws.gateway';
import { CompanionsModule } from '../companions/companions.module';

@Module({
  imports: [
    JwtModule.register({ secret: process.env.JWT_SECRET }),
    forwardRef(() => CompanionsModule),
  ],
  providers: [WsGateway],
  exports: [WsGateway],
})
export class WsModule {}
