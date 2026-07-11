import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: '.',
  base: './',
  resolve: {
    alias: {
      '../../api/client': path.resolve(__dirname, 'src/api/client.ts'),
      '../../api/companions': path.resolve(__dirname, '../../apps/web/src/api/companions.ts'),
      '../../api/customers': path.resolve(__dirname, '../../apps/web/src/api/customers.ts'),
      '../../api/orders': path.resolve(__dirname, '../../apps/web/src/api/orders.ts'),
      '../../api/billing': path.resolve(__dirname, '../../apps/web/src/api/billing.ts'),
      '../../api/config': path.resolve(__dirname, '../../apps/web/src/api/config.ts'),
      '../../api/expenses': path.resolve(__dirname, '../../apps/web/src/api/expenses.ts'),
      '../../api/studios': path.resolve(__dirname, '../../apps/web/src/api/studios.ts'),
      '../../api/employees': path.resolve(__dirname, '../../apps/web/src/api/employees.ts'),
      '../../api/dashboard': path.resolve(__dirname, '../../apps/web/src/api/dashboard.ts'),
      '../../api/ai': path.resolve(__dirname, '../../apps/web/src/api/ai.ts'),
      '../../api/blacklist': path.resolve(__dirname, '../../apps/web/src/api/blacklist.ts'),
      '../../stores/authStore': path.resolve(__dirname, '../../apps/web/src/stores/authStore.ts'),
      '../../constants': path.resolve(__dirname, '../../apps/web/src/constants/index.ts'),
      '../../constants/orders': path.resolve(__dirname, '../../apps/web/src/constants/orders.ts'),
      '../../components/ChatModal': path.resolve(__dirname, '../../apps/web/src/components/ChatModal.tsx'),
      '../../components/CreateOrderModal': path.resolve(__dirname, '../../apps/web/src/components/CreateOrderModal.tsx'),
      '../../components/OrderTable': path.resolve(__dirname, '../../apps/web/src/components/OrderTable.tsx'),
      '../../components/StatusBlacklistConfigModal': path.resolve(__dirname, '../../apps/web/src/components/StatusBlacklistConfigModal.tsx'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5174,
  },
});
