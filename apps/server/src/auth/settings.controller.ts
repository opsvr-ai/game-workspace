import { Controller, Get, Put, Body, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationService } from './authorization.service';
import { RolesGuard, Roles } from './roles.guard';
import { UserRole } from '@chunlv/shared';
import type { ApiResponse } from '@chunlv/shared';

const DEFAULT_CONFIGS: Record<string, any> = {
  'revenue.unlock_threshold': 200,
  'revenue.free_threshold': 300,
  'revenue.low_warning': 300,
  'revenue.share_tiers': [
    { min: 0, max: 5999.9, studio: 50, companion: 50 },
    { min: 6000, max: 9999, studio: 40, companion: 60 },
    { min: 10000, max: null, studio: 30, companion: 70 },
  ],
  'withdraw.advance_ratio': 50,
  'withdraw.default_deposit': 500,
  'timeout.grace_minutes': 10,
  'timeout.rest_shutdown': 60,
  'timeout.idle_shutdown': 60,
  'entertainment.idle_shutdown': 60,
  'entertainment.shutdown_countdown': 30,
  'entertainment.revenue_threshold': 200,
  'entertainment.deposit_threshold': 500,
  'entertainment.hourly_rate': 60,
  'options.contact_results': ['现在玩', '改天玩', '未回消息', '好友未通过', '被客户删除'],
  'options.finish_results': ['正常完成', '客户续单', '变声器退款', '技术差退款'],
  'options.fail_reasons': ['抢单未加微信', '好友未通过', '客户不回消息', '客户删除', '客户说不打', '其他'],
  'games': ['英雄联盟', '王者荣耀', '无畏契约', 'CS2', 'DOTA2', '永劫无间', '绝地求生', 'Apex英雄'],
  'ranks': ['青铜', '白银', '黄金', '铂金', '钻石', '大师', '宗师', '王者'],
  'agent.latest_version': '1.0.0',
  'agent.latest_download_url': '/api/agent/download/latest',
};

@Controller()
export class SettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authzService: AuthorizationService,
  ) {}

  @Get('settings')
  async getSettings(): Promise<ApiResponse<unknown>> {
    return this.getConfig('games,ranks');
  }

  @Put('settings')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async updateSettings(@Body() body: { games?: string[]; ranks?: string[] }): Promise<ApiResponse<unknown>> {
    await this.updateConfig(body);
    return { code: 200, message: '配置已更新', data: null };
  }

  // 通用配置 GET
  @Get('config')
  @UseGuards(AuthGuard('jwt'))
  async getConfig(@Query('keys') keysStr?: string): Promise<ApiResponse<unknown>> {
    const keys = keysStr ? keysStr.split(',').map(k => k.trim()) : Object.keys(DEFAULT_CONFIGS);
    const records = await this.prisma.systemConfig.findMany({
      where: { key: { in: keys } },
    });
    const result: Record<string, any> = {};
    for (const k of keys) {
      const record = records.find(r => r.key === k);
      result[k] = record?.value ?? (DEFAULT_CONFIGS[k] ?? null);
    }
    return { code: 200, message: 'ok', data: result };
  }

  // 通用配置 PUT（仅 ADMIN/OWNER）
  @Put('config')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async updateConfig(@Body() body: Record<string, any>): Promise<ApiResponse<unknown>> {
    const ops = Object.entries(body).map(([key, value]) =>
      this.prisma.systemConfig.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      }),
    );
    await Promise.all(ops);
    return { code: 200, message: 'ok', data: null };
  }

  // ── Tenant Authorization ──

  @Get('tenant/authorizations')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN)
  async getAuthorizations(@Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.authzService.getAuthorizations(req.user.studioId);
    return { code: 200, message: 'ok', data };
  }

  @Put('tenant/authorizations')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN)
  async updateAuthorization(@Req() req: any, @Body() dto: { csUserId: string } & any): Promise<ApiResponse<unknown>> {
    const data = await this.authzService.updateAuthorization(req.user.studioId, dto.csUserId, dto);
    return { code: 200, message: 'ok', data };
  }
}
