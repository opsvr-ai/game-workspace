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
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { CustomersService } from './customers.service';
import type { CreateCustomerDto, UpdateCustomerDto } from './customers.service';
import { UserRole } from '@chunlv/shared';
import type { ApiResponse } from '@chunlv/shared';

@Controller()
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get('customers')
  async findAll(@Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.customersService.findAll(req.user);
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

  @Get('customers/:id')
  async findOne(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    const data = await this.customersService.findOne(id);
    return { code: 200, message: 'ok', data };
  }

  @Post('customers')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async create(@Body() dto: CreateCustomerDto): Promise<ApiResponse<unknown>> {
    const data = await this.customersService.create(dto);
    return { code: 200, message: 'ok', data };
  }

  @Put('customers/:id')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.COMPANION)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.customersService.update(id, dto);
    return { code: 200, message: 'ok', data };
  }

  @Delete('customers/:id')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async delete(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    await this.customersService.delete(id);
    return { code: 200, message: 'ok', data: null };
  }

  @Get('customers/:id/orders')
  async findOrders(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    const data = await this.customersService.findOrders(id);
    return { code: 200, message: 'ok', data };
  }

  @Put('customers/:id/reassign')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async reassign(
    @Param('id') id: string,
    @Body('companionId') companionId: string | null,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.customersService.reassign(id, companionId);
    return { code: 200, message: 'ok', data };
  }

  @Get('customers/:id/type')
  async getCustomerType(
    @Param('id') id: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.customersService.detectCustomerType(id);
    return { code: 200, message: 'ok', data };
  }

  @Get('customers/:id/profile')
  async getProfile(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    const data = await this.customersService.getOrCreateProfile(id);
    return { code: 200, message: 'ok', data };
  }

  @Put('customers/:id/profile')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.COMPANION)
  async updateProfile(
    @Param('id') id: string,
    @Body() dto: any,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.customersService.updateProfile(id, dto);
    return { code: 200, message: 'ok', data };
  }

  @Get('customers/:id/follow-ups')
  async getFollowUps(
    @Param('id') id: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.customersService.getFollowUps(id);
    return { code: 200, message: 'ok', data };
  }

  @Post('customers/:id/follow-ups')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.COMPANION)
  async addFollowUp(
    @Param('id') id: string,
    @Req() req: any,
    @Body() dto: { content: string; nextAction?: string },
  ): Promise<ApiResponse<unknown>> {
    const data = await this.customersService.addFollowUp({
      customerId: id,
      content: dto.content,
      nextAction: dto.nextAction,
      playerId: req.user.companionId,
      adminId: req.user.companionId ? undefined : req.user.id,
    });
    return { code: 201, message: 'ok', data };
  }
}
