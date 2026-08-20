// craftsman-ignore: TS001,TS003
import { Controller, Get, Post, Put, Delete, Body, Query, Param, Req, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { StudiosService } from './studios.service';
import { CreateStudioDto } from './dto/create-studio.dto';
import { UpdateStudioDto } from './dto/update-studio.dto';
import { UserRole } from '@chunlv/shared';
import type { ApiResponse } from '@chunlv/shared';

@Controller()
export class StudiosController {
  constructor(private readonly studiosService: StudiosService) {}

  @Get('studios')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  async findAll(): Promise<ApiResponse<unknown>> {
    const data = await this.studiosService.findAll();
    return { code: 200, message: 'ok', data };
  }

  @Get('studios/public')
  async listPublic(): Promise<ApiResponse<unknown>> {
    const data = await this.studiosService.listPublic();
    return { code: 200, message: 'ok', data };
  }

  @Post('studios')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.OWNER)
  @UseInterceptors(FileInterceptor('leaseContract', {
    storage: diskStorage({
      destination: join(process.cwd(), '../../uploads/studios'),
      filename: (_req, file, cb) => {
        if (!existsSync(join(process.cwd(), '../../uploads/studios'))) {
          mkdirSync(join(process.cwd(), '../../uploads/studios'), { recursive: true });
        }
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + extname(file.originalname));
      },
    }),
  }))
  async create(@Body() dto: CreateStudioDto, @UploadedFile() file?: Express.Multer.File): Promise<ApiResponse<unknown>> {
    const leaseContractUrl = file ? `/uploads/studios/${file.filename}` : undefined;
    const data = await this.studiosService.create(
      dto.name, dto.type, dto.managerUsername, dto.managerPassword, dto.managerDisplayName, dto.splitMode, dto.address, leaseContractUrl,
    );
    return { code: 200, message: '工作室及店长账号已创建', data };
  }

  @Delete('studios/:id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.OWNER)
  async delete(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    await this.studiosService.delete(id);
    return { code: 200, message: '工作室已删除', data: null };
  }

  @Put('studios/:id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateStudioDto,
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    // ADMIN can only edit their own studio
    if (req.user?.role === 'ADMIN' && id !== req.user?.studioId) {
      return { code: 403, message: '无权编辑其他工作室', data: null };
    }
    const data = await this.studiosService.update(id, dto.name, dto.type, dto.splitMode, (dto as any).address, (dto as any).displayName, (dto as any).logoUrl);
    return { code: 200, message: 'ok', data };
  }

  @Get('studios/online-clubs')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  async listOnlineClubs(@Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.studiosService.listOnlineClubs(req.user.studioId);
    return { code: 200, message: 'ok', data };
  }

  @Post('studios/online-clubs')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.OWNER)
  async createOnlineClub(@Body() body: { name: string; displayName?: string }, @Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.studiosService.createOnlineClub(req.user.studioId, body?.name, body?.displayName);
    return { code: 200, message: '线上俱乐部已添加并自动桥接', data };
  }

  @Get('employees')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.CS)
  async getEmployees(@Query('studioId') studioId: string, @Query('studioType') studioType?: string, @Query('role') role?: string, @Req() req?: any): Promise<ApiResponse<unknown>> {
    // CS/ADMIN can only see their own studio; OWNER can filter by any studio
    const effectiveStudioId = (req?.user?.role === 'OWNER') ? studioId : (req?.user?.studioId || studioId);
    const data = await this.studiosService.getEmployees(effectiveStudioId, studioType, role);
    return { code: 200, message: 'ok', data };
  }

  @Post('employees')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.CS)
  async createEmployee(
    @Body() dto: { username: string; password: string; role: string; studioId: string },
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    // CS can only create in own studio and cannot create ADMIN/OWNER
    const effectiveStudioId = req.user.role === 'OWNER' ? dto.studioId : req.user.studioId;
    if (req.user.role === 'CS' && dto.role !== UserRole.COMPANION && dto.role !== UserRole.CS) {
      return { code: 403, message: '客服只能创建陪玩或客服账号', data: null };
    }
    if (req.user.role === 'ADMIN' && dto.role === UserRole.OWNER) {
      return { code: 403, message: '管理员无法创建老板账号', data: null };
    }
    const data = await this.studiosService.createEmployee(effectiveStudioId, dto);
    return { code: 200, message: 'ok', data };
  }

  @Put('employees/:id/password')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.CS)
  async resetPassword(
    @Param('id') id: string,
    @Body('password') password: string,
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    await this.studiosService.resetPassword(id, password, req.user?.studioId, req.user?.role);
    return { code: 200, message: 'ok', data: null };
  }

  @Delete('employees/:id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  async deleteEmployee(@Param('id') id: string, @Req() req: any): Promise<ApiResponse<unknown>> {
    await this.studiosService.deleteEmployee(id, req.user?.studioId, req.user?.role);
    return { code: 200, message: '员工已删除', data: null };
  }

  // ── Payment Accounts ──

  @Get('payment-accounts')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.CS)
  async getPaymentAccounts(@Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.studiosService.getPaymentAccounts(req.user.studioId);
    return { code: 200, message: 'ok', data };
  }

  @Post('payment-accounts')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  async createPaymentAccount(
    @Body() body: { type: string; accountName: string; accountNumber: string },
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.studiosService.createPaymentAccount({
      studioId: req.user.studioId,
      type: body.type,
      accountName: body.accountName,
      accountNumber: body.accountNumber,
    });
    return { code: 200, message: 'ok', data };
  }
}
