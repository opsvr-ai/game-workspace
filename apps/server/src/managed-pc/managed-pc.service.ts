import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as dgram from 'dgram';

const execFileAsync = promisify(execFile);

const REMOTE_USER = 'chunlvops';
const REMOTE_PASSWORD = 'Chunlv@Ops2026';

@Injectable()
export class ManagedPcService {
  private readonly logger = new Logger(ManagedPcService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const items = await this.prisma.managedPC.findMany({ orderBy: { ip: 'asc' } });
    // 不再用会变化的 IP 做 ping 判定；改用客户端心跳判断在线（按登录账号关联）
    const pcs = await this.prisma.companionPC.findMany({
      select: {
        lastHeartbeat: true,
        companion: { select: { user: { select: { username: true } } } },
      },
    });
    const heartbeatByUsername = new Map<string, Date>();
    for (const pc of pcs) {
      const username = pc.companion?.user?.username;
      if (username && pc.lastHeartbeat) {
        heartbeatByUsername.set(username, pc.lastHeartbeat);
      }
    }
    const ONLINE_WINDOW_MS = 120_000; // 2 分钟内有心跳视为在线
    return items.map((item) => {
      const hb = heartbeatByUsername.get(item.loginAccount);
      const online = hb ? Date.now() - new Date(hb).getTime() < ONLINE_WINDOW_MS : false;
      return { ...item, online };
    });
  }

  async create(dto: { ip: string; loginAccount: string; macAddress?: string; label?: string }) {
    return this.prisma.managedPC.create({
      data: {
        ip: dto.ip.trim(),
        loginAccount: dto.loginAccount.trim(),
        macAddress: dto.macAddress?.trim() || null,
        label: dto.label?.trim() || null,
      },
    });
  }

  async update(id: string, dto: Partial<{ ip: string; loginAccount: string; macAddress?: string; label?: string; enabled: boolean }>) {
    const data: any = { ...dto };
    if (data.ip) data.ip = data.ip.trim();
    if (data.loginAccount) data.loginAccount = data.loginAccount.trim();
    if (data.macAddress !== undefined) data.macAddress = data.macAddress ? data.macAddress.trim() : null;
    if (data.label) data.label = data.label.trim();
    return this.prisma.managedPC.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.prisma.managedPC.delete({ where: { id } });
    return { success: true };
  }

  async isOnline(ip: string): Promise<boolean> {
    try {
      await execFileAsync('ping', ['-c', '1', '-W', '1', ip.trim()], { timeout: 2500 });
      return true;
    } catch {
      return false;
    }
  }

  async powerAction(id: string, action: 'wake' | 'shutdown' | 'restart' | 'sleep' | 'hibernate') {
    const pc = await this.prisma.managedPC.findUnique({ where: { id } });
    if (!pc) throw new Error('未找到该电脑');

    if (action === 'wake') {
      await this.wakeOnLan(pc.ip, pc.macAddress);
      await this.prisma.managedPC.update({
        where: { id },
        data: { lastAction: 'wake', lastActionAt: new Date(), updatedAt: new Date() },
      });
      return { success: true, action };
    }

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
      await this.prisma.managedPC.update({
        where: { id },
        data: { lastAction: action, lastActionAt: new Date(), updatedAt: new Date() },
      });
      return { success: true, action };
    } catch (err: any) {
      this.logger.warn('power action failed', { ip: pc.ip, action, error: err?.message || err });
      throw new Error(`执行失败：${err?.message || err}`);
    }
  }

  async batchPower(ids: string[], action: 'wake' | 'shutdown' | 'restart' | 'sleep' | 'hibernate') {
    if (!ids || ids.length === 0) throw new Error('请至少选择一台电脑');
    const results: Array<{ id: string; success: boolean; error?: string }> = [];
    for (const id of ids) {
      try {
        await this.powerAction(id, action);
        results.push({ id, success: true });
      } catch (err: any) {
        results.push({ id, success: false, error: err?.message || String(err) });
      }
    }
    const success = results.filter((r) => r.success).length;
    return { success, total: ids.length, results };
  }

  private async wakeOnLan(ip: string, storedMac?: string | null): Promise<void> {
    let mac = storedMac || this.resolveMacFromHostArp(ip);
    if (!mac) throw new Error('未找到该电脑的 MAC 地址，请在电脑管理里手动填写或让电脑开机一次');
    mac = mac.toLowerCase();
    const magic = Buffer.concat([
      Buffer.alloc(6, 0xff),
      ...Array(16).fill(Buffer.from(mac.replace(/:/g, ''), 'hex')),
    ]);
    for (const target of ['192.168.0.255', '255.255.255.255']) {
      await new Promise<void>((resolve) => {
        const socket = dgram.createSocket('udp4');
        socket.bind(() => {
          socket.setBroadcast(true);
          socket.send(magic, 9, target, () => {
            socket.close();
            resolve();
          });
        });
      });
    }
  }

  /** 从 ARP 缓存解析 MAC，并回写到电脑管理表（仅在线时可解析） */
  async syncMacAddress(ip: string): Promise<string | null> {
    const mac = this.resolveMacFromHostArp(ip);
    if (mac) {
      await this.prisma.managedPC.updateMany({
        where: { ip },
        data: { macAddress: mac },
      });
    }
    return mac;
  }

  /** 给所有电脑管理里的机器解析并回写 MAC（在线时能解析，离线时保留旧值） */
  async syncAllMacAddresses(): Promise<{ updated: number; total: number }> {
    const items = await this.prisma.managedPC.findMany({ select: { ip: true } });
    let updated = 0;
    for (const item of items) {
      const mac = this.resolveMacFromHostArp(item.ip);
      if (mac) {
        await this.prisma.managedPC.updateMany({
          where: { ip: item.ip, OR: [{ macAddress: null }, { macAddress: { not: mac } }] },
          data: { macAddress: mac },
        });
        updated += 1;
      }
    }
    return { updated, total: items.length };
  }

  private resolveMacFromHostArp(ip: string): string | null {
    try {
      const raw = fs.readFileSync('/app/uploads/host-arp.txt', 'utf-8');
      for (const line of raw.split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts[0] === ip && parts[3] && /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(parts[3])) {
          return parts[3];
        }
      }
    } catch {}
    return null;
  }
}
