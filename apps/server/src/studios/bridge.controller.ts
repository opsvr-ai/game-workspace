// craftsman-ignore: TS001
import { Controller, Post, Get, Delete, Param, Body, Req, UseGuards } from '@nestjs/common';
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
  @Roles(UserRole.ADMIN, UserRole.CS)
  async propose(@Req() req: any, @Body('targetStudioId') targetStudioId: string) {
    const data = await this.bridgeService.propose(req.user.studioId, targetStudioId, req.user.id);
    return { code: 200, message: '桥接申请已发送', data };
  }

  @Post(':id/respond')
  @Roles(UserRole.ADMIN, UserRole.CS)
  async respond(@Param('id') id: string, @Req() req: any, @Body() body: { accept: boolean }) {
    const bridge = await this.bridgeService.find(id);
    const data = await this.bridgeService.respond(id, req.user.studioId, body.accept);
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

  @Get()
  @Roles(UserRole.ADMIN, UserRole.CS)
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

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.CS)
  async remove(@Param('id') id: string, @Req() req: any) {
    await this.bridgeService.terminate(id, req.user.studioId);
    return { code: 200, message: '已断开桥接', data: null };
  }
}
