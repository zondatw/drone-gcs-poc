import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'

// vite-plugin-cesium 負責把 Cesium 的 Workers / Assets / Widgets 靜態資源放好,
// 並設定 CESIUM_BASE_URL,不然 3D 地球會缺資源。
// proxy: 開發時把 /api 與 /ws 都轉給後端 (server.py, :8000),前端只走同一個 origin。
export default defineConfig({
  plugins: [react(), cesium()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
      '/ws': { target: 'ws://localhost:8000', ws: true },
    },
  },
})
