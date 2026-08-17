import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { UserRole } from '@chunlv/shared';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  @Get('customers')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.CS)
  async customers(@Req() req: any) {
    const studioId = req.user?.studioId;
    if (!studioId) return { code: 400, message: '未找到所属工作室', data: [] };
    return { code: 200, data: await this.service.customerAnalytics(studioId) };
  }

  @Get('companions')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.CS)
  async companions(@Req() req: any) {
    const studioId = req.user?.studioId;
    if (!studioId) return { code: 400, message: '未找到所属工作室', data: [] };
    return { code: 200, data: await this.service.companionAnalytics(studioId) };
  }

  @Get('cs')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  async cs(@Req() req: any) {
    const studioId = req.user?.studioId;
    if (!studioId) return { code: 400, message: '未找到所属工作室', data: [] };
    return { code: 200, data: await this.service.csAnalytics(studioId) };
  }

  @Get('admins')
  @Roles(UserRole.OWNER)
  async admins(@Req() req: any) {
    const studioId = req.user?.studioId;
    if (!studioId) return { code: 400, message: '未找到所属工作室', data: [] };
    return { code: 200, data: await this.service.adminAnalytics(studioId) };
  }
}
