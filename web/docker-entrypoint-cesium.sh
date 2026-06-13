#!/bin/sh
# nginx 啟動時執行(/docker-entrypoint.d/)。依環境變數 VITE_CESIUM_ION_TOKEN 寫出 config.js,
# 把 Cesium ion token 在「容器啟動時」注入 —— 不在 build 階段、不烤進 image。
cat > /usr/share/nginx/html/config.js <<EOF
window.CESIUM_ION_TOKEN = "${VITE_CESIUM_ION_TOKEN:-}";
EOF
