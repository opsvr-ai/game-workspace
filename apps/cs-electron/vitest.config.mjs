import { defineConfig } from 'vitest/config';

/**
 * 客服端（Electron 主进程）测试配置（2026-10-07）。
 *
 * 为什么要给这一端补测试：客服端只有一条路会碰到用户机器 —— 自动升级（写信号让看门狗
 * 解压整包，或者下安装包让对方点一次 UAC）。走错了不是「页面难看」，而是**这台机器上的
 * 客户端起不来 / 陪玩端被换成客服端（那台机器就接不了单）**。而它在开发机上没法真跑
 * （要有看门狗服务、要有更新包、要真重启）。
 *
 * 所以这里的办法是：把「决定要不要动用户机器」的那几个判断单独拎出来测
 * （见 update-decisions.js / update-decisions.test.mjs）—— 不启动 Electron、不碰注册表、
 * 不写 C:\ProgramData（全部用假的 fs）。
 *
 *   pnpm --filter @chunlv/cs-electron test
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['*.test.mjs'],
    restoreMocks: true,
  },
});