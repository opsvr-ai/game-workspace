import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
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
  @Roles(UserRole.ADMIN, UserRole.OWNER)
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
}
