import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { OrdersService } from './orders.service';
import { UserRole } from '@chunlv/shared';
import type { ApiResponse } from '@chunlv/shared';

@Controller()
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('orders')
  @Roles(UserRole.CS, UserRole.ADMIN)
  async create(
    @Body() dto: any,
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.create({
      ...dto,
      csUserId: req.user.id,
    });
    return { code: 201, message: '创建成功', data };
  }

  @Get('orders/pool')
  async findPool(): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.findPool();
    return { code: 200, message: 'ok', data };
  }

  @Get('orders')
  @Roles(UserRole.CS, UserRole.ADMIN, UserRole.COMPANION)
  async findAll(@Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.findAll(req.user);
    return { code: 200, message: 'ok', data };
  }

  @Post('orders/:id/grab')
  @Roles(UserRole.COMPANION)
  async grab(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.grab(id, req.user.companionId);
    return { code: 200, message: '抢单成功', data };
  }

  @Post('orders/:id/assign')
  @Roles(UserRole.CS, UserRole.ADMIN)
  async assign(
    @Param('id') id: string,
    @Body('companionId') companionId: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.assign(id, companionId);
    return { code: 200, message: '指派成功', data };
  }

  @Post('orders/:id/confirm')
  @Roles(UserRole.COMPANION)
  async confirm(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.confirm(id, req.user.companionId);
    return { code: 200, message: '确认成功', data };
  }

  @Post('orders/:id/complete')
  @Roles(UserRole.CS, UserRole.ADMIN, UserRole.COMPANION)
  async complete(
    @Param('id') id: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.complete(id);
    return { code: 200, message: '完成成功', data };
  }

  @Post('orders/:id/cancel')
  @Roles(UserRole.CS, UserRole.ADMIN)
  async cancel(
    @Param('id') id: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.cancel(id);
    return { code: 200, message: '取消成功', data };
  }
}
