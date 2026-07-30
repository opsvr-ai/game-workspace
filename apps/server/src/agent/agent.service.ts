import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);
const logger = new Logger('AgentService');

@Injectable()
export class AgentService {
  constructor(private readonly prisma: PrismaService) {}

  async getLatestVersion() {
    const [versionCfg, urlCfg] = await Promise.all([
      this.prisma.systemConfig.findUnique({ where: { key: 'agent.latest_version' } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'agent.latest_download_url' } }),
    ]);
    return {
      version: (versionCfg?.value as string) ?? '1.0.0',
      downloadUrl: (urlCfg?.value as string) ?? '/api/agent/download/latest',
    };
  }

  async getVersionStatus() {
    const companions = await this.prisma.companion.findMany({
      where: { status: { not: 'OFFLINE' } },
      select: {
        id: true,
        status: true,
        pc: { select: { agentVersion: true, lastHeartbeat: true } },
        user: { select: { username: true, displayName: true } },
      },
    });

    const latestVersion = (await this.getLatestVersion()).version;
    const list = companions.map((c) => ({
      companionId: c.id,
      name: c.user?.displayName || c.user?.username || c.id,
      status: c.status,
      agentVersion: c.pc?.agentVersion ?? '0.0.0',
      lastHeartbeat: c.pc?.lastHeartbeat ?? null,
      isLatest: (c.pc?.agentVersion ?? '0.0.0') === latestVersion,
    }));

    const onlineCount = companions.length;
    const upToDateCount = list.filter((c) => c.isLatest).length;

    return {
      latestVersion,
      onlineCount,
      upToDateCount,
      pendingCount: onlineCount - upToDateCount,
      list,
    };
  }

  getLatestExePath(): string {
    const exePath = path.join(process.cwd(), '../../uploads/agent-setup.exe');
    if (fs.existsSync(exePath)) return exePath;
    const releaseDir = path.join(process.cwd(), '../companion-electron/release');
    if (fs.existsSync(releaseDir)) {
      const files = fs.readdirSync(releaseDir);
      const exe = files.find((f) => f.endsWith('.exe'));
      if (exe) return path.join(releaseDir, exe);
    }
    return exePath;
  }

  /**
   * Generate a PowerShell one-liner that downloads and installs the agent on a new PC.
   * The server URL is embedded so the client auto-connects after install.
   */
  generateDeployScript(serverUrl: string): string {
    const apiUrl = serverUrl.replace(/\/$/, '');
    return [
      `$url = "${apiUrl}/api/agent/download/latest"`,
      `$out = "$env:TEMP\\ChunlvAgent-Setup.exe"`,
      `Write-Host "正在下载蠢驴电竞客户端..." -ForegroundColor Cyan`,
      `Invoke-WebRequest -Uri $url -OutFile $out`,
      `Write-Host "正在安装..." -ForegroundColor Yellow`,
      `Start-Process -FilePath $out -ArgumentList "/S" -Wait`,
      `Remove-Item $out -Force`,
      `Write-Host "安装完成！请从桌面启动 蠢驴电竞" -ForegroundColor Green`,
    ].join('\n');
  }

  /**
   * Generate a PowerShell script that uses PsExec to remotely install the agent
   * on multiple target PCs. Admin runs this script from their Windows machine.
   */
  generateRemoteDeployScript(params: {
    targetIPs: string[];
    adminUser: string;
    adminPass: string;
    serverUrl: string;
  }): string {
    const { targetIPs, adminUser, adminPass, serverUrl } = params;
    const apiUrl = serverUrl.replace(/\/$/, '');
    const ipsJson = JSON.stringify(targetIPs);

    return [
      `# ============================================`,
      `# 蠢驴电竞 - 远程批量部署脚本 (PsExec)`,
      `# 生成时间: ${new Date().toISOString()}`,
      `# 目标数量: ${targetIPs.length} 台电脑`,
      `# ============================================`,
      ``,
      `$serverUrl = "${apiUrl}"`,
      `$targets = ${ipsJson}`,
      `$adminUser = "${adminUser}"`,
      `$adminPass = "${adminPass}"`,
      `$installerUrl = "$serverUrl/api/agent/download/latest"`,
      ``,
      `# 检查 PsExec 是否存在，没有则自动下载`,
      `if (!(Test-Path ".\\PsExec.exe")) {`,
      `    Write-Host "正在下载 PsExec (Sysinternals)..." -ForegroundColor Yellow`,
      `    Invoke-WebRequest -Uri "https://download.sysinternals.com/files/PSTools.zip" -OutFile "PSTools.zip"`,
      `    Expand-Archive -Path "PSTools.zip" -DestinationPath ".\\PSTools" -Force`,
      `    Copy-Item ".\\PSTools\\PsExec.exe" -Destination ".\\PsExec.exe"`,
      `    Remove-Item "PSTools.zip" -Recurse -Force`,
      `    Write-Host "PsExec 准备就绪" -ForegroundColor Green`,
      `}`,
      ``,
      `Write-Host ""`,
      `Write-Host "========================================" -ForegroundColor Cyan`,
      `Write-Host "  开始批量部署 - 共 $($targets.Count) 台电脑" -ForegroundColor Cyan`,
      `Write-Host "========================================" -ForegroundColor Cyan`,
      `Write-Host ""`,
      ``,
      `$successCount = 0`,
      `$failCount = 0`,
      `$results = @()`,
      ``,
      `foreach ($ip in $targets) {`,
      `    $ip = $ip.Trim()`,
      `    if ([string]::IsNullOrEmpty($ip)) { continue }`,
      ``,
      `    Write-Host "[$ip] 正在连接..." -ForegroundColor Cyan`,
      ``,
      `    try {`,
      `        # Test connectivity first`,
      `        $ping = Test-Connection -ComputerName $ip -Count 1 -Quiet`,
      `        if (-not $ping) {`,
      `            Write-Host "[$ip] ✗ 无法 ping 通，跳过" -ForegroundColor Red`,
      `            $failCount++`,
      `            $results += @{ IP = $ip; Status = "FAIL"; Reason = "Ping failed" }`,
      `            continue`,
      `        }`,
      ``,
      `        # Remote install command`,
      `        $remoteCmd = "Invoke-WebRequest -Uri '$installerUrl' -OutFile ` +
        '`' +
        `$env:TEMP\\ChunlvAgent-Setup.exe; Start-Process ` +
        '`' +
        `$env:TEMP\\ChunlvAgent-Setup.exe -ArgumentList '/S' -Wait"`,
      ``,
      `        $result = .\\PsExec.exe \\\\$ip -u $adminUser -p $adminPass -s -h -accepteula powershell -Command $remoteCmd 2>&1`,
      ``,
      `        if ($LASTEXITCODE -eq 0) {`,
      `            Write-Host "[$ip] ✓ 安装成功" -ForegroundColor Green`,
      `            $successCount++`,
      `            $results += @{ IP = $ip; Status = "OK"; Reason = "" }`,
      `        } else {`,
      `            Write-Host "[$ip] ✗ 安装失败" -ForegroundColor Red`,
      `            Write-Host "    错误: $result" -ForegroundColor DarkYellow`,
      `            $failCount++`,
      `            $results += @{ IP = $ip; Status = "FAIL"; Reason = "$result" }`,
      `        }`,
      `    } catch {`,
      `        Write-Host "[$ip] ✗ 异常: $_" -ForegroundColor Red`,
      `        $failCount++`,
      `        $results += @{ IP = $ip; Status = "FAIL"; Reason = "$_" }`,
      `    }`,
      ``,
      `    Write-Host ""`,
      `}`,
      ``,
      `Write-Host "========================================" -ForegroundColor Cyan`,
      `Write-Host "  部署完成" -ForegroundColor Cyan`,
      `Write-Host "  成功: $successCount / $($targets.Count)" -ForegroundColor Green`,
      `if ($failCount -gt 0) { Write-Host "  失败: $failCount" -ForegroundColor Red }`,
      `Write-Host "========================================" -ForegroundColor Cyan`,
      ``,
      `# 输出结果表`,
      `$results | Format-Table -AutoSize`,
    ].join('\n');
  }

  async buildAndPush(): Promise<{ success: boolean; version: string; output: string }> {
    const projectRoot = path.join(process.cwd(), '..');

    try {
      logger.log('Step 1/4: git pull...');
      await execAsync('git pull', { cwd: projectRoot });

      logger.log('Step 2/4: pnpm install...');
      await execAsync('pnpm install', { cwd: projectRoot });

      logger.log('Step 3/4: electron-builder build...');
      const electronDir = path.join(projectRoot, 'apps/companion-electron');
      await execAsync('npx electron-builder --win --x64', {
        cwd: electronDir,
        env: { ...process.env, CI: 'true' },
      });

      logger.log('Step 4/4: copy installer...');
      const releaseDir = path.join(electronDir, 'release');
      const files = fs.readdirSync(releaseDir);
      const setupExe = files.find((f) => f.endsWith('.exe'));
      if (!setupExe) {
        return { success: false, version: '', output: '构建完成但未找到 exe 文件' };
      }

      const srcPath = path.join(releaseDir, setupExe);
      const destDir = path.join(projectRoot, 'uploads');
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(srcPath, path.join(destDir, 'agent-setup.exe'));

      const pkgJson = JSON.parse(fs.readFileSync(path.join(electronDir, 'package.json'), 'utf-8'));
      const version = pkgJson.version || '1.0.0';

      await this.prisma.systemConfig.upsert({
        where: { key: 'agent.latest_version' },
        create: { key: 'agent.latest_version', value: version },
        update: { value: version },
      });
      await this.prisma.systemConfig.upsert({
        where: { key: 'agent.latest_download_url' },
        create: { key: 'agent.latest_download_url', value: '/api/agent/download/latest' },
        update: { value: '/api/agent/download/latest' },
      });

      logger.log(`Build complete: version ${version}`);
      return { success: true, version, output: `构建成功: ${setupExe}` };
    } catch (err: any) {
      logger.error('Build failed', err.stderr || err.message);
      return {
        success: false,
        version: '',
        output: err.stderr || err.message || '构建失败',
      };
    }
  }
}
