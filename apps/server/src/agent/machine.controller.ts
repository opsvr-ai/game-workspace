// craftsman-ignore: TS001,TS003
import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { UserRole } from '@chunlv/shared';
import { MachineService } from './machine.service';
import { ONBOARD_REPORT_TOKEN } from './agent-token';
import type { ApiResponse } from '@chunlv/shared';

/**
 * 机器台账 / 远程诊断接口。
 *
 * 分两类：
 *   ① 客户端调的（带共享令牌，不需要登录态）：机器上报、领任务、交结果。
 *      为什么不能要求登录：客服端/陪玩端的**主进程**根本没登录态（页面才登录），
 *      而且机器失联时恰恰是「页面起不来」的时候，要求登录就永远收不到消息。
 *   ② 管理端调的（要 ADMIN / OWNER 登录）：看台账、下发诊断/指令、看报告。
 */
@Controller('agent')
export class MachineController {
  constructor(private readonly machineService: MachineService) {}

  private checkToken(req: any): boolean {
    const token = String(req.headers?.['x-onboard-token'] || req.headers?.['X-Onboard-Token'] || req.query?.token || '');
    return token === ONBOARD_REPORT_TOKEN;
  }

  // ── ① 客户端侧 ──────────────────────────────────────────────────────────

  /** 客户端每 5 分钟上报：我是谁 / 在哪 / 什么版本 / 远程管理开没开。 */
  @Post('machine-report')
  async machineReport(@Body() body: any, @Req() req: any): Promise<ApiResponse<unknown>> {
    if (!this.checkToken(req)) return { code: 403, message: 'forbidden', data: null };
    const data = await this.machineService.reportMachine(body || {});
    return { code: 200, message: 'ok', data };
  }

  /** 客户端领任务：只有自己名下的、还挂着的任务，领走就置「执行中」。 */
  @Get('machine-tasks')
  async machineTasks(@Req() req: any, @Query('machineId') machineId: string, @Query('limit') limit?: string): Promise<ApiResponse<unknown>> {
    if (!this.checkToken(req)) return { code: 403, message: 'forbidden', data: null };
    const data = await this.machineService.takeTasks(String(machineId || ''), Number(limit) || 3);
    return { code: 200, message: 'ok', data };
  }

  /** 客户端交结果（诊断报告 / 指令输出）。 */
  @Post('machine-task-result')
  async machineTaskResult(@Body() body: any, @Req() req: any): Promise<ApiResponse<unknown>> {
    if (!this.checkToken(req)) return { code: 403, message: 'forbidden', data: null };
    const data = await this.machineService.finishTask(body || {});
    return { code: 200, message: 'ok', data };
  }

  /** 诊断脚本正文：给「手工在这台机器上跑一次」用（双击 .bat 也行）。 */
  @Get('client-diag.ps1')
  async diagScript(@Res() res: Response): Promise<void> {
    res.type('text/plain; charset=utf-8').send(this.machineService.getDiagScriptText());
  }

  @Get('enable-remote.ps1')
  async enableRemoteScript(@Res() res: Response): Promise<void> {
    res.type('text/plain; charset=utf-8').send(this.machineService.getEnableRemoteScriptText());
  }

  // ── ② 管理端侧 ──────────────────────────────────────────────────────────

  @Get('machines')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async listMachines(): Promise<ApiResponse<unknown>> {
    return { code: 200, message: 'ok', data: await this.machineService.listMachines() };
  }

  @Post('machines/:machineId/diag')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async queueDiag(@Param('machineId') machineId: string, @Req() req: any): Promise<ApiResponse<unknown>> {
    try {
      const task = await this.machineService.createTask({
        machineId,
        type: 'diag',
        reason: '管理端点了一键诊断',
        actor: { id: req.user?.id, username: req.user?.username },
      });
      return { code: 200, message: '已派发，客户端通常 1 分钟内就会把报告传回来', data: task };
    } catch (err: any) {
      return { code: err?.status || 500, message: err?.message || '派发失败', data: null };
    }
  }

  @Post('machines/:machineId/enable-remote')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async queueEnableRemote(@Param('machineId') machineId: string, @Req() req: any): Promise<ApiResponse<unknown>> {
    try {
      const task = await this.machineService.createTask({
        machineId,
        type: 'enable-remote',
        reason: '管理端点了一键开通远程管理',
        actor: { id: req.user?.id, username: req.user?.username },
      });
      return { code: 200, message: '已派发，开通结果和运维账号口令会写回这台机器的台账', data: task };
    } catch (err: any) {
      return { code: err?.status || 500, message: err?.message || '派发失败', data: null };
    }
  }

  @Post('machines/:machineId/shell')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async queueShell(@Param('machineId') machineId: string, @Body() body: { command?: string }, @Req() req: any): Promise<ApiResponse<unknown>> {
    try {
      const task = await this.machineService.createTask({
        machineId,
        type: 'shell',
        command: body?.command,
        reason: '管理端下发指令',
        actor: { id: req.user?.id, username: req.user?.username },
      });
      return { code: 200, message: '已派发，客户端通常 1 分钟内返回输出', data: task };
    } catch (err: any) {
      return { code: err?.status || 500, message: err?.message || '派发失败', data: null };
    }
  }

  @Get('machines/:machineId/tasks')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async listTasks(@Param('machineId') machineId: string, @Query('limit') limit?: string): Promise<ApiResponse<unknown>> {
    return { code: 200, message: 'ok', data: await this.machineService.listTasks(machineId, Number(limit) || 30) };
  }

  @Get('machine-tasks/:taskId/report')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async taskReport(@Param('taskId') taskId: string): Promise<ApiResponse<unknown>> {
    const data = await this.machineService.readReport(taskId);
    if (!data) return { code: 404, message: '任务不存在', data: null };
    return { code: 200, message: 'ok', data };
  }
}
