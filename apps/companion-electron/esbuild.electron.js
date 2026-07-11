require('esbuild').build({
  entryPoints: ['electron/main.ts', 'electron/preload.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outdir: 'dist-electron',
  external: ['electron', 'electron-store'],
  format: 'cjs',
  sourcemap: false,
  minify: false,
}).catch(() => process.exit(1));
