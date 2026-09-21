// craftsman-ignore: TS001
import { createWriteStream, readFileSync, statSync } from 'fs';

/**
 * 极简 ZIP 打包（只用 store，不做压缩），零依赖纯 Node。
 *
 * 为什么不用系统 `zip` 命令：线上服务器**根本没装 zip**，`execFile('zip', ...)`
 * 直接 spawn ENOENT —— 管理端「下载图片包」100% 失败（老板 2026-09-22 报）。
 * 而且依赖系统命令还有个隐患：换台机器/重建服务器就又坏了。
 *
 * 战绩图都是 jpg/png（本来就压过一轮），再 deflate 几乎没有收益，
 * 所以这里用 store 方式：实现简单、打包快，Windows 资源管理器 / 7-Zip / macOS
 * 都能正常解压。
 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

/** ZIP 里的时间戳是 DOS 格式（1980 年起算，秒只有偶数档）。 */
function dosDateTime(date: Date): { time: number; date: number } {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f);
  const dosDate =
    ((Math.max(0, date.getFullYear() - 1980) & 0x7f) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { time: time & 0xffff, date: dosDate & 0xffff };
}

export interface ZipEntry {
  /** 压缩包里的文件名（同级，不带目录） */
  name: string;
  /** 服务器上的绝对路径 */
  path: string;
}

interface CentralRecord {
  name: Buffer;
  crc: number;
  size: number;
  offset: number;
  time: number;
  date: number;
}

/** 把若干文件打成一个 zip（同级、不压缩）。返回写入的条目名列表。 */
export async function writeZip(outPath: string, entries: ZipEntry[]): Promise<string[]> {
  const out = createWriteStream(outPath);
  const written: string[] = [];
  const central: CentralRecord[] = [];
  let offset = 0;

  // 用 write 的回调拿到「真正写盘完成」，顺便自然处理背压，不会把大图全堆在内存里。
  const put = (buf: Buffer) =>
    new Promise<void>((resolve, reject) => {
      out.write(buf, (err) => (err ? reject(err) : resolve()));
    });

  try {
    for (const entry of entries) {
      const data = readFileSync(entry.path);
      const stat = statSync(entry.path);
      const name = Buffer.from(entry.name, 'utf8');
      const crc = crc32(data);
      const { time, date } = dosDateTime(stat.mtime || new Date());

      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0); // 本地文件头签名
      local.writeUInt16LE(20, 4); // 解压所需版本
      local.writeUInt16LE(0x0800, 6); // 文件名用 UTF-8
      local.writeUInt16LE(0, 8); // 0 = store（不压缩）
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(date, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(data.length, 18); // 压缩后大小（store 等于原大小）
      local.writeUInt32LE(data.length, 22); // 原大小
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(0, 28); // 扩展字段长度

      await put(local);
      await put(name);
      await put(data);

      central.push({ name, crc, size: data.length, offset, time, date });
      offset += local.length + name.length + data.length;
      written.push(entry.name);
    }

    const centralStart = offset;
    for (const rec of central) {
      const head = Buffer.alloc(46);
      head.writeUInt32LE(0x02014b50, 0); // 中央目录签名
      head.writeUInt16LE(20, 4); // 创建版本
      head.writeUInt16LE(20, 6); // 解压所需版本
      head.writeUInt16LE(0x0800, 8);
      head.writeUInt16LE(0, 10);
      head.writeUInt16LE(rec.time, 12);
      head.writeUInt16LE(rec.date, 14);
      head.writeUInt32LE(rec.crc, 16);
      head.writeUInt32LE(rec.size, 20);
      head.writeUInt32LE(rec.size, 24);
      head.writeUInt16LE(rec.name.length, 28);
      head.writeUInt16LE(0, 30); // 扩展字段
      head.writeUInt16LE(0, 32); // 备注
      head.writeUInt16LE(0, 34); // 起始磁盘号
      head.writeUInt16LE(0, 36); // 内部属性
      head.writeUInt32LE(0, 38); // 外部属性
      head.writeUInt32LE(rec.offset, 42);
      await put(head);
      await put(rec.name);
      offset += head.length + rec.name.length;
    }

    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); // 中央目录结束记录
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(central.length, 8);
    end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(offset - centralStart, 12);
    end.writeUInt32LE(centralStart, 16);
    end.writeUInt16LE(0, 20); // 注释长度
    await put(end);
  } finally {
    await new Promise<void>((resolve) => out.end(resolve));
  }

  return written;
}
