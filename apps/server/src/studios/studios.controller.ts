import { Controller, Get, Post, Put, Delete, Body, Query, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { StudiosService } from './studios.service';
import { CreateStudioDto } from './dto/create-studio.dto';
import { UpdateStudioDto } from './dto/update-studio.dto';
import { UserRole } from '@chunlv/shared';
import type { ApiResponse } from '@chunlv/shared';

@Controller()
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class StudiosController {
  constructor(private readonly studiosService: StudiosService) {}

  @Get('studios')
  @Roles(UserRole.OWNER)
  async findAll(): Promise<ApiResponse<unknown>> {
    const data = await this.studiosService.findAll();
    return { code: 200, message: 'ok', data };
  }

  @Post('studios')
  @Roles(UserRole.OWNER)
  async create(@Body() dto: CreateStudioDto): Promise<ApiResponse<unknown>> {
    const data = await this.studiosService.create(
      dto.name, dto.type, dto.managerUsername, dto.managerPassword, dto.managerDisplayName, dto.splitMode,
    );
    return { code: 200, message: '工作室及店长账号已创建', data };
  }

  @Delete('studios/:id')
  @Roles(UserRole.OWNER)
  async delete(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    await this.studiosService.delete(id);
    return { code: 200, message: '工作室已删除', data: null };
  }

  @Put('studios/:id')
  @Roles(UserRole.OWNER)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateStudioDto,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.studiosService.update(id, dto.name, dto.type, dto.splitMode);
    return { code: 200, message: 'ok', data };
  }

  @Get('employees')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.CS)
  async getEmployees(@Query('studioId') studioId: string): Promise<ApiResponse<unknown>> {
    const data = await this.studiosService.getEmployees(studioId);
    return { code: 200, message: 'ok', data };
  }

  @Post('employees')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  async createEmployee(
    @Body() dto: { username: string; password: string; role: string; studioId: string },
  ): Promise<ApiResponse<unknown>> {
    const data = await this.studiosService.createEmployee(dto.studioId, dto);
    return { code: 200, message: 'ok', data };
  }

  @Put('employees/:id/password')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  async resetPassword(
    @Param('id') id: string,
    @Body('password') password: string,
  ): Promise<ApiResponse<unknown>> {
    await this.studiosService.resetPassword(id, password);
    return { code: 200, message: 'ok', data: null };
  }

  @Delete('employees/:id')
  @Roles(UserRole.OWNER)
  async deleteEmployee(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    await this.studiosService.deleteEmployee(id);
    return { code: 200, message: '员工已删除', data: null };
  }
}
