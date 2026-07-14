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

      const pkgJson = JSON.parse(
        fs.readFileSync(path.join(electronDir, 'package.json'), 'utf-8'),
      );
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
