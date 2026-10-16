// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockPrisma } from '../__mocks__/prisma.mock';
import type { AgentService as AgentServiceType } from '../agent/agent.service';

const T0 = new Date('2026-10-17T02:00:00Z').getTime();

/**
 * 更新包下发的带宽（2026-10-17）。
 *
 * 老板报「192.168.0.133 打开软件一直在加载」。服务端日志里那 28 分钟正好是
 * **3～5 台机器同时在拉 92MB 的更新包**（单路 3～12 分钟），办公室里就一条网 ——
 * 更新把带宽吃干，别的接口请求全部 25 秒超时，页面看着就是「一直在加载」。
 *
 * 两处根因、两条用例钉住：
 * 1. 以前限速是**每路 700KB/s**：同时 4 台就是 4×700KB/s，等于没限。
 *    现在 SUM(每一路) ≤ 总额度，机器再多也留得住业务带宽。
 * 2. 以前「排队等够 5 分钟 + 持有者下够 3 分钟」就能把名额抢走 —— 那条网慢，
 *    一台还没下完名额就被抢走，老的还在下、新的也开下，越抢越多。
 *    现在有人在真下载时名额一律不动；下完 / 断了（`active` 归零）照旧让位。
 */
describe('更新包下发带宽（办公室那条网不能再被抢干）', () => {
  let service: AgentServiceType;
  let throttled: typeof import('../common/throttled-file');

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    // 名额表是模块级状态，每个用例都要一份干净的
    vi.resetModules();
    const mod = await import('../agent/agent.service');
    service = new mod.AgentService(createMockPrisma() as any);
    // resetModules 之后一起新建的，跟 agent.service 里 import 到的是同一份实例
    throttled = await import('../common/throttled-file');
    throttled.throttledDownloadState.active = 0;
  });

  afterEach(() => {
    service?.onModuleDestroy();
    throttled.throttledDownloadState.active = 0;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('总额度是多路共享的：4 台同时下，加起来也不超过总额度', () => {
    const base = throttled.UPDATE_DOWNLOAD_BYTES_PER_SEC;
    expect(throttled.perStreamBytesPerSec(1)).toBe(base);

    const each = throttled.perStreamBytesPerSec(4);
    expect(each).toBeLessThanOrEqual(Math.floor(base / 4));
    expect(each * 4).toBeLessThanOrEqual(base);
  });

  it('有人在真下载时，排队够久的机器也不能把名额抢走（下完才让位）', () => {
    expect(throttled.activeThrottledDownloads()).toBe(0);
    expect(service.acquireUpdateSlot('holder').granted).toBe(true);
    vi.setSystemTime(T0 + 30_000);
    expect(service.acquireUpdateSlot('waiter').granted).toBe(false);

    // 服务端有一路更新流正在下发
    throttled.throttledDownloadState.active = 1;
    vi.setSystemTime(T0 + 6 * 60_000); // 等够 5 分钟、持有者也下够 3 分钟
    expect(service.acquireUpdateSlot('waiter').granted).toBe(false);
    expect(service.getUpdateSlot().companionId).toBe('holder');

    // 那一路下完（或者客户端崩了、连接断了）之后，排队的机器照旧接得过去
    throttled.throttledDownloadState.active = 0;
    expect(service.acquireUpdateSlot('waiter').granted).toBe(true);
    expect(service.getUpdateSlot().companionId).toBe('waiter');
  });

  it('有人在真下载时，超时兜底也不会把名额腾走（避免两路并行抢带宽）', () => {
    service.onModuleInit();
    service.acquireUpdateSlot('holder');
    throttled.throttledDownloadState.active = 1;

    vi.advanceTimersByTime(16 * 60_000); // 超过 15 分钟超时
    expect(service.getUpdateSlot().companionId).toBe('holder');

    // 下载流断了 → 名额该腾就腾，不能因为「有人在别处下」把这家店卡死
    throttled.throttledDownloadState.active = 0;
    vi.advanceTimersByTime(60_000);
    expect(service.getUpdateSlot().companionId).toBe('');
  });
});
