// runtime 設定。預設空字串 → 前端 fallback 到 import.meta.env / OpenStreetMap。
// 全容器化時,nginx 啟動腳本會依環境變數 VITE_CESIUM_ION_TOKEN 覆寫這支檔。
window.CESIUM_ION_TOKEN = ''
