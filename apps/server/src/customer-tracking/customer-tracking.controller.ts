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
import { UserRole } from '@chunlv/shared';
import type { ApiResponse } from '@chunlv/shared';

@Controller('customer-tracking')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class CustomerTrackingController {
  constructor(private readonly tracking: CustomerTrackingService) {}

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

  @Post('delete-requests')
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.COMPANION)
  async submitDeleteRequest(@Req() req: any, @Body() dto: any): Promise<ApiResponse<unknown>> {
    const data = await this.tracking.submitDeleteRequest(req.user, dto);
    return { code: 200, message: 'ok', data };
  }

  @Get('delete-requests')
  async listDeleteRequests(@Req() req: any, @Query('status') status?: string): Promise<ApiResponse<unknown>> {
    const data = await this.tracking.listDeleteRequests(req.user, status);
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
    return { code: 200, message: 'ok', data };
  }
}
