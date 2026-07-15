import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthService } from './auth.service';
import { AuthorizationService } from './authorization.service';
import { IdentityVerifyService } from './identity-verify.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { RegisterController } from './register.controller';
import { SettingsController } from './settings.controller';

@Module({
  imports: [
    PrismaModule,
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'fallback-secret',
      signOptions: { expiresIn: '15m' },
    }),
  ],
  controllers: [AuthController, RegisterController, SettingsController],
  providers: [AuthService, AuthorizationService, JwtStrategy, IdentityVerifyService],
  exports: [AuthService],
})
export class AuthModule {}
