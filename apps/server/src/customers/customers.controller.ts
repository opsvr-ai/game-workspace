// craftsman-ignore: TS001
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { CustomersService } from './customers.service';
import type { CreateCustomerDto, UpdateCustomerDto } from './customers.service';
import { UserRole } from '@chunlv/shared';
import type { ApiResponse } from '@chunlv/shared';
import { CustomerProfileSourceMaskInterceptor } from '../common/customer-source-mask.interceptor';
import { WsGateway } from '../ws/ws.gateway';

@Controller()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@UseInterceptors(CustomerProfileSourceMaskInterceptor)
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly wsGateway: WsGateway,
  ) {}

  @Get('customers')
  async findAll(
    @Req() req: any,
    @Query('sortBy') sortBy?: string,
    @Query('scope') scope?: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.customersService.findAll(req.user, sortBy, scope);
    return { code: 200, message: 'ok', data };
  }

  /**
   * 客户看板（老板 2026-10-03）：「店长端 + 陪玩端 加一个看板，罗列所有的客户，
   * 每个客户的消费情况 + 是不是正在跟陪玩打游戏……消费金额 / 游戏时长 / 正在跟陪玩打的排在最上边」。
   *
   * MUST be before :id routes（`customers/:id` 会把 `board` 当成一个 id）。
   * 四个角色都能进：陪玩只拿到自己的客户，店长 / 客服拿到本店，老板拿全站。
   */
  @Get('customers/board')
  async customerBoard(
    @Req() req: any,
    @Query('sort') sort?: string,
    @Query('companionId') companionId?: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.customersService.customerBoard(req.user, { sort, companionId });
    return { code: 200, message: 'ok', data };
  }
  // ── Traffic Pool (MUST be before :id routes) ──

  @Get('customers/traffic/pool')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async getTrafficPool(@Req() req: any, @Query('platform') platform?: string): Promise<ApiResponse<unknown>> {
    const data = await this.customersService.getTrafficPool(req.user.studioId, platform);
    return { code: 200, message: 'ok', data };
  }

  @Get('customers/traffic/stats')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async getChannelStats(@Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.customersService.getChannelStats(req.user.studioId);
    return { code: 200, message: 'ok', data };
  }

  // ── 重复客户档案（MUST be before :id routes）——老板 2026-09-29 ──

  @Get('customers/duplicates')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async listDuplicates(@Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.customersService.listDuplicateGroups(req.user.studioId);
    return { code: 200, message: 'ok', data };
  }

  @Post('customers/:id/merge-into')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async mergeInto(
    @Param('id') id: string,
    @Body() dto: { targetId: string },
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.customersService.mergeCustomers(id, dto?.targetId, req.user);
    return { code: 200, message: '已合并', data };
  }

  @Get('customers/:id')
  async findOne(@Param('id') id: string, @Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.customersService.findOne(id, req.user);
    return { code: 200, message: 'ok', data };
  }

  @Get('customers/:id/deposits')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS, UserRole.COMPANION)
  async listDeposits(@Param('id') id: string, @Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.customersService.listDeposits(id, req.user);
    return { code: 200, message: 'ok', data };
  }

  @Post('customers/:id/deposits')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS, UserRole.COMPANION)
  async createDeposit(
    @Param('id') id: string,
    @Body() body: { amount: number; screenshotUrl?: string; note?: string },
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.customersService.createDeposit(id, body, req.user);
    return { code: 200, message: '存单已记录', data };
  }

  @Post('customers')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS, UserRole.COMPANION)
  async create(@Body() dto: CreateCustomerDto, @Req() req: any): Promise<ApiResponse<unknown>> {
    // 陪玩也能录入自己的老客户：归属到当前陪玩名下；CS/店长/老板按各自工作室。
    const user = req.user;
    const data = await this.customersService.create({
      ...dto,
      studioId: dto.studioId || user?.studioId || '',
      companionId: dto.companionId ?? (user?.role === 'COMPANION' ? user?.companionId ?? null : null),
      isLegacy: dto.isLegacy ?? (user?.role === 'COMPANION'),
    });
    return { code: 200, message: 'ok', data };
  }

  @Put('customers/:id')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.COMPANION)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.customersService.update(id, dto, req.user);
    return { code: 200, message: 'ok', data };
  }

  /**
   * 封存客户（老板 2026-10-04）：客户一直不通过、小红书也不回 → 先收起来，以后再换人加。
   * 不删档案、不动订单流水。
   */
  @Post('customers/:id/archive')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async archive(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.customersService.archive(id, req.user, body?.reason);
    // 客户被封存，名下的陪玩要实时知道（老板 2026-10-04：交互双方都要有提示）
    if ((data as any)?.companionId) {
      this.wsGateway.notifyCompanionNotice((data as any).companionId, {
        title: '你的客户已被封存',
        desc: `客户${(data as any)?.wechatId ? '「' + (data as any).wechatId + '」' : ''}已被店长封存，暂时不在你的客户列表里${body?.reason ? '（原因：' + body.reason + '）' : ''}`,
        icon: '🧊',
        kind: 'system',
        hrefKey: 'customers',
      });
    }
    return { code: 200, message: 'ok', data };
  }

  /** 解封（老板 2026-10-04）：可以顺手改派给另一个陪玩再试一次。 */
  @Post('customers/:id/unarchive')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async unarchive(
    @Param('id') id: string,
    @Body() body: { companionId?: string },
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.customersService.unarchive(id, req.user, { companionId: body?.companionId });
    // 解封（可能顺手改派）→ 新的归属陪玩要实时知道
    if ((data as any)?.companionId) {
      this.wsGateway.notifyCompanionNotice((data as any).companionId, {
        title: body?.companionId ? '客户已解封并改派给你' : '你的客户已解封',
        desc: `客户${(data as any)?.wechatId ? '「' + (data as any).wechatId + '」' : ''}已解封，可以再试着加一次微信`,
        icon: '🔓',
        kind: 'system',
        hrefKey: 'customers',
      });
    }
    return { code: 200, message: 'ok', data };
  }

  @Delete('customers/:id')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async delete(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    await this.customersService.delete(id);
    return { code: 200, message: 'ok', data: null };
  }

  @Get('customers/:id/orders')
  async findOrders(@Param('id') id: string, @Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.customersService.findOrders(id, req.user);
    return { code: 200, message: 'ok', data };
  }

  @Put('customers/:id/reassign')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async reassign(
    @Param('id') id: string,
    @Body('companionId') companionId: string | null,
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.customersService.reassign(id, companionId, req.user);
    return { code: 200, message: 'ok', data };
  }

  @Get('customers/:id/type')
  async getCustomerType(
    @Param('id') id: string, @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.customersService.detectCustomerType(id, req.user);
    return { code: 200, message: 'ok', data };
  }

  /**
   * 客户画像（老板 2026-10-04）：一个客户在哪些工作微信 / 陪玩身上消费了多少、打机密还是绝密、
   * 打了多久、维护多久，并给出「下次该派给谁」的建议。
   */
  @Get('customers/:id/profile-analytics')
  async profileAnalytics(@Param('id') id: string, @Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.customersService.customerProfileAnalytics(id, req.user);
    return { code: 200, message: 'ok', data };
  }

  @Get('customers/:id/profile')
  async getProfile(@Param('id') id: string, @Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.customersService.getOrCreateProfile(id, req.user);
    return { code: 200, message: 'ok', data };
  }

  @Put('customers/:id/profile')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.COMPANION)
  async updateProfile(
    @Param('id') id: string,
    @Body() dto: any,
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.customersService.updateProfile(id, dto, req.user);
    return { code: 200, message: 'ok', data };
  }

  @Get('customers/:id/follow-ups')
  async getFollowUps(
    @Param('id') id: string, @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.customersService.getFollowUps(id, req.user);
    return { code: 200, message: 'ok', data };
  }

  // 客服也能记跟进（跟进台账里的「记跟进」就是这个接口）——老板 2026-09-29
  @Post('customers/:id/follow-ups')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.COMPANION, UserRole.CS)
  async addFollowUp(
    @Param('id') id: string,
    @Req() req: any,
    @Body()
    dto: { content: string; nextAction?: string; nextFollowUpAt?: string; workWechatName?: string },
  ): Promise<ApiResponse<unknown>> {
    const data = await this.customersService.addFollowUp({
      customerId: id,
      content: dto.content,
      nextAction: dto.nextAction,
      nextFollowUpAt: dto.nextFollowUpAt,
      workWechatName: dto.workWechatName,
      playerId: req.user.companionId,
      adminId: req.user.companionId ? undefined : req.user.id,
    }, req.user);
    return { code: 201, message: 'ok', data };
  }
}
