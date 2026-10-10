// craftsman-ignore: TS001
import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { CustomerTrackingService } from './customer-tracking.service';
import { WsGateway } from '../ws/ws.gateway';
import { UserRole } from '@chunlv/shared';
import type { ApiResponse } from '@chunlv/shared';

@Controller('customer-tracking')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class CustomerTrackingController {
  constructor(
    private readonly tracking: CustomerTrackingService,
    private readonly wsGateway: WsGateway,
  ) {}

  @Post('contacts')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.COMPANION)
  async registerContact(@Req() req: any, @Body() dto: any): Promise<ApiResponse<unknown>> {
    const data = await this.tracking.registerContact(req.user, dto);
    return { code: 200, message: 'ok', data };
  }

  @Get('status')
  @Roles(UserRole.COMPANION)
  async getStatus(@Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.tracking.getStatus(req.user);
    return { code: 200, message: 'ok', data };
  }

  @Post('tracks')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.COMPANION)
  async addTrack(@Req() req: any, @Body() dto: any): Promise<ApiResponse<unknown>> {
    const data = await this.tracking.addTrack(req.user, dto);
    return { code: 200, message: 'ok', data };
  }

  @Get('tracks')
  async listTracks(@Req() req: any, @Query('customerId') customerId?: string): Promise<ApiResponse<unknown>> {
    const data = await this.tracking.listTracks(req.user, customerId);
    return { code: 200, message: 'ok', data };
  }

  @Get('reminders')
  async listReminders(@Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.tracking.listReminders(req.user);
    return { code: 200, message: 'ok', data };
  }

  @Get('journey/:customerId')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async getJourney(@Req() req: any, @Param('customerId') customerId: string): Promise<ApiResponse<unknown>> {
    const data = await this.tracking.getJourney(req.user, customerId);
    return { code: 200, message: 'ok', data };
  }

  @Post('delete-requests')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.COMPANION)
  async submitDeleteRequest(@Req() req: any, @Body() dto: any): Promise<ApiResponse<unknown>> {
    const data = await this.tracking.submitDeleteRequest(req.user, dto);
    // 陪玩申请删除客户 → 管理端实时知道（老板 2026-10-04：交互双方都要有提示）
    if (req.user?.role === 'COMPANION') {
      this.wsGateway.notifyManagers(req.user.studioId, {
        title: '待审核：陪玩申请删除客户',
        desc: `有陪玩申请删除客户${(data as any)?.customer?.wechatId ? '「' + (data as any).customer.wechatId + '」' : ''}，去「客户管理 → 删除申请」处理`,
        icon: '🗑️',
        kind: 'audit',
        hrefKey: 'customers',
        dedupeKey: `cust-del-${(data as any)?.id || ''}`,
        dedupeMs: 60 * 1000,
      });
    }
    return { code: 200, message: 'ok', data };
  }

  @Get('delete-requests')
  async listDeleteRequests(@Req() req: any, @Query('status') status?: string): Promise<ApiResponse<unknown>> {
    const data = await this.tracking.listDeleteRequests(req.user, status);
    return { code: 200, message: 'ok', data };
  }

  /** 陪玩申请删掉自己发的一条聊天消息（老板 2026-10-11：陪玩端不留任何直接删除按钮）。 */
  @Post('message-delete-requests')
  @Roles(UserRole.COMPANION)
  async submitMessageDeleteRequest(@Req() req: any, @Body() dto: any): Promise<ApiResponse<unknown>> {
    const data = await this.tracking.submitMessageDeleteRequest(req.user, dto);
    this.wsGateway.notifyManagers(req.user.studioId, {
      title: '待审核：陪玩申请删除聊天消息',
      desc: `有陪玩申请删掉一条聊天消息${dto?.reason ? '（原因：' + dto.reason + '）' : ''}，去「客户管理 → 客户追踪中心」通过或驳回`,
      icon: '🗑️',
      kind: 'audit',
      hrefKey: 'customers',
      dedupeKey: `msg-del-${(data as any)?.id || ''}`,
      dedupeMs: 60 * 1000,
    });
    return { code: 200, message: 'ok', data };
  }

  @Post('delete-requests/:id/review')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async reviewDeleteRequest(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: { approve: boolean; rejectReason?: string },
  ): Promise<ApiResponse<unknown>> {
    const data = await this.tracking.reviewDeleteRequest(req.user, id, dto.approve, dto.rejectReason);
    // 审核结果实时告诉申请人本人（老板 2026-10-04：双方都要有提示）
    const approved = dto.approve !== false;
    const isMessage = (data as any)?.targetType === 'CHAT_MESSAGE';
    const thingLabel = isMessage ? '删除聊天消息' : '删除客户';
    if ((data as any)?.companionId) {
      this.wsGateway.notifyCompanionNotice((data as any).companionId, {
        title: approved ? `${thingLabel}申请已通过` : `${thingLabel}申请被驳回`,
        desc: approved
          ? isMessage
            ? '你申请的「删除聊天消息」已通过，那条消息已撤回'
            : '你申请的「删除客户」已通过，该客户已不再显示'
          : `你申请的「${thingLabel}」被驳回${dto.rejectReason ? '：' + dto.rejectReason : ''}`,
        icon: approved ? '✅' : '⛔',
        kind: 'audit',
        hrefKey: 'customers',
      });
    }
    return { code: 200, message: 'ok', data };
  }

  @Get('kpi')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async getKpi(@Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.tracking.getKpi(req.user);
    return { code: 200, message: 'ok', data };
  }

  @Get('anomalies')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async listAnomalies(@Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.tracking.listAnomalies(req.user);
    return { code: 200, message: 'ok', data };
  }
}
