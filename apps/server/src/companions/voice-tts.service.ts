import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

/** 店长自定义文案的自然语音：调用服务器上的 edge-tts 生成 MP3，按「文本+声线」缓存。 */
@Injectable()
export class VoiceTtsService {
  private readonly logger = new Logger(VoiceTtsService.name);
  private readonly cache = new Map<string, Buffer>();

  private static readonly PRESETS: Record<string, { voice: string; rate: string; pitch: string }> = {
    male_qingjiao: { voice: 'zh-CN-YunxiNeural', rate: '+8%', pitch: '+15Hz' },
    male_dashu: { voice: 'zh-CN-YunjianNeural', rate: '-6%', pitch: '-12Hz' },
    male_wenrun: { voice: 'zh-CN-YunyangNeural', rate: '-2%', pitch: '+0Hz' },
    female_shaoluo: { voice: 'zh-CN-XiaoyiNeural', rate: '+8%', pitch: '+18Hz' },
    female_yujie: { voice: 'zh-CN-XiaoxiaoNeural', rate: '-5%', pitch: '-10Hz' },
    female_tianmei: { voice: 'zh-CN-XiaoxiaoNeural', rate: '+3%', pitch: '+8Hz' },
    female_dialect: { voice: 'zh-CN-liaoning-XiaobeiNeural', rate: '+3%', pitch: '+0Hz' },
  };

  async synthesize(text: string, presetId: string): Promise<Buffer | null> {
    const content = String(text || '').trim().slice(0, 120);
    if (!content) return null;
    const preset = VoiceTtsService.PRESETS[presetId] || VoiceTtsService.PRESETS.female_tianmei;
    const key = `${presetId}|${content}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const out = join(tmpdir(), `chunlv-tts-${randomUUID()}.mp3`);
    const py = [
      'import asyncio, edge_tts, sys',
      'async def main():',
      '    await edge_tts.Communicate(sys.argv[1], sys.argv[2], rate=sys.argv[3], pitch=sys.argv[4]).save(sys.argv[5])',
      'asyncio.run(main())',
    ].join('\n');
    try {
      await new Promise<void>((resolve, reject) => {
        execFile('python3', ['-c', py, content, preset.voice, preset.rate, preset.pitch, out], {
          timeout: 20_000,
          maxBuffer: 1024 * 1024,
          // edge-tts 装在部署用户的 ~/.local 下；服务端进程是 root，显式带上网关路径。
          env: {
            ...process.env,
            PYTHONPATH: [
              '/home/ubuntu/.local/lib/python3.12/site-packages',
              process.env.PYTHONPATH,
            ].filter(Boolean).join(':'),
          },
        }, (err) => (err ? reject(err) : resolve()));
      });
      const buf = await fs.readFile(out);
      if (this.cache.size > 100) this.cache.clear();
      this.cache.set(key, buf);
      return buf;
    } catch (err: any) {
      this.logger.warn(`voice tts failed: ${err?.message || err}`);
      return null;
    } finally {
      fs.unlink(out).catch(() => {});
    }
  }
}
