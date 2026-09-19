// craftsman-ignore: TS001
import { Controller, Get, Put, Body, Query, Req, UseGuards, BadRequestException } from '@nestjs/common';
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
  'entertainment.revenue_threshold': 200,
  'entertainment.deposit_threshold': 500,
  'entertainment.hourly_rate': 60,
  'options.contact_results': ['现在玩', '改天玩', '未回消息', '好友未通过', '被客户删除'],
  'options.finish_results': ['正常完成', '客户续单', '变声器退款', '技术差退款'],
  'options.fail_reasons': ['抢单未加微信', '好友未通过', '客户不回消息', '客户删除', '客户说不打', '其他'],
  'traffic.account_types': ['抖音', '小红书', '视频号', '快手', '咸鱼', 'B站'],
  'traffic.account_columns': [
    { key: 'type', label: '平台', custom: false },
    { key: 'code', label: '编号', custom: false },
    { key: 'trafficLevel', label: '流量', custom: false },
    { key: 'nickname', label: '昵称', custom: false },
    { key: 'accountId', label: 'ID', custom: false },
    { key: 'wifi', label: 'WiFi', custom: false },
    { key: 'wifiNote', label: 'WiFi备注', custom: true },
    { key: 'wifiRegion', label: 'WiFi地区', custom: false },
    { key: 'purchaseDate', label: '购买时间', custom: true },
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
  // 陪玩处于「空闲/娱乐」等状态时，客户端是否自动结束状态黑名单里的进程。
  // 默认关闭：名单只记录不杀，避免把正在玩游戏的陪玩误杀（见 2026-09-20 误杀事故）。
  'blacklist.auto_kill': false,
  'agent.latest_version': '1.0.0',
  'agent.latest_download_url': '/uploads/chunlv-latest.zip',
  'ai.provider': 'doubao',
  'ai.deepseek_api_key': '',
  'ai.doubao_api_key': '',
  'ai.doubao_model': 'doubao-pro-32k',
  'ai.doubao_vision_model': 'Doubao-1.5-vision-pro',
  'traffic.note_benchmarks': {
    clickRate: { eliminate: 2.5, pass: 4.5, good: 4.5 },
    interactionRate: { eliminate: 2, pass: 3.5, good: 3.5 },
    dmRate: { eliminate: 0.5, pass: 1.5, good: 3 },
    searchRatio: { min: 10, idealLow: 20, idealHigh: 40 },
    profileRatio: { ok: 10, warn: 20 },
    readCompletionRate: { min: 40 },
  },
  'traffic.play_guide': `三角洲陪玩 · 小红书图文矩阵打法

一、账号分工（不要全做成一样）
- 情绪娱乐号（50%）：会聊天、心态好，主打排位破防、队友摆烂、娱乐组队，吃首页推荐。
- 技术上分号（35%）：技术打手，主打护航/上分/刷哈弗币/过任务，吃搜索流量，是私信主力。
- 避坑干货号（15%）：老玩家，写避坑/技巧/踩坑经验，提信任、吃长尾搜索词。
- 禁止全账号统一头像/简介/文案，容易被批量关联限流。

二、封面与标题（决定点击率）
- 封面 3:4 竖版，文字必带关键词：三角洲、上分、排位坐牢、护航。
- 封面两种：①痛点提问「三角洲排位坐牢怎么办？」②场景共鸣「打三角洲天天被队友搞破防」。
- 标题公式：核心词+痛点+情绪提问；别写硬广「三角洲陪玩接单速来」。

三、正文四段式（图文 3-6 张最佳，别写长文）
- 开头：场景痛点，埋关键词；中间：对局感受/段位困境+截图；结尾：弱互动钩子；标签带长尾词。
- 同一选题分发不同账号必须改写+换图，相似度控制在 30% 以内。

四、发布节奏
- 单账号每日 1-2 篇；多账号错峰 30-90 分钟；集中在 12-14 点、19-23 点。
- 新选题先 1-2 个号测试，数据跑合格再批量改写分发。

五、硬性风控
- 一机一号一卡独立网络，不共用 WiFi、不用机房 VPN/代理 IP；中兴手机尽量不解 BL 锁。
- 禁止互赞互评互@；笔记/简介不放微信、不站外导流；评论区不写「扣1」；不刷赞刷评。

六、数据淘汰标准（48 小时看结果）
- 点击率：<2.5% 淘汰 · 2.5-4.5% 铺量及格 · >4.5% 优质复用
- 互动率（赞藏评/浏览）：<2% 淘汰 · 2-3.5% 及格 · >3.5% 优质
- 搜索来源占比：<10% 淘汰 · 10-20% 及格 · >20% 优质
- 个人主页来源占比：>20% 淘汰 · ≤10% 达标
- 淘汰档换封面标题重写；优质档改写后全矩阵复用。

七、判断笔记有没有进入搜索【综合池】
注意：不要用发布本机/同账号去搜，账号缓存会优先展示自己作品，测试不准，要用无关设备。
1. 拿一台普通私人手机（未登录你的账号、不是矩阵设备），退出登录或用无关小号。
2. 搜索框输入目标词（如「三角洲陪玩」），保持「综合」标签（别点「最新」），下滑翻页找你的笔记。
- ✅ 综合页能搜到：已进入搜索综合池，关键词被收录，能持续吃搜索长尾流量。
- ❌ 综合翻不到、只有「最新」能看到：只发布成功、没拿到搜索权重，搜索占比再高也难持续来客。
- 常见原因：文案相似度高、硬广太重、关键词堆砌、账号风控、阅读完成率过低。

补充判断（看专业号后台）：
- 发布 24-48 小时后看「搜索占比」：≥10% 基本已进综合池；<5% 大概率只待在最新池。
- 48h 搜索占比一直很低 + 换小号综合页搜不到：改写标题+正文重新发布，别死扛。

小知识点：
- 刚发 0-6 小时多只在「最新」，等系统收录至少 24 小时再判断。
- 进综合池不是永久排名，同行大量发会掉排名，所以要持续产新笔记抢位置。
- 别用自己账号搜自己笔记反复点，会干扰后台数据、产生无效浏览。`,
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
  'pool.success_rate_gate_enabled': true,
  'pool.success_rate_gate_threshold': 90,
  'pool.priority_delay_seconds': 0,
  'pool.bridge_delay_seconds': 30,
  'pool.middle_delay_seconds': 60,
  'pool.low_delay_seconds': 120,
  'pool.online_delay_seconds': 180,
  'pool.immediate_disappear_minutes': 10,
  'pool.scheduled_disappear_minutes': 60,
  'service.stale_session_hours': 24,
  'anomaly.revenue_drop_percent': 50,
  'anomaly.hours_drop_percent': 50,
  'anomaly.spend_drop_percent': 50,
  'anomaly.price_tier_downgrade_enabled': true,
  'billing.report_diff_warning_yuan': 10,
  'dispatch.bridge_immediate_window_sec': 60,
  'dispatch.top_tier_daily_new_limit': 999,
  'dispatch.middle_tier_daily_new_limit': 2,
  'dispatch.low_tier_daily_new_limit': 1,
  'dispatch.break_even_hours': 2.5,
  'dispatch.studio_share_percent': 30,
  // 综合评分权重（默认：月流水50 + 续单20 + 复购20 + 首单10，上等马线50）
  'excellence.revenue_weight': 50,
  'excellence.revenue_cap_yuan': 10000,
  'excellence.renew_weight': 20,
  'excellence.repurchase_weight': 20,
  'excellence.first_success_weight': 10,
  'excellence.excellent_threshold': 50,
  'excellence.middle_tier_threshold': 25,
  'excellence.battle_screenshot_bonus': 1,
  'excellence.low_tier_auto_resign_days': 0,
  'excellence.revenue_tiers': [
    { min: 0, score: 0 },
    { min: 3000, score: 20 },
    { min: 6000, score: 40 },
    { min: 10000, score: 50 },
  ],
  'excellence.renew_tiers': [
    { min: 0, score: 0 },
    { min: 30, score: 10 },
    { min: 60, score: 20 },
  ],
  'excellence.repurchase_tiers': [
    { min: 0, score: 0 },
    { min: 30, score: 10 },
    { min: 60, score: 20 },
  ],
  'excellence.first_success_tiers': [
    { min: 0, score: 0 },
    { min: 40, score: 5 },
    { min: 70, score: 10 },
  ],
  // 桥接工作室首单返还（仅适用于桥接线下工作室）：首单 = 第一个小时。机密首单不结（0）；绝密按 15 元/小时/陪玩返还（双陪×2）。
  'dispatch.bridge_return_jimi_cents': 0,
  'dispatch.bridge_return_jueju_cents': 1500,
  'bridge.secret_price_yuan': 35,
  'bridge.jueju_net_yuan': 30,
  'commission.cs_bridge_per_order_yuan': 1,
  'commission.cs_base_salary_yuan': 0,
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
  'commission.cs_offline_rate_percent': 1,
  'commission.cs_offline_floor_cents': 200,
  'commission.cs_online_per_order_yuan': 1,
  'commission.cs_offline_per_order_cap_cents': 0,
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
    // 校验综合评分权重：四项满分之和不能超过 100，上等马线不能超过总分。
    const weightKeys = [
      'excellence.revenue_weight',
      'excellence.renew_weight',
      'excellence.repurchase_weight',
      'excellence.first_success_weight',
    ];
    if (weightKeys.some((k) => body[k] !== undefined)) {
      const existing = await this.prisma.systemConfig.findMany({ where: { key: { in: weightKeys } } });
      const map = new Map<string, number>(existing.map((r) => [r.key, Number(r.value) || 0]));
      for (const k of weightKeys) {
        if (body[k] !== undefined) {
          const v = Number(body[k]);
          if (!Number.isFinite(v) || v < 0) throw new BadRequestException('评分权重必须是非负数字');
          map.set(k, v);
        }
      }
      const total = weightKeys.reduce((s, k) => s + (map.get(k) || 0), 0);
      if (total > 100) {
        throw new BadRequestException(`评分权重满分之和不能超过 100 分（当前 ${total} 分）`);
      }
      if (body['excellence.excellent_threshold'] !== undefined) {
        const t = Number(body['excellence.excellent_threshold']);
        if (!Number.isFinite(t) || t < 0 || t > total) {
          throw new BadRequestException(`上等马线需在 0~${total} 分之间`);
        }
      }
    }

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

