/**
 * 把某个 api 模块里的 `xxxApi` 整体打桩成「请求成功、但没有数据」。
 *
 * 为什么要有它（2026-10-07）：
 *   ① 「要数据的页面」想渲染起来，必须先让接口别真的发出去；
 *   ② 手写方法名一定会漏 —— 第一版订单池测试只挑了「想得到」的几个方法，
 *      漏了 `configApi.get`，页面一渲染就崩，而报错跟业务毫无关系；
 *   ③ 所以这里按**真实模块的 key** 生成打桩，接口以后加新方法都不用改测试。
 *
 * 用法（工厂函数必须写在测试文件里，这样 `vi.mock` 的路径才按测试文件解析）：
 *   vi.mock('../api/orders', async () =>
 *     stubApi(await vi.importActual('../api/orders'), 'ordersApi'));
 */
import { vi } from 'vitest';

export function stubApi(mod: unknown, exportName: string): Record<string, unknown> {
  const source = mod as Record<string, unknown>;
  const api = (source[exportName] ?? {}) as Record<string, unknown>;
  const stubbed = Object.fromEntries(
    Object.keys(api).map((k) => [k, vi.fn(async () => ({ data: { data: null } }))]),
  );
  return { ...source, [exportName]: stubbed };
}