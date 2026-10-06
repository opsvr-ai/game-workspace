// craftsman-ignore: TS002
import { defineConfig } from 'vitest/config';

/**
 * 陪玩端（Electron 主进程）测试配置（2026-10-07）。
 *
 * 为什么要给客户端补测试：这一端有一个**客户端的客户端**都没有的能力 —— 它会自己
 * 「下好新版 → 等陪玩空闲 → 写信号让看门狗换文件重启」。这段逻辑判断错了的后果不是
 * 「页面打不开」，而是**这台机器接不了单**（线上真发生过：同机装了客服端，信号被看门狗
 * 按客服端解压，陪玩端被换掉）。而它在本机没法真跑（要有看门狗服务、要有更新包）。
 *
 * 所以这里的办法是：把「决定要不要动用户机器」的那几个判断（跨端信号、拉黑版本、
 * 同一个包别反复下、备货包能不能用）单独测掉 —— 不启动 Electron、不碰注册表、
 * 不写 C:\ProgramData（全部 mock）。
 *
 *   pnpm --filter @chunlv/companion-electron test
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['electron/**/*.test.ts'],
    restoreMocks: true,
  },
});
