import type { PrismaService } from '../prisma/prisma.service';
import { resolveConfigs } from './studio-config';

/**
 * 服务计时配置：店长可在后台改「提醒后多久自动结束」和「结束服务缓冲多久」。
 * 返回毫秒，读不到配置就用 20 分钟 / 3 分钟默认值。
 */
export async function getServiceTiming(
  prisma: PrismaService,
  studioId: string | null | undefined,
): Promise<{ autoEndMs: number; bufferMs: number }> {
  const cfg = await resolveConfigs(prisma, studioId, [
    'service.auto_end_after_reminder_minutes',
    'service.end_buffer_minutes',
  ]).catch(() => ({} as Record<string, any>));
  const autoMin = Number(cfg['service.auto_end_after_reminder_minutes']);
  const bufferMin = Number(cfg['service.end_buffer_minutes']);
  return {
    autoEndMs: Math.max(1, Number.isFinite(autoMin) ? autoMin : 20) * 60 * 1000,
    bufferMs: Math.max(0, Number.isFinite(bufferMin) ? bufferMin : 3) * 60 * 1000,
  };
}
