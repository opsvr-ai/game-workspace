// craftsman-ignore: TS002
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_URL = process.env.VITE_API_URL || 'http://localhost:3001';

// dev（pnpm dev，8000）和 preview（pnpm preview，8100）用同一份代理，
// 避免两边各写一遍、改一边忘一边。
const proxy = {
  '/api': { target: API_URL, changeOrigin: true, timeout: 600000 },
  '/socket.io': { target: API_URL, changeOrigin: true, ws: true },
  '/uploads': { target: API_URL, changeOrigin: true },
};

// 把第三方库拆成几个「长期不变」的分块。
// 以前整个前端是一个 2.8MB 的大文件，每次发布（哪怕只改一行字）所有客户端都要
// 重新下载这 2.8MB。拆开之后 react / antd / 图表 各自一个文件，
// 发布界面改动时只有应用那一个分块变，客户端只重下那部分。
//
// 2026-10-07 又往前一步：页面改成按路由懒加载（见 src/router.tsx），
// 入口分包从 1.2MB 掉到 347KB（首屏 gzip 820KB → 582KB），图表分块也不再首屏必拉。
// 守卫：scripts/_check_route_splitting.mjs（不许把页面写回同步 import，并量首屏合计体积）。
//
// 想再减首屏？先看这条，别白试（2026-10-07 实测过）：
//   ① 让 antd 走默认分块 → Rollup 会把 antd 直接并进 react 块（204KB → 1446KB），首屏只少 22KB；
//   ② 把 Table / DatePicker / Upload 这些「只有表格页才用」的摘成单独块 → 那个块**仍然被首屏静态引用**
//      （代码里 `import { X } from 'antd'` 走的是 antd 的汇总出口，所有组件都算「可达」），首屏反而 +2KB。
// 所以真正的办法是「外壳别再 import 汇总出口，改成 antd/es/xxx 按组件引」—— 工序大，另开一批。
function manualChunks(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined;
  if (id.includes('recharts') || id.includes('d3-') || id.includes('victory')) return 'charts';
  if (id.includes('antd') || id.includes('@ant-design') || id.includes('rc-') || id.includes('@rc-component')) return 'antd';
  if (id.includes('react-dom') || id.includes('react-router') || id.includes('scheduler') || id.includes('/react/')) return 'react';
  // 其余一律留在大包里。注意：不要再加一个「万能 vendor」兜底块——
  // 那会让 react 块和 vendor 块互相引用（循环依赖），
  // 表现就是启动时报 reading 'useLayoutEffect' of undefined、整页白屏。
  return undefined;
}

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: { manualChunks },
    },
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: '0.0.0.0',
    port: 8000,
    proxy,
  },
  // 用「生产包」在本地验证：
  //   VITE_API_URL=http://1.117.229.36:3001 pnpm build && pnpm preview
  // 打开 http://localhost:8100 看到的就是线上真正会跑的那份产物。
  // dev server 不经过打包，压缩/分包这类问题在 dev 下根本复现不出来，
  // 所以发版前应该用 preview 过一遍。
  preview: {
    port: 8100,
    proxy,
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});