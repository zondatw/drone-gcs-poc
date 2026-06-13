# 前端容器:多階段 —— node 把 dist build 出來,再用 nginx serve + proxy /api、/ws 給後端。
# 注意:Cesium ion token 不在 build 階段帶入(不烤進 image),改在容器啟動時由環境變數注入,
#       見 docker-entrypoint-cesium.sh。
FROM node:23-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
# 啟動時依 env 寫出 config.js,把 token runtime 注入(docker compose 的 environment 帶入)。
COPY docker-entrypoint-cesium.sh /docker-entrypoint.d/40-cesium-token.sh
RUN chmod +x /docker-entrypoint.d/40-cesium-token.sh
EXPOSE 80
