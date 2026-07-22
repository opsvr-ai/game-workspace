import { Controller, Get, Post, Put, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UserRole } from '@chunlv/shared';
import type { ApiResponse } from '@chunlv/shared';

@Controller()
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('orders')
  @Roles(UserRole.CS, UserRole.ADMIN, UserRole.OWNER, UserRole.COMPANION)
  async create(@Body() dto: CreateOrderDto, @Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.create({ ...dto, csUserId: req.user.id });
    return { code: 201, message: '创建成功', data };
  }

  @Get('orders/pool')
  async findPool(@Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.findPool(req.user?.companionId, req.user?.studioId, req.user?.studioType);
    return { code: 200, message: 'ok', data };
  }

  @Get('orders')
  @Roles(UserRole.CS, UserRole.ADMIN, UserRole.COMPANION, UserRole.OWNER)
  async findAll(
    @Req() req: any,
    @Query('status') status?: string,
    @Query('all') all?: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.findAll(req.user, status, all === 'true');
    return { code: 200, message: 'ok', data };
  }

  @Post('orders/:id/grab')
  @Roles(UserRole.COMPANION)
  async grab(@Param('id') id: string, @Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.grab(id, req.user.companionId);
    return { code: 200, message: '抢单成功', data };
  }

  @Put('orders/:id/amount')
  @Roles(UserRole.COMPANION)
  async updateAmount(
    @Param('id') id: string,
    @Body('amount') amount: number,
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.updateAmount(id, req.user.companionId, amount);
    return { code: 200, message: '已改价', data };
  }

  @Put('orders/:id/contact')
  @Roles(UserRole.COMPANION)
  async updateContact(@Param('id') id: string, @Body() body: any): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.updateContact(id, body);
    return { code: 200, message: '已更新', data };
  }

  @Post('orders/:id/compensate-customer')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.CS)
  async compensateCustomer(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    await this.ordersService.compensateCustomer(id);
    return { code: 200, message: '已补客户', data: null };
  }

  @Post('orders/:id/renew')
  @Roles(UserRole.COMPANION)
  async renew(@Param('id') id: string, @Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.renew(id, req.user.id, req.user.companionId);
    return { code: 200, message: '已续单', data };
  }

  @Post('orders/:id/republish')
  @Roles(UserRole.COMPANION)
  async republish(@Param('id') id: string, @Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.republish(id, req.user.id, req.user.companionId);
    return { code: 200, message: '已发布到抢单池', data };
  }

  @Get('orders/pool/status')
  @Roles(UserRole.COMPANION)
  async getPoolStatus(@Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.getPoolStatus(req.user.companionId);
    return { code: 200, message: 'ok', data };
  }

  @Post('orders/:id/assign')
  @Roles(UserRole.CS, UserRole.ADMIN, UserRole.OWNER)
  async assign(
    @Param('id') id: string,
    @Body('companionId') companionId: string,
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.assign(id, companionId, req.user?.studioId);
    return { code: 200, message: '指派成功', data };
  }

  @Post('orders/:id/confirm')
  @Roles(UserRole.COMPANION)
  async confirm(@Param('id') id: string, @Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.confirm(id, req.user.companionId);
    return { code: 200, message: '确认成功', data };
  }

  @Post('orders/:id/complete')
  @Roles(UserRole.CS, UserRole.ADMIN, UserRole.COMPANION)
  async complete(@Param('id') id: string, @Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.complete(id, req.user?.studioId);
    return { code: 200, message: '完成成功', data };
  }

  @Post('orders/:id/complete-billing')
  @Roles(UserRole.COMPANION)
  async completeWithBilling(@Param('id') id: string, @Req() req: any, @Body() dto: any): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.completeWithBilling(id, req.user.companionId, dto);
    return { code: 200, message: '服务结算完成', data };
  }

  @Post('orders/:id/cancel')
  @Roles(UserRole.CS, UserRole.ADMIN, UserRole.OWNER, UserRole.COMPANION)
  async cancel(@Param('id') id: string, @Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.cancel(id, req.user?.studioId, req.user?.companionId, req.user?.role);
    return { code: 200, message: '取消成功', data };
  }

  @Post('orders/:id/call-partner')
  @Roles(UserRole.COMPANION)
  async callPartner(@Param('id') id: string, @Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.callPartner(id, req.user.companionId);
    return { code: 200, message: 'ok', data };
  }

  @Post('orders/:id/accept-partner')
  @Roles(UserRole.COMPANION)
  async acceptPartner(@Param('id') id: string, @Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.acceptPartner(id, req.user.companionId);
    return { code: 200, message: 'ok', data };
  }

  @Post('orders/:id/accept-assignment')
  @Roles(UserRole.COMPANION)
  async acceptAssignment(@Param('id') id: string, @Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.acceptAssignment(id, req.user.companionId);
    return { code: 200, message: '已接单', data };
  }

  @Post('orders/:id/decline-assignment')
  @Roles(UserRole.COMPANION)
  async declineAssignment(@Param('id') id: string, @Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.declineAssignment(id, req.user.companionId);
    return { code: 200, message: '已拒绝', data };
  }

  @Post('orders/:id/quick-grab')
  @Roles(UserRole.COMPANION)
  async quickGrab(@Param('id') id: string, @Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.quickGrab(id, req.user.companionId);
    return { code: 200, message: '抢单成功', data };
  }

  @Post('orders/:id/mark-ready')
  @Roles(UserRole.COMPANION)
  async markReady(@Param('id') id: string, @Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.markReady(id, req.user.companionId);
    return { code: 200, message: '已准备就绪', data };
  }
}
