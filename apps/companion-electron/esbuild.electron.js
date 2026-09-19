const fs = require('fs');

const OUT_DIR = 'dist-electron';
// 安装包里的 node_modules 是 pnpm 链接结构，socket.io-client 的子依赖
// （engine.io-client / ws / xmlhttprequest-ssl 等）不会被打进 asar。
// 因此主进程产物必须自包含：每次构建先清空，再由 esbuild 把依赖一起打进来。
fs.rmSync(OUT_DIR, { recursive: true, force: true });

require('esbuild').build({
  entryPoints: ['electron/main.ts', 'electron/preload.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outdir: OUT_DIR,
  // bufferutil / utf-8-validate 是 ws 的可选原生加速依赖，缺失时会自动降级。
  external: ['electron', 'electron-store', 'bufferutil', 'utf-8-validate'],
  format: 'cjs',
  sourcemap: false,
  minify: false,
}).catch(() => process.exit(1));
