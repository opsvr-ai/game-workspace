// craftsman-ignore: TS001
import { Controller, Post, Get, Delete, Put, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { WsGateway } from '../ws/ws.gateway';
import { UserRole } from '@chunlv/shared';
import { BridgeService } from './bridge.service';

@Controller('bridges')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class BridgeController {
  constructor(
    private readonly bridgeService: BridgeService,
    private readonly wsGateway: WsGateway,
  ) {}

  @Post('propose')
  @Roles(UserRole.ADMIN)
  async propose(@Req() req: any, @Body('targetStudioId') targetStudioId: string) {
    const data = await this.bridgeService.propose(req.user.studioId, targetStudioId, req.user.id);
    return { code: 200, message: '桥接申请已发送', data };
  }

  @Post(':id/respond')
  @Roles(UserRole.ADMIN)
  async respond(@Param('id') id: string, @Req() req: any, @Body() body: { accept: boolean; functionFilter?: string[] }) {
    const bridge = await this.bridgeService.find(id);
    const data = await this.bridgeService.respond(id, req.user.studioId, body.accept, body.functionFilter);
    // Notify the proposing admin about the response via WebSocket
    if (bridge?.proposedBy) {
      this.wsGateway?.notifyUser(bridge.proposedBy, 'bridge:responded', {
        bridgeId: id,
        accepted: body.accept,
        message: body.accept ? '对方已同意桥接申请' : '对方已拒绝桥接申请',
      });
    }
    return { code: 200, message: body.accept ? '已同意桥接' : '已拒绝桥接', data };
  }

  @Put(':id/permissions')
  @Roles(UserRole.ADMIN)
  async updatePermissions(@Param('id') id: string, @Req() req: any, @Body() body: { functions?: string[] }) {
    const data = await this.bridgeService.updatePermissions(id, req.user.studioId, body?.functions || []);
    return { code: 200, message: '共享内容已更新', data };
  }

  @Get()
  @Roles(UserRole.ADMIN)
  async list(@Req() req: any) {
    const active = await this.bridgeService.getActiveBridges(req.user.studioId);
    const pending = await this.bridgeService.listPending(req.user.studioId);
    return { code: 200, message: 'ok', data: { active, pending } };
  }

  @Get('active')
  async active(@Req() req: any) {
    const data = await this.bridgeService.getActiveBridges(req.user.studioId);
    return { code: 200, message: 'ok', data };
  }

  /**
   * 桥接往来对账（只统计）：这个月「我店发的单被对方店陪玩接了多少、我该给对方店多少钱」
   * 和「对方店的单被我店陪玩接了多少、对方店该给我多少钱」。
   * 钱由两个店长自己在微信上结，系统只把账摆清楚。老板可以多传一个 `studioId` 看任意一家店。
   */
  @Get('settlement')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async settlement(
    @Req() req: any,
    @Query('month') month?: string,
    @Query('peerStudioId') peerStudioId?: string,
    @Query('studioId') studioIdQuery?: string,
  ) {
    const now = new Date();
    const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const m = /^\d{4}-\d{2}$/.test(month || '') ? (month as string) : cur;
    const isOwner = req.user?.role === UserRole.OWNER;
    const studioId = isOwner
      ? studioIdQuery || req.user?.studioId || ''
      : req.user?.studioId || '';
    const data = await this.bridgeService.settlementStats(studioId, m, peerStudioId);
    return { code: 200, message: 'ok', data };
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  async remove(@Param('id') id: string, @Req() req: any) {
    await this.bridgeService.terminate(id, req.user.studioId);
    return { code: 200, message: '已断开桥接', data: null };
  }
}
