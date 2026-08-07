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
}
