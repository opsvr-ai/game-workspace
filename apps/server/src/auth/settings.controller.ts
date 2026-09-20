// craftsman-ignore: TS001
import {
  Controller,
  Get,
  Put,
  Delete,
  Body,
  Query,
  Req,
  UseGuards,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationService } from './authorization.service';
import { RolesGuard, Roles } from './roles.guard';
import { UserRole } from '@chunlv/shared';
import type { ApiResponse } from '@chunlv/shared';
import { WsGateway } from '../ws/ws.gateway';
import { normalizeShareTiers } from '../common/percent-split';
import { splitRoles } from '../common/order-split';

import { DEFAULT_CONFIGS, STUDIO_SCOPED_KEYS, isStudioScopedKey } from '../common/default-config';
import {
  resolveConfigsDetailed,
  saveStudioConfigs,
  resetStudioConfigs,
} from '../common/studio-config';

@Controller()
export class SettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authzService: AuthorizationService,
    @Inject(forwardRef(() => WsGateway)) private readonly wsGateway: WsGateway,
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

  /**
   * 通用配置 GET — 敏感键（identity.* / jwt.* / secret）只有老板能读。
   *
   * 老板 2026-09-21：以后进来的租赁线下工作室 / 线上俱乐部，数据由他们自己的店长填。
   * 所以这里返回的是「**这家店**的生效值**」**：店长填过的优先，没填就是老板的全局默认。
   * 另外附带 `_meta`，告诉界面哪些键是本店自定义的（好标「本店自定义 / 恢复默认」）。
   */
  @Get('config')
  @UseGuards(AuthGuard('jwt'))
  async getConfig(
    @Query('keys') keysStr?: string,
    @Req() req?: any,
    @Query('studioId') studioIdParam?: string,
  ): Promise<ApiResponse<unknown>> {
    const SENSITIVE_PREFIXES = ['identity.', 'jwt.', 'secret'];
    const keys = keysStr ? keysStr.split(',').map((k) => k.trim()) : Object.keys(DEFAULT_CONFIGS);
    const isOwner = req?.user?.role === 'OWNER';
    const safeKeys = keys.filter((k) => isOwner || !SENSITIVE_PREFIXES.some((p) => k.startsWith(p)));
    // 老板可以多传一个 studioId 去看某家店的生效值（用来查看 / 恢复那家店的自定义）
    const studioId = isOwner
      ? studioIdParam || (req?.user?.studioId as string) || null
      : (req?.user?.studioId as string) || null;
    const resolved = await resolveConfigsDetailed(this.prisma, studioId, safeKeys);
    const result: Record<string, any> = {};
    for (const k of keys) {
      result[k] = safeKeys.includes(k) ? resolved.values[k] ?? null : DEFAULT_CONFIGS[k] ?? null;
    }
    result['_meta'] = {
      role: req?.user?.role ?? null,
      studioId,
      /** 店长保存写本店（studio），老板保存写全局（global） */
      scope: studioId ? 'studio' : 'global',
      /** 本店自己填过的键 */
      overridden: resolved.overridden,
      /** 哪些键店长可以自己填 */
      studioScopedKeys: [...STUDIO_SCOPED_KEYS],
    };
    return { code: 200, message: 'ok', data: result };
  }

  /** 取出「当前生效值」的读法：老板看全局，店长看本店。 */
  private async effectiveValueGetter(
    req: any,
    keys: string[],
  ): Promise<(key: string) => any> {
    const isOwner = req?.user?.role === 'OWNER';
    const studioId = (req?.user?.studioId as string) || null;
    if (isOwner || !studioId) {
      const records = await this.prisma.systemConfig.findMany({ where: { key: { in: keys } } });
      const map = new Map<string, any>(records.map((r) => [r.key, r.value]));
      return (key: string) => (map.has(key) ? map.get(key) : DEFAULT_CONFIGS[key]);
    }
    const resolved = await resolveConfigsDetailed(this.prisma, studioId, keys);
    return (key: string) => resolved.values[key];
  }

  /**
   * 通用配置 PUT。写到哪里看身份：
   * - **老板（OWNER）** → 写全局默认（SystemConfig），影响所有店；
   * - **店长（ADMIN 且带 studioId）** → 只写本店覆盖（StudioConfig），只影响自己店；
   *   身上没有的全局项（杀黑名单开关、AI 密钥、前端版本等）不会被改，
   *   但也不会报错拒绝整次保存，而是原样返回在 `data.skipped` 里让界面提示。
   *
   * 为什么不直接报 400：设置页一次保存会带上好几个键，
   * 一个全局键就把整页店长能改的都卡死，店长就什么都改不了。
   */
  @Put('config')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async updateConfig(
    @Body() body: Record<string, any>,
    @Req() req?: any,
  ): Promise<ApiResponse<unknown>> {
    // 校验综合评分权重：四项满分之和不能超过 100，上等马线不能超过总分。
    const weightKeys = [
      'excellence.revenue_weight',
      'excellence.renew_weight',
      'excellence.repurchase_weight',
      'excellence.first_success_weight',
    ];
    if (weightKeys.some((k) => body[k] !== undefined)) {
      const get0 = await this.effectiveValueGetter(req, weightKeys);
      const map = new Map<string, number>(weightKeys.map((k) => [k, Number(get0(k)) || 0]));
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

    // 分成阶梯的「工作室 / 陪玩」是一对，必须刚好 100%（老板 2026-09-21 要求「避免超过百分百」）：
    // 陪玩那一栏才真正参与算钱，工作室 = 剩余份额，这里统一归一化，
    // 这样任何客户端（网页、陪玩端、脚本）都写不进「60 / 60 = 120%」这种配置。
    if (body['revenue.share_tiers'] !== undefined) {
      if (!Array.isArray(body['revenue.share_tiers'])) {
        throw new BadRequestException('分成阶梯格式不正确');
      }
      // 工作室那一栏 = 100 − 陪玩 − 客服 − 店长（店长 / 客服拿的也是工作室那份）。
      // 把店长 / 客服的现取值（本次提交里带了就用提交的）一并减掉，
      // 这样存进库的 studio 就是「工作室真正到手」，页面显示与对账口径不会打架。
      const getRolePct = await this.effectiveValueGetter(req, [
        'commission.cs_offline_rate_percent',
        'commission.admin_offline_rate_percent',
      ]);
      const rolePct = (key: string) =>
        Number(body[key] !== undefined ? body[key] : getRolePct(key) ?? 0);
      const deduct = rolePct('commission.cs_offline_rate_percent') + rolePct('commission.admin_offline_rate_percent');
      body['revenue.share_tiers'] = normalizeShareTiers(body['revenue.share_tiers'], deduct);
    }

    // 四个人的分成加起来不能超过 100%（老板 2026-09-21）：工作室拿剩下的，剩不下就是配错了。
    // 线下按**陪玩最高档**校验（最不利的一档），线上按俱乐部固定比例校验。
    const rolePercentKeys = [
      'commission.cs_offline_rate_percent',
      'commission.admin_offline_rate_percent',
      'commission.admin_online_rate_percent',
    ];
    if (rolePercentKeys.some((k) => body[k] !== undefined)) {
      const keys = [...rolePercentKeys, 'revenue.share_tiers', 'revenue.club_companion_share'];
      const get1 = await this.effectiveValueGetter(req, keys);
      const pick = (k: string) => (body[k] !== undefined ? body[k] : get1(k));
      const tiers = (body['revenue.share_tiers'] as any[]) ?? (get1('revenue.share_tiers') as any[]) ?? DEFAULT_CONFIGS['revenue.share_tiers'];
      const maxCompanion = Math.max(0, ...tiers.map((t) => Number(t?.companion) || 0));
      splitRoles({
        companion: maxCompanion,
        cs: pick('commission.cs_offline_rate_percent') ?? DEFAULT_CONFIGS['commission.cs_offline_rate_percent'],
        admin: pick('commission.admin_offline_rate_percent') ?? 0,
      });
      splitRoles({
        companion: Number(pick('revenue.club_companion_share') ?? 80),
        admin: pick('commission.admin_online_rate_percent') ?? 0,
      });
    }

    const isOwner = req?.user?.role === 'OWNER';
    const studioId = (req?.user?.studioId as string) || null;

    // 店长：只写本店覆盖，全局键跳过（不静默，在 skipped 里告诉对方）
    if (!isOwner && studioId) {
      const entries: Record<string, any> = {};
      const skipped: string[] = [];
      for (const [key, value] of Object.entries(body)) {
        if (isStudioScopedKey(key)) entries[key] = value;
        else skipped.push(key);
      }
      if (Object.keys(entries).length) await saveStudioConfigs(this.prisma, studioId, entries);
      return {
        code: 200,
        message: skipped.length ? '本店设置已保存，部分全局项未改动' : 'ok',
        data: { scope: 'studio', saved: Object.keys(entries), skipped },
      };
    }

    const ops = Object.entries(body).map(([key, value]) =>
      this.prisma.systemConfig.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      }),
    );
    await Promise.all(ops);
    if (body['blacklist.auto_kill'] !== undefined) {
      await this.pushBlacklistAfterToggle();
    }
    return { code: 200, message: 'ok', data: { scope: 'global', saved: Object.keys(body), skipped: [] } };
  }

  /**
   * 「恢复用老板的默认」：删掉本店自己填的覆盖。
   *
   * `keys` 不传 = 本店全部恢复默认。
   * 老板想替某家店恢复时，可以多传一个 `studioId`。
   */
  @Delete('config/studio-overrides')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async resetStudioOverrides(
    @Req() req: any,
    @Query('keys') keysStr?: string,
    @Query('studioId') studioIdParam?: string,
  ): Promise<ApiResponse<unknown>> {
    const isOwner = req?.user?.role === 'OWNER';
    const studioId = isOwner
      ? studioIdParam || (req?.user?.studioId as string) || ''
      : (req?.user?.studioId as string) || '';
    if (!studioId) throw new BadRequestException('没有可用的工作室，无法恢复默认');
    const keys = keysStr
      ? keysStr.split(',').map((k) => k.trim()).filter(Boolean)
      : [];
    const removed = await resetStudioConfigs(this.prisma, studioId, keys);
    return { code: 200, message: `已恢复用老板默认（${removed} 项）`, data: { removed } };
  }

  /**
   * 「自动结束黑名单进程」开关一改，立刻把新名单推给所有陪玩端。
   *
   * 客户端只在收到推送时才会更新本地的杀进程名单：不推的话，
   * 「关掉开关」要等下一次状态变化才生效，紧急止血会慢半拍，
   * 正在玩游戏的人会多挨几分钟。
   */
  private async pushBlacklistAfterToggle(): Promise<void> {
    try {
      // 先让缓存失效，保证推出去的名单已经按新开关算过。
      this.wsGateway.invalidateAutoKillCache();
      const companions = await this.prisma.companion.findMany({
        select: { id: true, studioId: true },
      });
      for (const c of companions) {
        if (!c.studioId) continue;
        await this.wsGateway.pushCurrentBlacklist(c.id, c.studioId, false);
      }
    } catch {
      /* 推送失败不影响配置保存：下次状态切换会重新推。 */
    }
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

