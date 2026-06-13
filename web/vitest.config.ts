import { defineConfig } from 'vitest/config'

// 獨立的 vitest 設定(不載入 vite-plugin-cesium):只測純邏輯(store / route),用 node 環境。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
