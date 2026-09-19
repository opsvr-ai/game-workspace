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

export default defineConfig({
  plugins: [react()],
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