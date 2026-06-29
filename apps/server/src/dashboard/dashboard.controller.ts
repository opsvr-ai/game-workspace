import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { DashboardService } from './dashboard.service';
import { UserRole } from '@chunlv/shared';
import type { ApiResponse } from '@chunlv/shared';

@Controller('dashboard')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async getDashboard(@Req() req: any): Promise<ApiResponse<unknown>> {
    const studioId = req.user.studioId;
    const data = await this.dashboardService.getDashboard(studioId);
    return { code: 200, message: 'ok', data };
  }

  @Get('trend')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async getTrend(
    @Req() req: any,
    @Query('days') days?: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.dashboardService.getTrend(
      req.user.studioId,
      days ? parseInt(days) : 7,
    );
    return { code: 200, message: 'ok', data };
  }

  @Get('companions')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async getCompanionStatus(@Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.dashboardService.getCompanionStatus(req.user.studioId);
    return { code: 200, message: 'ok', data };
  }
}
