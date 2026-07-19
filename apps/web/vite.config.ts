// craftsman-ignore: TS002
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_URL = process.env.VITE_API_URL || 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 8000,
    proxy: {
      '/api': {
        target: API_URL,
        changeOrigin: true,
      },
      '/socket.io': {
        target: API_URL,
        changeOrigin: true,
        ws: true,
      },
      '/uploads': {
        target: API_URL,
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
