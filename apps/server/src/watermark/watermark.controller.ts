import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { UserRole } from '@chunlv/shared';
import { WatermarkService } from './watermark.service';

/**
 * 微信号溯源（客户微信隐形水印解码）—— 老板 2026-10-04。
 * 只有老板能查：查出来就是「谁把客户微信漏出去的」，属于敏感结论。
 */
@Controller('watermark')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class WatermarkController {
  constructor(private readonly service: WatermarkService) {}

  /** 把可疑文本（泄漏出去的微信号 / 一整条聊天记录）粘进来 → 查出是谁、哪天看过的。 */
  @Post('decode')
  @Roles(UserRole.OWNER)
  async decode(@Body() body: { text?: string }) {
    const data = await this.service.decode(body?.text || '');
    return { code: 200, message: 'ok', data };
  }
}