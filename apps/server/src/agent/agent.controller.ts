// craftsman-ignore: TS001,TS003
import { Controller, Get, Post, Res, Req, UseGuards, Body } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { UserRole } from '@chunlv/shared';
import { AgentService } from './agent.service';
import { WsGateway } from '../ws/ws.gateway';
import type { ApiResponse } from '@chunlv/shared';
import * as fs from 'fs';
import * as os from 'os';

/**
 * Resolve the server URL reachable from other machines on the LAN.
 * If the request host is localhost, fall back to the server's LAN IP.
 */
function resolveServerUrl(req: any): string {
  const host = req.get('host') as string;
  // If already using a real IP/hostname, use it as-is
  if (host && !host.startsWith('localhost') && !host.startsWith('127.') && !host.startsWith('[::1]')) {
    return `${req.protocol}://${host}`;
  }
  // Detect LAN IP — prefer 192.168.x.x or 10.x.x.x, skip Docker bridges
  const nets = os.networkInterfaces();
  const candidates: string[] = [];
  for (const iface of Object.values(nets)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        candidates.push(addr.address);
      }
    }
  }
  // Prefer real LAN IPs over Docker bridges (172.17-19.x.x)
  const lan = candidates.find((ip) => ip.startsWith('192.168.') || ip.startsWith('10.'));
  const selected = lan || candidates[0] || '127.0.0.1';
  return `${req.protocol}://${selected}:3001`;
}

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

  // Public: CS client checks for its own updates
  @Get('cs-version')
  async getCsVersion(): Promise<ApiResponse<unknown>> {
    const data = await this.agentService.getCsLatestVersion();
    return { code: 200, message: 'ok', data };
  }

  @Post('cs-heartbeat')
  @UseGuards(AuthGuard('jwt'))
  async csHeartbeat(@Req() req: any, @Body() body: { agentVersion?: string }): Promise<ApiResponse<unknown>> {
    if (!req.user?.id) return { code: 401, message: '未登录', data: null };
    await this.agentService.reportCsVersion(req.user.id, body?.agentVersion || '0.0.0');
    return { code: 200, message: 'ok', data: null };
  }

  @Get('cs-version-status')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async csVersionStatus(): Promise<ApiResponse<unknown>> {
    const data = await this.agentService.listCsVersionStatus();
    return { code: 200, message: 'ok', data };
  }

  // Companion client reports heartbeat/version over REST as a reliable fallback
  @Post('heartbeat')
  @UseGuards(AuthGuard('jwt'))
  async heartbeat(@Req() req: any, @Body() body: { agentVersion?: string }): Promise<ApiResponse<unknown>> {
    const user = req.user;
    if (!user?.companionId) {
      return { code: 200, message: 'ok', data: { webBuildId: this.agentService.deployId } };
    }
    const data = await this.agentService.recordHeartbeat(user.companionId, body?.agentVersion);
    return { code: 200, message: 'ok', data: { ...data, webBuildId: this.agentService.deployId } };
  }

  // 远程自测：让陪玩端自杀进程，验证看门狗是否会自动拉起
  @Post('test-watchdog')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
  async testWatchdog(@Body() body: { companionId: string }): Promise<ApiResponse<unknown>> {
    if (!body?.companionId) {
      return { code: 400, message: '缺少陪玩ID', data: null };
    }
    this.wsGateway.sendCommand(body.companionId, 'test_watchdog', {});
    return { code: 200, message: '自测指令已发送', data: { companionId: body.companionId } };
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

  // Public: CS client downloads its own installer
  @Get('download/cs')
  async downloadCs(@Res() res: Response): Promise<void> {
    const exePath = this.agentService.getLatestCsExePath();
    if (!fs.existsSync(exePath)) {
      res.status(404).json({ code: 404, message: '客服端安装包不存在，请先构建', data: null });
      return;
    }
    res.download(exePath, 'Chunlv-CS-Setup.exe');
  }

  // Admin only: view version distribution
  @Get('version-status')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
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

  // Admin only: push update to entire studio (OWNER pushes to all companions)
  @Post('update/push-studio')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async pushUpdateStudio(@Req() req: any): Promise<ApiResponse<unknown>> {
    const { version, downloadUrl } = await this.agentService.getLatestVersion();
    const studioId = req.user?.studioId;

    if (!studioId && req.user?.role !== 'OWNER') {
      return { code: 400, message: '未找到所属工作室', data: null };
    }

    if (studioId) {
      this.wsGateway.broadcastToStudio(studioId, 'pc:command', {
        command: 'update', downloadUrl, version,
      });
    } else {
      // OWNER with no studioId: push to ALL online companions
      const companions = await this.agentService.getAllOnlineCompanionIds();
      for (const cid of companions) {
        this.wsGateway.sendCommand(cid, 'update', { downloadUrl, version });
      }
    }

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
    const serverUrl = resolveServerUrl(req);
    const script = this.agentService.generateDeployScript(serverUrl);
    const downloadUrl = `${serverUrl}/api/agent/download/latest`;

    return {
      code: 200,
      message: 'ok',
      data: { script, downloadUrl, serverUrl },
    };
  }

  // Scan LAN — ping sweep subnet, then detect Windows via SMB port
  @Get('deploy/scan-lan')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async scanLan(): Promise<ApiResponse<unknown>> {
    const { execSync } = require('child_process');
    const hosts: { ip: string; mac?: string }[] = [];
    const seen = new Set<string>();

    // 读取宿主机 ARP 表（容器通过只读挂载 /proc/net/arp 共享）
    try {
      if (fs.existsSync('/host-arp')) {
        const raw = fs.readFileSync('/host-arp', 'utf-8');
        for (const line of raw.split('\n')) {
          const parts = line.trim().split(/\s+/);
          const ip = parts[0];
          const mac = parts[3];
          if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip) && !seen.has(ip)) {
            seen.add(ip);
            hosts.push({ ip, mac: mac && mac !== '00:00:00:00:00:00' ? mac : undefined });
          }
        }
      }
    } catch {}

    // 2. 用 fping 快速扫常见局域网段，触发宿主机 ARP 更新并直接发现存活设备
    try {
      const subnets = ['192.168.0.0/24', '192.168.1.0/24'];
      for (const subnet of subnets) {
        try {
          const result = execSync(`fping -a -g ${subnet} -r 1 -t 300 2>/dev/null || true`, {
            timeout: 8000,
            encoding: 'utf-8',
          }) as string;
          for (const line of result.split('\n')) {
            const ip = line.trim();
            if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip) && !seen.has(ip)) {
              seen.add(ip);
              hosts.push({ ip });
            }
          }
        } catch {}
      }
    } catch {}

    // 1. ARP table (fast, already-communicated devices)
    try {
      const raw = execSync('arp -a', { timeout: 3000, encoding: 'utf-8' }) as string;
      for (const line of raw.split('\n')) {
        const m = line.match(/\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+([0-9a-f:]+)/i);
        if (m && !seen.has(m[1])) {
          seen.add(m[1]);
          hosts.push({ ip: m[1], mac: m[2] });
        }
      }
    } catch {}

    // 2. Fast ping sweep using parallel fping or nmap
    try {
      const nets = require('os').networkInterfaces();
      for (const iface of Object.values(nets) as any[]) {
        for (const addr of iface as any[]) {
          if (addr.family !== 'IPv4' || addr.internal) continue;
          const subnet = addr.address.split('.').slice(0, 3).join('.');
          try {
            // fping: fastest (completes in ~2s for entire subnet)
            const result = execSync(`fping -a -g ${subnet}.0/24 -r 1 -t 200 2>/dev/null || true`, { timeout: 5000, encoding: 'utf-8' }) as string;
            for (const line of result.split('\n')) {
              const ip = line.trim();
              if (ip && !seen.has(ip) && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
                seen.add(ip);
                hosts.push({ ip });
              }
            }
          } catch {
            // fallback: nmap
            try {
              const result = execSync(`nmap -sn ${subnet}.0/24 --host-timeout 2s 2>/dev/null | grep 'Nmap scan' | awk '{print $NF}' | tr -d '()' || true`, { timeout: 10000, encoding: 'utf-8' }) as string;
              for (const line of result.split('\n')) {
                const ip = line.trim();
                if (ip && !seen.has(ip) && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
                  seen.add(ip);
                  hosts.push({ ip });
                }
              }
            } catch {}
          }
        }
      }
    } catch {}

    // 3. Sort by IP
    hosts.sort((a, b) => {
      const aParts = a.ip.split('.').map(Number);
      const bParts = b.ip.split('.').map(Number);
      for (let i = 0; i < 4; i++) {
        if (aParts[i] !== bParts[i]) return aParts[i] - bParts[i];
      }
      return 0;
    });

    return { code: 200, message: `发现 ${hosts.length} 台设备`, data: hosts };
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

    const serverUrl = resolveServerUrl(req);
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

  // Admin only: execute remote deploy directly from server (no manual step needed)
  @Post('deploy/execute')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  async executeRemoteDeploy(
    @Body() body: { targetIPs: string[]; adminUser?: string; adminPass?: string },
    @Req() req: any,
  ): Promise<ApiResponse<unknown>> {
    const { targetIPs, adminUser, adminPass } = body;
    if (!targetIPs || targetIPs.length === 0) {
      return { code: 400, message: '请输入目标电脑 IP', data: null };
    }

    const serverUrl = resolveServerUrl(req);
    const result = await this.agentService.executeRemoteDeploy({
      targetIPs,
      adminUser: adminUser || 'Administrator',
      adminPass: adminPass || '',
      serverUrl,
    });

    const okCount = result.results.filter((r) => r.status === 'OK').length;
    return {
      code: 200,
      message: `部署完成: ${okCount}/${result.results.length} 成功`,
      data: result,
    };
  }
}
