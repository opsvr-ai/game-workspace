import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { UserRole } from '@chunlv/shared';
import { PayrollService } from './payroll.service';

@Controller('payroll')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class PayrollController {
  constructor(private readonly service: PayrollService) {}

  @Get('configs')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  async configs() {
    return { code: 200, data: await this.service.listConfigs() };
  }

  @Post('configs')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  async saveConfig(@Body() dto: any) {
    return { code: 200, data: await this.service.upsertConfig(dto) };
  }

  @Get('staff')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  async staff(@Req() req: any) {
    return { code: 200, data: await this.service.listStaff(req.user.studioId) };
  }

  @Post('attendance')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  async attendance(@Body() dto: any) {
    return { code: 200, data: await this.service.markAttendance(dto) };
  }

  @Post('generate')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  async generate(@Req() req: any, @Body() dto: { month: string }) {
    return { code: 200, data: await this.service.generate(req.user.studioId, dto.month) };
  }

  @Get('records')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  async records(@Query('month') month: string) {
    return { code: 200, data: await this.service.listRecords(month) };
  }
}
