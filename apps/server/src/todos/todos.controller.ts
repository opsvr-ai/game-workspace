// craftsman-ignore: TS001,TS003
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { UserRole } from '@chunlv/shared';
import type { ApiResponse } from '@chunlv/shared';
import { TodosService } from './todos.service';

/**
 * 待处理工作台（老板 2026-10-06）：把店长 / 老板 / 客服今天要处理的事汇总成一份清单。
 * 只读 + 跳转 —— 同意 / 驳回 / 拍板还在各自页面上做（权限、留痕、通知都不用重写）。
 */
@Controller()
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class TodosController {
  constructor(private readonly todosService: TodosService) {}

  @Get('todos')
  @Roles(UserRole.CS, UserRole.ADMIN, UserRole.OWNER)
  async get(@Req() req: any): Promise<ApiResponse<unknown>> {
    const data = await this.todosService.get(req.user);
    return { code: 200, message: 'ok', data };
  }
}
