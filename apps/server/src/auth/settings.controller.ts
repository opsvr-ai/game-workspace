// craftsman-ignore: TS001
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
    { min: 0, max: 5199.99, studio: 50, companion: 50 },
    { min: 5200, max: 9999.99, studio: 40, companion: 60 },
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
  'traffic.account_types': ['小红书', '抖音', '咸鱼', 'B站', '视频号'],
  'traffic.account_columns': [
    { key: 'type', label: '平台', custom: false },
    { key: 'code', label: '编号', custom: false },
    { key: 'trafficLevel', label: '流量', custom: false },
    { key: 'accountStyle', label: '账号风格', custom: false },
    { key: 'nickname', label: '昵称', custom: false },
    { key: 'accountId', label: 'ID', custom: false },
    { key: 'wifi', label: 'WiFi', custom: false },
    { key: 'wifiRegion', label: 'WiFi地区', custom: false },
    { key: 'riskPopped', label: '弹过风险', custom: false },
    { key: 'riskNote', label: '风险备注', custom: false },
    { key: 'banned', label: '封禁过', custom: false },
    { key: 'banNote', label: '封禁备注', custom: false },
    { key: 'phone', label: '注册手机号', custom: false },
    { key: 'promotionContact', label: '地推联系人', custom: false },
    { key: 'realName', label: '实名', custom: false },
    { key: 'registerDate', label: '注册日期', custom: false },
    { key: 'banDate', label: '封禁日期', custom: false },
    { key: 'imageSourceNote', label: '图片来源备注', custom: false },
    { key: 'otherNote', label: '其他备注', custom: false },
  ],
  games: ['英雄联盟', '王者荣耀', '无畏契约', 'CS2', 'DOTA2', '永劫无间', '绝地求生', 'Apex英雄'],
  ranks: ['青铜', '白银', '黄金', '铂金', '钻石', '大师', '宗师', '王者'],
  'identity.app_code': '',
  'identity.app_key': '',
  'identity.app_secret': '',
  'turn.url': '',
  'turn.username': '',
  'turn.credential': '',
  'agent.latest_version': '1.0.0',
  'agent.latest_download_url': '/api/agent/download/latest',
  'capture.interval_min_minutes': 12,
  'capture.interval_max_minutes': 18,
  'capture.first_delay_min_minutes': 1,
  'capture.first_delay_max_minutes': 3,
  'capture.black_jpeg_kb': 15,
  'capture.expected_per_hour': 4,
  'capture.min_rate_percent': 50,
  'capture.black_rate_max_percent': 30,
  'attendance.workStart': '09:00',
  'attendance.workEnd': '18:00',
  'notification.sound': true,
  'notification.desktop': true,
  'notification.badge': true,
  'pool.unlock_revenue_enabled': true,
  'pool.unlock_revenue_threshold': 200,
  'pool.daily_customer_quota_enabled': true,
  'pool.daily_customer_quota': 3,
  'pool.success_rate_gate_enabled': true,
  'pool.success_rate_gate_threshold': 90,
  'pool.daily_grab_limit_enabled': false,
  'pool.daily_grab_limit': 20,
  'pool.supplement_max_daily_requests': 5,
  'pool.priority_delay_seconds': 0,
  'pool.offline_delay_seconds': 60,
  'pool.bridge_delay_seconds': 120,
  'pool.online_delay_seconds': 180,
  'pool.immediate_disappear_minutes': 10,
  'pool.scheduled_disappear_minutes': 60,
  'anomaly.revenue_drop_percent': 50,
  'anomaly.hours_drop_percent': 50,
  'anomaly.spend_drop_percent': 50,
  'anomaly.price_tier_downgrade_enabled': true,
  'dispatch.bridge_immediate_window_sec': 60,
  'dispatch.qualified_threshold': 90,
  'dispatch.nonqualified_daily_new_limit': 1,
  'dispatch.break_even_hours': 2.5,
  'dispatch.studio_share_percent': 30,
  'dispatch.bridge_return_jimi_cents': 0,
  'dispatch.bridge_return_jueju_cents': 1500,
  'dispatch.game_break_even_hours': [
    { game: '三角洲行动', hours: 1.75 },
    { game: '无畏契约', hours: 0 },
    { game: '绝地求生', hours: 0 },
    { game: 'CS2', hours: 0 },
    { game: '永劫无间', hours: 0 },
    { game: '王者荣耀', hours: 0 },
    { game: '英雄联盟', hours: 0 },
    { game: '金铲铲', hours: 0 },
    { game: '三角洲手游', hours: 0 },
    { game: '和平精英', hours: 0 },
  ],
  'commission.cs_offline_rate_percent': 0.5,
  'commission.cs_offline_floor_cents': 200,
  'commission.cs_bridge_fixed_cents': 100,
  'commission.cs_month_cap_cents': 2000,
  'commission.attribution_window': 'month',
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

  // 通用配置 GET — sensitive keys (identity.*, JWT, secrets) require OWNER
  @Get('config')
  @UseGuards(AuthGuard('jwt'))
  async getConfig(@Query('keys') keysStr?: string, @Req() req?: any): Promise<ApiResponse<unknown>> {
    const SENSITIVE_PREFIXES = ['identity.', 'jwt.', 'secret'];
    const keys = keysStr ? keysStr.split(',').map((k) => k.trim()) : Object.keys(DEFAULT_CONFIGS);
    const isOwner = req?.user?.role === 'OWNER';
    const safeKeys = keys.filter((k) => isOwner || !SENSITIVE_PREFIXES.some((p) => k.startsWith(p)));
    const records = await this.prisma.systemConfig.findMany({
      where: { key: { in: safeKeys } },
    });
    const result: Record<string, any> = {};
    for (const k of keys) {
      const record = records.find((r) => r.key === k);
      result[k] = record?.value ?? DEFAULT_CONFIGS[k] ?? null;
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

