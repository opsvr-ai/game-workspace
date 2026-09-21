import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';

const execFileAsync = promisify(execFile);

const REMOTE_USER = 'chunlvops';
const REMOTE_PASSWORD = process.env.CHUNLV_REMOTE_PASSWORD || '';
const LAN_RELAY_IP = '192.168.0.106';
const LAN_RELAY_USER = 'hanlei';

@Injectable()
export class ManagedPcService {
  private readonly logger = new Logger(ManagedPcService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wsGateway: WsGateway,
  ) {}

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
    const lanIps = items.filter((it) => /^192\.168\./.test(it.ip)).map((it) => it.ip);
    const reachable = await this.getReachableLanIps(lanIps);
    return items.map((item) => {
      const hb = heartbeatByUsername.get(item.loginAccount);
      const online = hb ? Date.now() - new Date(hb).getTime() < ONLINE_WINDOW_MS : false;
      return { ...item, online, reachable: reachable.has(item.ip) };
    });
  }

  /** 通过中继机批量 ping，判断电脑网络是否通（不依赖客户端是否登录）。 */
  private async getReachableLanIps(ips: string[]): Promise<Set<string>> {
    if (!ips.length) return new Set();
    const ipArg = ips.map((ip) => `'${ip}'`).join(' ');
    try {
      const { stdout } = await execFileAsync(
        'ssh',
        [
          '-o', 'StrictHostKeyChecking=no',
          '-o', 'ConnectTimeout=10',
          `${LAN_RELAY_USER}@${LAN_RELAY_IP}`,
          `fping -a ${ipArg} 2>/dev/null || true`,
        ],
        { timeout: 20000 },
      );
      return new Set(String(stdout).split(/\s+/).filter(Boolean));
    } catch {
      return new Set();
    }
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

    // 关机优先走在线客户端 WebSocket，避免云服务器直连内网 445 失败。
    if (action === 'shutdown') {
      const companion = await this.prisma.companion.findFirst({
        where: { user: { username: pc.loginAccount } },
        select: { id: true },
      });
      if (companion && this.wsGateway.sendCommand(companion.id, 'shutdown', {})) {
        await this.prisma.managedPC.update({
          where: { id },
          data: { lastAction: action, lastActionAt: new Date(), updatedAt: new Date() },
        });
        return { success: true, action };
      }
    }

    const commands: Record<string, string> = {
      shutdown: 'cmd /c shutdown /s /t 0',
      restart: 'cmd /c shutdown /r /t 0',
      sleep: 'cmd /c rundll32.exe powrprof.dll,SetSuspendState 0,1,0',
      hibernate: 'cmd /c rundll32.exe powrprof.dll,SetSuspendState 1,1,0',
    };
    const remoteCommand = commands[action];
    if (!remoteCommand) throw new Error('未知电源操作');
    if (!REMOTE_PASSWORD) throw new Error('未配置远程管理密码');

    try {
      await this.runRelayCommand(pc.ip, remoteCommand);
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

  /** 通过局域网中继机执行远程电源命令，避免云服务器直连内网 445 失败。 */
  private async runRelayCommand(ip: string, remoteCommand: string): Promise<void> {
    const relayCmd = [
      'docker', 'exec', 'chunlv-app', 'python3', '/usr/local/bin/atexec.py',
      '-codec', 'gbk',
      `${REMOTE_USER}:${REMOTE_PASSWORD}@${ip}`,
      remoteCommand,
    ].join(' ');
    await execFileAsync(
      'ssh',
      [
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'ConnectTimeout=10',
        `${LAN_RELAY_USER}@${LAN_RELAY_IP}`,
        relayCmd,
      ],
      { timeout: 30000 },
    );
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
    // 云服务器不在内网，通过局域网中继服务器发送 WOL 广播魔术包
    await execFileAsync(
      'ssh',
      [
        '-o',
        'StrictHostKeyChecking=no',
        '-o',
        'ConnectTimeout=8',
        `${LAN_RELAY_USER}@${LAN_RELAY_IP}`,
        `python3 /usr/local/bin/chunlv-wol.py ${mac}`,
      ],
      { timeout: 15000 },
    );
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
