// craftsman-ignore: TS001,TS003
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const logger = new Logger('AgentService');

@Injectable()
export class AgentService {
  readonly deployId = Date.now().toString(36);

  constructor(private readonly prisma: PrismaService) {}

  async getAllOnlineCompanionIds(): Promise<string[]> {
    const companions = await this.prisma.companion.findMany({
      where: { status: { not: 'OFFLINE' } },
      select: { id: true },
    });
    return companions.map((c) => c.id);
  }

  async getOnlineCompanionTargets(studioId?: string): Promise<
    Array<{
      companionId: string;
      name: string;
      status: string;
      agentVersion: string;
      lastHeartbeat: Date | null;
    }>
  > {
    const companions = await this.prisma.companion.findMany({
      where: {
        status: { not: 'OFFLINE' },
        ...(studioId ? { studioId } : {}),
      },
      select: {
        id: true,
        status: true,
        user: { select: { username: true, displayName: true } },
        pc: { select: { agentVersion: true, lastHeartbeat: true } },
      },
    });
    return companions.map((c) => ({
      companionId: c.id,
      name: c.user?.displayName || c.user?.username || c.id,
      status: c.status,
      agentVersion: c.pc?.agentVersion ?? '0.0.0',
      lastHeartbeat: c.pc?.lastHeartbeat ?? null,
    }));
  }

  async getCompanionTargetsByIds(ids: string[]): Promise<
    Array<{
      companionId: string;
      name: string;
      status: string;
      agentVersion: string;
      lastHeartbeat: Date | null;
    }>
  > {
    const companions = await this.prisma.companion.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        status: true,
        user: { select: { username: true, displayName: true } },
        pc: { select: { agentVersion: true, lastHeartbeat: true } },
      },
    });
    return companions.map((c) => ({
      companionId: c.id,
      name: c.user?.displayName || c.user?.username || c.id,
      status: c.status,
      agentVersion: c.pc?.agentVersion ?? '0.0.0',
      lastHeartbeat: c.pc?.lastHeartbeat ?? null,
    }));
  }

  async recordHeartbeat(companionId: string, agentVersion?: string) {
    return this.prisma.companionPC.upsert({
      where: { companionId },
      create: {
        companionId,
        agentVersion: agentVersion ?? '0.0.0',
        lastHeartbeat: new Date(),
        currentMode: 'ENTERTAINMENT',
        isThrottled: false,
        throttleLimitKB: null,
      },
      update: {
        agentVersion: agentVersion ?? undefined,
        lastHeartbeat: new Date(),
      },
    });
  }

  async getLatestVersion() {
    const [versionCfg, urlCfg] = await Promise.all([
      this.prisma.systemConfig.findUnique({ where: { key: 'agent.latest_version' } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'agent.latest_download_url' } }),
    ]);
    return {
      version: (versionCfg?.value as string) ?? '1.0.0',
      downloadUrl: (urlCfg?.value as string) ?? '/uploads/chunlv-latest.zip',
    };
  }

  async getCsLatestVersion() {
    const [versionCfg, urlCfg] = await Promise.all([
      this.prisma.systemConfig.findUnique({ where: { key: 'cs.latest_version' } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'cs.latest_download_url' } }),
    ]);
    return {
      version: (versionCfg?.value as string) ?? '1.0.0',
      downloadUrl: (urlCfg?.value as string) ?? '/api/agent/download/cs',
    };
  }

  async reportCsVersion(userId: string, version: string) {
    return this.prisma.systemConfig.upsert({
      where: { key: `cs.client.version.${userId}` },
      create: {
        key: `cs.client.version.${userId}`,
        value: { version, lastSeen: new Date().toISOString() },
      },
      update: {
        value: { version, lastSeen: new Date().toISOString() },
      },
    });
  }

  async listCsVersionStatus() {
    const records = await this.prisma.systemConfig.findMany({
      where: { key: { startsWith: 'cs.client.version.' } },
    });
    const users = await this.prisma.user.findMany({
      where: { role: { in: ['CS', 'ADMIN', 'OWNER'] } },
      select: { id: true, username: true, role: true },
    });
    const recordMap = new Map<string, { version?: string; lastSeen?: string }>();
    for (const r of records) {
      const userId = r.key.replace('cs.client.version.', '');
      recordMap.set(userId, (r.value as any) || {});
    }
    const latestVersion = (await this.getCsLatestVersion()).version;
    return users.map((u) => {
      const value = recordMap.get(u.id) || {};
      const version = value.version || null;
      return {
        userId: u.id,
        username: u.username,
        role: u.role,
        version: version || '未登录',
        lastSeen: value.lastSeen || null,
        isLatest: version === latestVersion,
      };
    });
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
    const projectRoot = path.resolve(process.cwd(), '../..');
    const exePath = path.join(projectRoot, 'uploads/agent-setup.exe');
    if (fs.existsSync(exePath)) return exePath;
    const releaseDir = path.join(projectRoot, 'apps/companion-electron/release');
    if (fs.existsSync(releaseDir)) {
      const files = fs.readdirSync(releaseDir);
      const exe = files.find((f) => f.endsWith('.exe'));
      if (exe) return path.join(releaseDir, exe);
    }
    return exePath;
  }

  getLatestZipPath(): string {
    const projectRoot = path.resolve(process.cwd(), '../..');
    const zipPath = path.join(projectRoot, 'uploads/chunlv-latest.zip');
    return zipPath;
  }

  getLatestCsExePath(): string {
    const projectRoot = path.resolve(process.cwd(), '../..');
    const exePath = path.join(projectRoot, 'uploads/agent-cs-setup.exe');
    if (fs.existsSync(exePath)) return exePath;
    const releaseDirs = [
      path.join(projectRoot, 'apps/cs-electron/release4'),
      path.join(projectRoot, 'apps/cs-electron/release'),
    ];
    for (const releaseDir of releaseDirs) {
      if (!fs.existsSync(releaseDir)) continue;
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
    const apiUrl = this.sanitizeServerUrl(serverUrl);
    const installerUrl = this.escapePowerShellLiteral(`${apiUrl}/api/agent/download/exe`);
    return [
      `$url = ${installerUrl}`,
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
    const apiUrl = this.sanitizeServerUrl(serverUrl);
    const serverUrlLiteral = this.escapePowerShellLiteral(apiUrl);
    const adminUserLiteral = this.escapePowerShellLiteral(adminUser);
    const adminPassLiteral = this.escapePowerShellLiteral(adminPass);
    const ipsJson = JSON.stringify(targetIPs);

    return [
      `# ============================================`,
      `# 蠢驴电竞 - 远程批量部署脚本 (PsExec)`,
      `# 生成时间: ${new Date().toISOString()}`,
      `# 目标数量: ${targetIPs.length} 台电脑`,
      `# ============================================`,
      ``,
      `$serverUrl = ${serverUrlLiteral}`,
      `$targets = ${ipsJson}`,
      `$adminUser = ${adminUserLiteral}`,
      `$adminPass = ${adminPassLiteral}`,
      `$installerUrl = "$serverUrl/api/agent/download/exe"`,
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
      `        # Step 1: Download installer to target PC`,
      `        $dlCmd = "Invoke-WebRequest -Uri '$installerUrl' -OutFile ` + '`' + `$env:TEMP\\ChunlvAgent-Setup.exe"`,
      ``,
      `        Write-Host "[$ip] 正在下载安装包..." -ForegroundColor Yellow`,
      `        $dlResult = .\\PsExec.exe \\\\$ip -u $adminUser -p $adminPass -accepteula -nobanner powershell -Command $dlCmd 2>&1`,
      ``,
      `        if ($LASTEXITCODE -ne 0) {`,
      `            Write-Host "[$ip] ✗ 下载失败 (PsExec exit=$LASTEXITCODE)" -ForegroundColor Red`,
      `            Write-Host "    详情: $dlResult" -ForegroundColor DarkYellow`,
      `            Write-Host "    提示: 请确认目标电脑能访问 $installerUrl" -ForegroundColor DarkYellow`,
      `            $failCount++`,
      `            $results += @{ IP = $ip; Status = "FAIL"; Reason = "Download failed: $dlResult" }`,
      `            continue`,
      `        }`,
      ``,
      `        # Step 2: Run silent install`,
      `        Write-Host "[$ip] 正在安装..." -ForegroundColor Yellow`,
      `        $installCmd = "Start-Process ` + '`' + `$env:TEMP\\ChunlvAgent-Setup.exe -ArgumentList '/S' -Wait"`,
      `        $installResult = .\\PsExec.exe \\\\$ip -u $adminUser -p $adminPass -i -accepteula -nobanner powershell -Command $installCmd 2>&1`,
      ``,
      `        if ($LASTEXITCODE -ne 0) {`,
      `            Write-Host "[$ip] ✗ 安装失败" -ForegroundColor Red`,
      `            $failCount++`,
      `            $results += @{ IP = $ip; Status = "FAIL"; Reason = "Install failed: $installResult" }`,
      `            continue`,
      `        }`,
      ``,
      `        # Step 3: Show the app window on target PC`,
      `        Write-Host "[$ip] 正在启动客户端..." -ForegroundColor Yellow`,
      `        $showCmd = "Start-Process 'C:\\Program Files\\蠢驴电竞\\蠢驴电竞.exe'"`,
      `        .\\PsExec.exe \\\\$ip -u $adminUser -p $adminPass -d -i -accepteula -nobanner powershell -Command $showCmd 2>&1 | Out-Null`,
      ``,
      `        Write-Host "[$ip] ✓ 安装成功，客户端已启动" -ForegroundColor Green`,
      `        $successCount++`,
      `        $results += @{ IP = $ip; Status = "OK"; Reason = "Installed and running" }`,
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
    // Server runs from apps/server/, so ../.. reaches the monorepo root
    const projectRoot = path.resolve(process.cwd(), '../..');

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

      logger.log('Step 4/5: copy installer + generate auto-update zip...');
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

      // 自动更新走 SystemHelper 服务：它按 zip 解压 win-unpacked 覆盖安装目录。
      // 如果这里只发布 exe 安装器，SystemHelper 会把 exe 当 zip 解压失败，陷入反复下载/退出/重启的死循环。
      const winUnpackedDir = path.join(releaseDir, 'win-unpacked');
      if (!fs.existsSync(winUnpackedDir)) {
        return { success: false, version: '', output: '构建完成但未找到 win-unpacked 目录' };
      }
      const zipName = 'chunlv-latest.zip';
      const zipLocal = path.join(releaseDir, zipName);
      await execAsync(`rm -f "${zipLocal}" && zip -r "${zipLocal}" win-unpacked/ -q`, {
        cwd: releaseDir,
      });
      fs.copyFileSync(zipLocal, path.join(destDir, zipName));

      const pkgJson = JSON.parse(fs.readFileSync(path.join(electronDir, 'package.json'), 'utf-8'));
      const version = pkgJson.version || '1.0.0';

      await this.prisma.systemConfig.upsert({
        where: { key: 'agent.latest_version' },
        create: { key: 'agent.latest_version', value: version },
        update: { value: version },
      });
      await this.prisma.systemConfig.upsert({
        where: { key: 'agent.latest_download_url' },
        create: { key: 'agent.latest_download_url', value: '/uploads/chunlv-latest.zip' },
        update: { value: '/uploads/chunlv-latest.zip' },
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

  /**
   * Execute remote deployment from the server using impacket's psexec.py.
   * No manual steps needed — the server reaches out to each target Windows PC directly.
   */
  async executeRemoteDeploy(params: {
    targetIPs: string[];
    adminUser: string;
    adminPass: string;
    serverUrl: string;
  }): Promise<{ success: boolean; results: { ip: string; status: string; reason: string }[] }> {
    const { targetIPs, adminUser, adminPass, serverUrl } = params;
    const apiUrl = this.sanitizeServerUrl(serverUrl);
    const psexecCandidates = [
      '/usr/local/bin/psexec.py',
      '/usr/share/impacket-scripts/psexec.py',
      '/usr/bin/psexec.py',
      '/usr/share/doc/python3-impacket/examples/psexec.py',
    ];
    const psexec = psexecCandidates.find((p) => fs.existsSync(p)) || psexecCandidates[0];
    const results: { ip: string; status: string; reason: string }[] = [];

    // Write a small PowerShell script that psexec.py will copy & execute on target
    const psScriptPath = '/tmp/chunlv-deploy.ps1';
    const installerUrl = this.escapePowerShellLiteral(`${apiUrl}/api/agent/download/exe`);
    const psContent = [
      `$url = ${installerUrl}`,
      `$out = "$env:TEMP\\ChunlvAgent-Setup.exe"`,
      `Write-Host "Downloading..."`,
      `Invoke-WebRequest -Uri $url -OutFile $out`,
      `Write-Host "Installing..."`,
      `Start-Process $out -ArgumentList '/S' -Wait`,
      `Write-Host "Starting..."`,
      `Start-Process "C:\\Program Files\\蠢驴电竞\\蠢驴电竞.exe"`,
    ].join('\n');
    fs.writeFileSync(psScriptPath, psContent, 'utf-8');

    // Validate inputs to prevent command injection
    const safeUser = /^[a-zA-Z0-9_.\\-]+$/.test(adminUser) ? adminUser : 'Administrator';
    const safePass = /^[a-zA-Z0-9!@#$%^&*()_+\-=\[\]{}|;:,.<>?/~` ]+$/.test(adminPass) ? adminPass : '';
    if (adminUser !== safeUser || adminPass !== safePass) {
      logger.warn('Admin credentials contained unsafe characters, using sanitized values');
    }

    for (const ip of targetIPs) {
      const trimmed = ip.trim();
      if (!trimmed || !/^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/.test(trimmed)) continue;

      logger.log(`Deploying to ${trimmed}...`);
      try {
        // psexec.py -c copies the script to target and executes it via powershell
        const creds = safePass ? `${safeUser}:${safePass}@${trimmed}` : `${safeUser}@${trimmed}`;
        const noPassFlag = safePass ? '' : ' -no-pass';
        const remoteCommand = 'powershell -ExecutionPolicy Bypass -File %TEMP%\\chunlv-deploy.ps1';
        const args = [psexec];
        if (noPassFlag) args.push('-no-pass');
        args.push('-c', psScriptPath, creds, remoteCommand);

        const { stdout, stderr } = await execFileAsync('python3', args, { timeout: 180_000 });
        const output = stdout + (stderr || '');

        if (output.includes('Error') || output.includes('Exception')) {
          results.push({ ip: trimmed, status: 'FAIL', reason: output.slice(0, 300) });
        } else {
          results.push({ ip: trimmed, status: 'OK', reason: 'Installed and started' });
        }
      } catch (err: any) {
        const msg = err.stderr || err.message || 'Unknown';
        results.push({ ip: trimmed, status: 'FAIL', reason: msg.slice(0, 300) });
      }
    }

    try {
      fs.unlinkSync(psScriptPath);
    } catch {
      /* ok */
    }

    const okCount = results.filter((r) => r.status === 'OK').length;
    logger.log(`Remote deploy complete: ${okCount}/${results.length} OK`);
    return { success: okCount > 0, results };
  }

  private escapePowerShellLiteral(value: string): string {
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  private sanitizeServerUrl(input: string): string {
    const fallback = 'http://127.0.0.1:3001';
    const candidate = input?.trim();
    if (!candidate) return fallback;

    try {
      const url = new URL(candidate);
      const safeHost = /^[a-zA-Z0-9.:\[\]-]+$/.test(url.host);
      if ((url.protocol === 'http:' || url.protocol === 'https:') && safeHost) {
        return `${url.protocol}//${url.host}`;
      }
    } catch {
      // Fall back to localhost for invalid URLs.
    }

    return fallback;
  }
}
