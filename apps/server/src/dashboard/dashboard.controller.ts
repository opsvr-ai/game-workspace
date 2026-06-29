import { Controller, Get, Query, Req, UseGuards, Param } from '@nestjs/common';
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
    const data = await this.dashboardService.getDashboard(req.user.studioId);
    return { code: 200, message: 'ok', data };
  }

  @Get('trend')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async getTrend(@Req() req: any, @Query('days') days?: string): Promise<ApiResponse<unknown>> {
    const data = await this.dashboardService.getTrend(req.user.studioId, days ? parseInt(days) : 7);
    return { code: 200, message: 'ok', data };
  }

  @Get('companions')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async getCompanionStatus(@Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.dashboardService.getCompanionStatus(req.user.studioId);
    return { code: 200, message: 'ok', data };
  }

  @Get('performance/daily')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async getDailyPerformance(@Req() req: any, @Query('date') date?: string): Promise<ApiResponse<unknown>> {
    const data = await this.dashboardService.getDailyPerformance(req.user.studioId, date);
    return { code: 200, message: 'ok', data };
  }

  @Get('performance/monthly')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async getMonthlyPerformance(@Req() req: any, @Query('month') month?: string): Promise<ApiResponse<unknown>> {
    const data = await this.dashboardService.getMonthlyPerformance(req.user.studioId, month);
    return { code: 200, message: 'ok', data };
  }

  @Get('revenue-overview')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async getRevenueOverview(@Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.dashboardService.getRevenueOverview(req.user.studioId);
    return { code: 200, message: 'ok', data };
  }

  @Get('companion-revenue/:id')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async getCompanionRevenueDetail(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    const data = await this.dashboardService.getCompanionRevenueDetail(id);
    return { code: 200, message: 'ok', data };
  }
}
