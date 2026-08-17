import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const REMOTE_USER = 'chunlvops';
const REMOTE_PASSWORD = 'Chunlv@Ops2026';

@Injectable()
export class ManagedPcService {
  private readonly logger = new Logger(ManagedPcService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const items = await this.prisma.managedPC.findMany({ orderBy: { ip: 'asc' } });
    return Promise.all(items.map(async (item) => ({
      ...item,
      online: await this.isOnline(item.ip),
    })));
  }

  async create(dto: { ip: string; loginAccount: string; label?: string }) {
    return this.prisma.managedPC.create({ data: dto });
  }

  async update(id: string, dto: Partial<{ ip: string; loginAccount: string; label?: string; enabled: boolean }>) {
    return this.prisma.managedPC.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.prisma.managedPC.delete({ where: { id } });
    return { success: true };
  }

  async isOnline(ip: string): Promise<boolean> {
    try {
      await execFileAsync('ping', ['-c', '1', '-W', '1', ip], { timeout: 2500 });
      return true;
    } catch {
      return false;
    }
  }

  async powerAction(id: string, action: 'shutdown' | 'restart' | 'sleep' | 'hibernate') {
    const pc = await this.prisma.managedPC.findUnique({ where: { id } });
    if (!pc) throw new Error('未找到该电脑');

    const commands: Record<string, string> = {
      shutdown: 'cmd /c shutdown /s /t 0',
      restart: 'cmd /c shutdown /r /t 0',
      sleep: 'cmd /c rundll32.exe powrprof.dll,SetSuspendState 0,1,0',
      hibernate: 'cmd /c rundll32.exe powrprof.dll,SetSuspendState 1,1,0',
    };
    const remoteCommand = commands[action];
    if (!remoteCommand) throw new Error('未知电源操作');

    const target = `${REMOTE_USER}:${REMOTE_PASSWORD}@${pc.ip}`;
    try {
      await execFileAsync(
        'python3',
        ['/usr/local/bin/atexec.py', target, remoteCommand],
        { timeout: 20000 },
      );
      return { success: true, action };
    } catch (err: any) {
      this.logger.warn('power action failed', { ip: pc.ip, action, error: err?.message || err });
      throw new Error(`执行失败：${err?.message || err}`);
    }
  }
}
