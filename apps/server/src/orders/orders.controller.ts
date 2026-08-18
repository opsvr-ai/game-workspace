// craftsman-ignore: TS001,TS003
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

  @Get('orders/urgent')
  @Roles(UserRole.CS, UserRole.ADMIN, UserRole.OWNER)
  async urgent(@Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.findUrgent(req.user?.studioId);
    return { code: 200, message: 'ok', data };
  }

  @Put('orders/:id/cs-contact')
  @Roles(UserRole.CS, UserRole.ADMIN, UserRole.OWNER)
  async markCsContact(
    @Param('id') id: string,
    @Body() body: { status: string; evidenceUrl?: string; workWechatId?: string; workWechatName?: string; addResult?: string },
  ): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.markCsContact(id, body?.status || 'added', body?.evidenceUrl, {
      workWechatId: body?.workWechatId,
      workWechatName: body?.workWechatName,
      addResult: body?.addResult,
    });
    return { code: 200, message: '已记录客服联系状态', data };
  }

  @Post('orders/:id/redispatch')
  @Roles(UserRole.CS, UserRole.ADMIN, UserRole.OWNER)
  async redispatch(@Param('id') id: string, @Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.redispatch(id, req.user?.studioId || undefined);
    return { code: 200, message: '已重新派到抢单池', data };
  }

  @Post('orders/:id/pool-handled')
  @Roles(UserRole.CS, UserRole.ADMIN, UserRole.OWNER)
  async markPoolHandled(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.markPoolHandled(id);
    return { code: 200, message: '已标记处理完成', data };
  }

  @Get('orders/cs-followup')
  @Roles(UserRole.CS, UserRole.ADMIN, UserRole.OWNER)
  async csFollowup(@Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.listCsFollowup(req.user.studioId);
    return { code: 200, message: 'ok', data };
  }

  @Get('orders/:id/money-flows')
  @Roles(UserRole.CS, UserRole.ADMIN, UserRole.OWNER)
  async listMoneyFlows(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.listMoneyFlows(id);
    return { code: 200, message: 'ok', data };
  }

  @Post('orders/:id/money-flows')
  @Roles(UserRole.CS, UserRole.ADMIN, UserRole.OWNER)
  async addMoneyFlow(
    @Param('id') id: string,
    @Body() body: { direction: string; amount: number; counterpart: string; counterpartId?: string; note?: string },
  ): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.addMoneyFlow(id, body);
    return { code: 201, message: '已记录', data };
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
    const data = await this.ordersService.complete(id, req.user?.studioId, req.user?.companionId, req.user?.role);
    return { code: 200, message: '完成成功', data };
  }

  @Post('orders/:id/refund')
  @Roles(UserRole.CS, UserRole.ADMIN, UserRole.OWNER, UserRole.COMPANION)
  async refund(@Param('id') id: string, @Req() req: any, @Body() body: { reason?: string }): Promise<ApiResponse<unknown>> {
    if (!body?.reason?.trim()) {
      return { code: 400, message: '请填写退款原因', data: null };
    }
    const data = await this.ordersService.markRefund(id, req.user?.companionId, body.reason.trim());
    return { code: 200, message: '已退款', data };
  }

  @Post('orders/:id/deposit')
  @Roles(UserRole.CS, UserRole.ADMIN, UserRole.OWNER, UserRole.COMPANION)
  async deposit(@Param('id') id: string, @Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.markDeposit(id, req.user?.companionId);
    return { code: 200, message: '已存单', data };
  }

  @Post('orders/:id/complete-billing')
  @Roles(UserRole.COMPANION)
  async completeWithBilling(@Param('id') id: string, @Req() req: any, @Body() dto: any): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.completeWithBilling(id, req.user.companionId, dto);
    return { code: 200, message: '服务结算完成', data };
  }

  @Post('orders/:id/cancel')
  @Roles(UserRole.CS, UserRole.ADMIN, UserRole.OWNER, UserRole.COMPANION)
  async cancel(@Param('id') id: string, @Req() req: any, @Body() body: { reason?: string }): Promise<ApiResponse<unknown>> {
    if (req.user?.role === 'COMPANION' && !body?.reason?.trim()) {
      return { code: 400, message: '请填写取消原因', data: null };
    }
    const data = await this.ordersService.cancel(
      id,
      req.user?.studioId,
      req.user?.companionId,
      req.user?.role,
      body?.reason?.trim(),
    );
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

  @Get('orders/:id/sessions')
  @Roles(UserRole.COMPANION, UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async getSessions(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.getSessions(id);
    return { code: 200, message: 'ok', data };
  }

  @Post('orders/:id/sessions')
  @Roles(UserRole.COMPANION)
  async addSession(@Param('id') id: string, @Body() body: any, @Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.addSession(id, {
      companionId: req.user.companionId,
      coCompanionId: body.coCompanionId,
      amount: body.amount,
      coAmount: body.coAmount,
      duration: body.duration,
    });
    return { code: 200, message: '续费成功', data };
  }

  @Put('sessions/:sessionId/start')
  @Roles(UserRole.COMPANION)
  async startSession(@Param('sessionId') id: string, @Req() req: any, @Body() body: any): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.startSession(id, req.user.companionId, {
      claimedMode: body?.claimedMode,
      claimedPrice: body?.claimedPrice,
      transferScreenshotUrl: body?.transferScreenshotUrl,
      duration: body?.duration,
    });
    return { code: 200, message: '计时开始', data };
  }

  @Put('sessions/:sessionId/pause')
  @Roles(UserRole.COMPANION)
  async pauseSession(@Param('sessionId') id: string, @Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.pauseSession(id, req.user.companionId);
    return { code: 200, message: '已暂停', data };
  }

  @Put('sessions/:sessionId/resume')
  @Roles(UserRole.COMPANION)
  async resumeSession(@Param('sessionId') id: string, @Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.resumeSession(id, req.user.companionId);
    return { code: 200, message: '已继续', data };
  }

  @Put('sessions/:sessionId/end')
  @Roles(UserRole.COMPANION)
  async endSession(@Param('sessionId') id: string, @Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.endSession(id, req.user.companionId);
    return { code: 200, message: '计时结束', data };
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

  @Post('orders/:id/claim')
  @Roles(UserRole.CS, UserRole.ADMIN, UserRole.OWNER)
  async claim(@Param('id') id: string, @Body() body: any, @Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.claim(
      id,
      req.user.id,
      {
        workWechatId: body?.workWechatId,
        workWechatName: body?.workWechatName,
        customerPaidTo: body?.customerPaidTo,
        customerPaymentAccountId: body?.customerPaymentAccountId,
        customerPaymentAccountName: body?.customerPaymentAccountName,
      },
      req.user?.studioId,
    );
    return { code: 200, message: '认领成功', data };
  }

  @Post('orders/:id/release')
  @Roles(UserRole.CS, UserRole.ADMIN, UserRole.OWNER)
  async releaseClaim(
    @Param('id') id: string,
    @Body('urgency') urgency: string,
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.releaseClaim(id, req.user.id, req.user?.studioId, req.user?.role, urgency);
    return { code: 200, message: '已放回抢单池', data };
  }

  @Post('orders/:id/mark-ready')
  @Roles(UserRole.COMPANION)
  async markReady(@Param('id') id: string, @Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.markReady(id, req.user.companionId);
    return { code: 200, message: '已准备就绪', data };
  }

  @Put('orders/:id/payment')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.CS)
  async updatePayment(
    @Param('id') id: string,
    @Body()
    body: {
      paymentAccountId?: string;
      companionFeeStatus?: string;
      companionFeeMethod?: string;
      companionFeeAccount?: string;
      companionFeeAmount?: number;
      customerPaidTo?: string;
      customerPaymentAccountId?: string;
      customerPaymentAccountName?: string;
    },
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.updatePayment(id, body, req.user);
    return { code: 200, message: 'ok', data };
  }

  @Get('orders/pending-contact-count')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async pendingContactCount(@Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.ordersService.countPendingContact(req.user.studioId);
    return { code: 200, message: 'ok', data };
  }
}
