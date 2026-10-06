// craftsman-ignore: TS002
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * 前端测试配置（2026-10-07）。
 *
 * 以前前端零测试 —— 而接下来要动的正是「不点进去就不知道有没有拆坏」的那些地方
 * （3000 行的外壳、路由、页面组件）。这个配置就干一件事：把测试跑在 jsdom 里、
 * 能用 React Testing Library 真·渲染页面，于是「改了以后页面还打得开吗」可以自动验。
 *
 *   pnpm --filter @chunlv/web test        # 跑一遍（CI 也是这句）
 *   pnpm --filter @chunlv/web test:watch  # 本地边改边跑
 *
 * css: false —— 渲染断言的是「有没有这块内容」，不是像素；真要看像素走 /ui-kit + 截图工具。
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    restoreMocks: true,
  },
});
