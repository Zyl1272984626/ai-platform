import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
  cacheDir: '.vite-cache',
  // 显式预构建 naive-ui,避免按需引入时的首屏卡顿
  optimizeDeps: {
    include: ['naive-ui', '@vicons/ionicons5'],
  },
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3200,
    proxy: {
      '/api': {
        target: 'http://localhost:3100',
        changeOrigin: true,
        timeout: 600000,
      },
    },
  },
});
