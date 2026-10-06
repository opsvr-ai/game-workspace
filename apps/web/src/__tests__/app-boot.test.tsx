import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { matchRoutes } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';

/** docs/WEB-ROUTES.json —— 路由契约的「冻结件」，由 scripts/_export_web_routes.mjs 导出。
 *  （vitest 的工作目录是 apps/web，往上两级就是仓库根。） */
const ROUTES_FILE = path.join(process.cwd(), '..', '..', 'docs', 'WEB-ROUTES.json');

// router 是模块级单例、创建时就读 window.location，所以地址必须在 import App 之前摆好。
beforeAll(() => {
  window.history.pushState({}, '', '/ui-kit');
});

/**
 * 整站启动冒烟（2026-10-07）。
 *
 * 和 login-page.test.tsx 的区别：这里渲染的是**真的那个 App** ——
 * 真的 antd 主题、真的路由表、真的 Suspense 包装、真的页面组件，一个都不少。
 * 所以「路由改坏了 / 主题配置报错 / 某个页面 import 崩了」这类问题，这里就能红。
 * 选 /ui-kit 当落点是因为它不需要登录、也不需要后端。
 */
describe('整站启动冒烟（不连后端）', () => {
  it('打开 /ui-kit：整个 App 能渲染出来', async () => {
    const { default: App } = await import('../App');
    render(<App />);
    // 页面是**按路由懒加载**的（见 router.tsx）：import ../App 现在只装「外壳 + 当前这一页」，
    // 而这一页的模块是渲染时才真正 transform 的 —— 第一次跑 vitest 没有缓存，本机实测要十来秒。
    // 所以这条断言要单独放宽等待（findBy* 默认只等 1 秒，跑全量测试时会被 CPU 抢占拖红）。
    // 放宽的是「等多久」，不是「等什么」：等不到这行字照样红。
    expect(await screen.findByText('设计校对页', {}, { timeout: 60_000 })).toBeInTheDocument();
  }, 120_000);

  it('冻结的路由表里每一条路径，在真路由里都还能匹配到', async () => {
    const { router } = await import('../router');
    const frozen = JSON.parse(fs.readFileSync(ROUTES_FILE, 'utf8')) as {
      count: number;
      routes: Array<{ path: string; kind: string }>;
    };
    expect(frozen.routes.length).toBe(frozen.count);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const routes = router.routes as any;
    const unreachable = frozen.routes.map((r) => r.path).filter((p) => !matchRoutes(routes, p));
    expect(unreachable).toEqual([]);
  }, 120_000);
});
