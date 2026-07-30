import { Controller, Get, Post, Res, Req, UseGuards, Body } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { UserRole } from '@chunlv/shared';
import { AgentService } from './agent.service';
import { WsGateway } from '../ws/ws.gateway';
import type { ApiResponse } from '@chunlv/shared';
import * as fs from 'fs';

@Controller('agent')
export class AgentController {
  constructor(
    private readonly agentService: AgentService,
    private readonly wsGateway: WsGateway,
  ) {}

  // Public: companion calls this on startup (no auth needed)
  @Get('version')
  async getVersion(): Promise<ApiResponse<unknown>> {
    const data = await this.agentService.getLatestVersion();
    return { code: 200, message: 'ok', data };
  }

  // Public: companion downloads installer
  @Get('download/latest')
  async downloadLatest(@Res() res: Response): Promise<void> {
    const exePath = this.agentService.getLatestExePath();
    if (!fs.existsSync(exePath)) {
      res.status(404).json({ code: 404, message: '安装包不存在，请先构建', data: null });
      return;
    }
    res.download(exePath, 'ChunlvAgent-Setup.exe');
  }

  // Admin only: view version distribution
  @Get('version-status')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async getVersionStatus(): Promise<ApiResponse<unknown>> {
    const data = await this.agentService.getVersionStatus();
    return { code: 200, message: 'ok', data };
  }

  // Admin only: trigger build and push
  @Post('build-and-push')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async buildAndPush(@Req() req: any): Promise<ApiResponse<unknown>> {
    const result = await this.agentService.buildAndPush();

    if (result.success) {
      if (req.user?.studioId) {
        this.wsGateway.broadcastToStudio(req.user.studioId, 'pc:command', {
          command: 'update',
          downloadUrl: '/api/agent/download/latest',
          version: result.version,
        });
      }
      return { code: 200, message: '构建成功，已推送到在线陪玩', data: result };
    }

    return { code: 500, message: '构建失败', data: result };
  }

  // Admin only: push update to specific companions
  @Post('update/push')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async pushUpdate(@Body() body: { companionIds: string[] }): Promise<ApiResponse<unknown>> {
    const { companionIds } = body;
    if (!companionIds || companionIds.length === 0) {
      return { code: 400, message: '请选择至少一个陪玩', data: null };
    }

    const { version, downloadUrl } = await this.agentService.getLatestVersion();
    let successCount = 0;
    for (const companionId of companionIds) {
      try {
        this.wsGateway.sendCommand(companionId, 'update', { downloadUrl, version });
        successCount++;
      } catch {
        // companion may be offline
      }
    }

    return {
      code: 200,
      message: `已向 ${successCount}/${companionIds.length} 位陪玩推送更新`,
      data: { successCount, total: companionIds.length, version },
    };
  }

  // Admin only: push update to entire studio
  @Post('update/push-studio')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async pushUpdateStudio(@Req() req: any): Promise<ApiResponse<unknown>> {
    const studioId = req.user?.studioId;
    if (!studioId) {
      return { code: 400, message: '未找到所属工作室', data: null };
    }
    const { version, downloadUrl } = await this.agentService.getLatestVersion();
    this.wsGateway.broadcastToStudio(studioId, 'pc:command', {
      command: 'update',
      downloadUrl,
      version,
    });

    return {
      code: 200,
      message: `已向工作室推送更新 v${version}`,
      data: { version },
    };
  }

  // Admin only: generate deploy script
  @Get('deploy/script')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async getDeployScript(@Req() req: any): Promise<ApiResponse<unknown>> {
    const serverUrl = `${req.protocol}://${req.get('host')}`;
    const script = this.agentService.generateDeployScript(serverUrl);
    const downloadUrl = `${serverUrl}/api/agent/download/latest`;

    return {
      code: 200,
      message: 'ok',
      data: { script, downloadUrl, serverUrl },
    };
  }

  // Admin only: generate PsExec remote deploy script
  @Post('deploy/remote-script')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async getRemoteDeployScript(
    @Body() body: { targetIPs: string[]; adminUser: string; adminPass: string },
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const { targetIPs, adminUser, adminPass } = body;
    if (!targetIPs || targetIPs.length === 0) {
      return { code: 400, message: '请输入目标电脑 IP', data: null };
    }
    if (!adminUser) {
      return { code: 400, message: '请输入管理员账号', data: null };
    }

    const serverUrl = `${req.protocol}://${req.get('host')}`;
    const script = this.agentService.generateRemoteDeployScript({
      targetIPs,
      adminUser,
      adminPass,
      serverUrl,
    });
    const downloadUrl = `${serverUrl}/api/agent/download/latest`;

    return {
      code: 200,
      message: 'ok',
      data: { script, downloadUrl, serverUrl, targetCount: targetIPs.length },
    };
  }
}
