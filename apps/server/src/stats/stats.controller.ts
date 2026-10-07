// craftsman-ignore: TS001,TS003
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { UserRole } from '@chunlv/shared';
import { StatsService } from './stats.service';
import type { ApiResponse } from '@chunlv/shared';

@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('daily')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.CS, UserRole.COMPANION)
  async getDailyStats(
    @Query('date') date: string,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
    @Query('csUserId') csUserId: string,
    @Query('studioId') studioId: string,
    @Query('status') status: string,
    @Query('gameName') gameName: string,
    @Query('feeStatus') feeStatus: string,
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.statsService.getDailyStats({
      date,
      dateFrom,
      dateTo,
      csUserId,
      studioId,
      status,
      gameName,
      feeStatus,
    }, req.user);
    return { code: 200, message: 'ok', data };
  }

  /**
   * 每日数据（老板 2026-10-07）：「每天打了多少单、多少续了、多少复购了、什么客户」，
   * 一个营业日一行，点开某一天看明细。陪玩端只能看自己；管理端看全店，可筛某个陪玩。
   */
  @Get('daily-kpi')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.CS, UserRole.COMPANION)
  async getDailyKpi(
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
    @Query('companionId') companionId: string,
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.statsService.getDailyKpi({ dateFrom, dateTo, companionId }, req.user);
    return { code: 200, message: 'ok', data };
  }

  /** 每日数据 · 明细：某一天的每张单 + 每个客户的当天 / 累计情况。 */
  @Get('daily-kpi/detail')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.CS, UserRole.COMPANION)
  async getDailyKpiDetail(
    @Query('date') date: string,
    @Query('companionId') companionId: string,
    @Query('kind') kind: string,
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.statsService.getDailyKpiDetail({ date, companionId, kind }, req.user);
    return { code: 200, message: 'ok', data };
  }
}
