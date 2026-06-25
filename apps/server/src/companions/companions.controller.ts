import { Controller, Get, Put, Post, Param, Body, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { CompanionsService } from './companions.service';
import { WsGateway } from '../ws/ws.gateway';
import { UserRole } from '@chunlv/shared';
import type { ApiResponse } from '@chunlv/shared';

@Controller()
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class CompanionsController {
  constructor(
    private readonly companionsService: CompanionsService,
    private readonly wsGateway: WsGateway,
  ) {}

  @Get('companions')
  async findAll(@Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.companionsService.findAll(req.user);
    return { code: 200, message: 'ok', data };
  }

  @Get('companions/ranking')
  async getRanking(@Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.companionsService.getRanking(req.user);
    return { code: 200, message: 'ok', data };
  }

  @Get('companions/:id')
  async findOne(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    const data = await this.companionsService.findOne(id);
    return { code: 200, message: 'ok', data };
  }

  @Put('companions/:id/status')
  @Roles(UserRole.COMPANION)
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: string,
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.companionsService.updateStatus(id, status, req.user);
    return { code: 200, message: 'ok', data };
  }

  @Get('companions/:id/revenue')
  async getRevenue(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    const data = await this.companionsService.getRevenue(id);
    return { code: 200, message: 'ok', data };
  }

  @Post('companions/:id/command')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async sendCommand(
    @Param('id') id: string,
    @Body('command') command: string,
    @Body('params') params?: unknown,
  ): Promise<ApiResponse<unknown>> {
    this.wsGateway.sendCommand(id, command, params);
    return { code: 200, message: '指令已发送', data: { command, params } };
  }
}
