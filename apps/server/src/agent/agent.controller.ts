import { Controller, Get, Post, Res, Req, UseGuards } from '@nestjs/common';
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
}
