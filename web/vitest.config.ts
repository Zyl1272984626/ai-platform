import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import path from 'path'

const testDir = 'F:\\test\\frontend\\主系统(Agent)'

export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    environment: 'happy-dom',
    include: [
      path.resolve(testDir, '**', '*.test.ts'),
    ],
    reporters: ['json', 'verbose'],
    outputFile: {
      json: path.resolve(testDir, 'test-results.json'),
    },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
