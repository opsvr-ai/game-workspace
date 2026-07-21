import {
  Controller,
  Post,
  Get,
  Put,
  Param,
  Body,
  Request,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { RolesGuard, Roles } from './roles.guard';
import { AuthService } from './auth.service';
import { LoginDto, RefreshDto, VerifySecondDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserRole, type ApiResponse, type LoginResponse, type UserInfo } from '@chunlv/shared';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle({ short: { limit: 5, ttl: 60000 } })
  @Post('login')
  async login(@Body() dto: LoginDto): Promise<ApiResponse<LoginResponse>> {
    const data = await this.authService.login(dto);
    return { code: 200, message: 'ok', data };
  }

  @Post('refresh')
  async refresh(@Body() dto: RefreshDto): Promise<ApiResponse<{ accessToken: string; refreshToken: string }>> {
    const data = await this.authService.refresh(dto.refreshToken);
    return { code: 200, message: 'ok', data };
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('verify-2nd')
  async verifySecond(@Request() req: any, @Body() dto: VerifySecondDto): Promise<ApiResponse<{ secondToken: string }>> {
    const data = await this.authService.verifySecondPassword(req.user.id, dto.password);
    return { code: 200, message: 'ok', data };
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.OWNER)
  @Put('users/:id/authorize')
  async authorizeUser(@Param('id') id: string): Promise<ApiResponse<null>> {
    await this.authService.authorizeUser(id);
    return { code: 200, message: '审核通过', data: null };
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.OWNER)
  @Put('users/:id/reject')
  async rejectUser(@Param('id') id: string, @Body() body: { reason: string }): Promise<ApiResponse<null>> {
    await this.authService.rejectUser(id, body.reason);
    return { code: 200, message: '已拒绝', data: null };
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  async me(@Request() req: any): Promise<ApiResponse<UserInfo>> {
    const data = await this.authService.getMe(req.user.id);
    return { code: 200, message: 'ok', data };
  }

  @UseGuards(AuthGuard('jwt'))
  @Put('me/password')
  async changePassword(@Request() req: any, @Body() dto: ChangePasswordDto): Promise<ApiResponse<null>> {
    await this.authService.changePassword(req.user.id, dto.oldPassword, dto.newPassword);
    return { code: 200, message: '密码已修改', data: null };
  }

  @UseGuards(AuthGuard('jwt'))
  @Put('me/profile')
  async updateProfile(@Request() req: any, @Body() dto: UpdateProfileDto): Promise<ApiResponse<null>> {
    await this.authService.updateProfile(req.user.id, dto.displayName);
    return { code: 200, message: '资料已更新', data: null };
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('me/emojis')
  async getEmojis(@Request() req: any): Promise<ApiResponse<string[]>> {
    const data = await this.authService.getCustomEmojis(req.user.id);
    return { code: 200, message: 'ok', data };
  }

  @UseGuards(AuthGuard('jwt'))
  @Put('me/emojis')
  async updateEmojis(@Request() req: any, @Body() body: { emojis: string[] }): Promise<ApiResponse<null>> {
    await this.authService.updateCustomEmojis(req.user.id, body.emojis ?? []);
    return { code: 200, message: '表情已保存', data: null };
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('me/avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dir = join(process.cwd(), '../../uploads/avatars');
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => {
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          cb(null, `${unique}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: 2 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.match(/^image\/(jpeg|png|webp)$/)) {
          cb(new Error('仅支持 JPG/PNG/WEBP 格式'), false);
        } else {
          cb(null, true);
        }
      },
    }),
  )
  async uploadAvatar(
    @Request() req: any,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<ApiResponse<{ filename: string } | null>> {
    if (!file) return { code: 400, message: '请选择图片文件', data: null };
    await this.authService.updateAvatar(req.user.id, file.filename);
    return { code: 200, message: '头像已更新', data: { filename: file.filename } };
  }
}
