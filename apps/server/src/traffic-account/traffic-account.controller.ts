import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { UserRole } from '@chunlv/shared';
import type { ApiResponse } from '@chunlv/shared';
import { TrafficAccountService } from './traffic-account.service';

@Controller('traffic-accounts')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.CS, UserRole.COMPANION)
export class TrafficAccountController {
  constructor(private readonly service: TrafficAccountService) {}

  @Get()
  async list(@Req() req: any): Promise<ApiResponse<unknown>> {
    return { code: 200, message: 'ok', data: await this.service.list(req.user) };
  }

  @Post()
  async create(@Req() req: any, @Body() dto: any): Promise<ApiResponse<unknown>> {
    return { code: 201, message: '已添加', data: await this.service.create(req.user, dto) };
  }

  @Put(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() dto: any): Promise<ApiResponse<unknown>> {
    return { code: 200, message: '已更新', data: await this.service.update(req.user, id, dto) };
  }

  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string): Promise<ApiResponse<unknown>> {
    return { code: 200, message: '已删除', data: await this.service.remove(req.user, id) };
  }
}
