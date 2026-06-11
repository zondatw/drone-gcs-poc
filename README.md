# drone PoC

PX4 SITL + MAVSDK PoC, running on Apple Silicon Mac with Docker Desktop.

- **第 1 關** — [telemetry.py](telemetry.py):連上 mavsdk_server,把遙測印在 console。
- **第 2 關** — [server.py](server.py) + [web/](web/):飛行控制 + Cesium 3D 即時地圖（見下方）。

## Why not run mavsdk_server on the Mac host?

Docker Desktop for Mac proxies `host.docker.internal` for **TCP only**. MAVLink uses UDP,
so packets sent from a container to `host.docker.internal` are silently dropped.
`mavsdk_server` must run inside a container that shares PX4's network namespace.

## Architecture

```
[ Docker: px4io/px4-sitl ]
    extra_hosts: host.docker.internal → 127.0.0.1
    → entrypoint patches MAVLink to send to 127.0.0.1:14540 (stays on localhost)
        │  MAVLink UDP (localhost:14540)
        ▼
[ Docker: app — shared network namespace ]
    mavsdk_server  udpin://0.0.0.0:14540  →  gRPC :50051
        │  gRPC (localhost:50051, exposed to host)
        ▼
[ Mac host ]  telemetry.py (第1關)  或  server.py + web/ (第2關)
```

容器只提供 PX4 + mavsdk_server,Python 客戶端一律跑在 Mac host —— 這樣
mavsdk_server 只有**一個** gRPC 客戶端;兩個客戶端會讓 arm/takeoff 的命令 ACK timeout。

## Run

```sh
docker compose up              # PX4 + mavsdk_server,等 GPS lock (~30s)
uv run python telemetry.py     # 第 1 關: 在 host 印遙測
```

`uv run python telemetry.py` 連到容器內已對外的 gRPC 50051,印出位置/電量/模式。

## Cached binaries

The compose script auto-downloads `mavsdk_server_linux-arm64-musl` on first run and caches it as `.mavsdk_server_linux`.
To download manually:

```sh
curl -L -o .mavsdk_server_linux \
  https://github.com/mavlink/MAVSDK/releases/download/v3.15.0/mavsdk_server_linux-arm64-musl
chmod +x .mavsdk_server_linux
```

All release assets (other platforms/versions): https://github.com/mavlink/MAVSDK/releases/tag/v3.15.0

## Stop

```sh
docker compose down
```

## 第 2 關:飛行控制 + Cesium 3D 即時地圖

讓無人機飛、並用 3D 地球即時看它在哪。後端 [server.py](server.py) 沿用上面的
mavsdk_server gRPC 連線,再對前端開遙測 / 控制介面;前端 [web/](web/) 是
React + Vite + CesiumJS(resium)。

```
mavsdk_server :50051 ──gRPC──> server.py :8000 ──WS/REST──> web/ (Cesium) :5173
```

### 跑起來(三個終端機)

```sh
# 1) PX4 + mavsdk_server(同上)
docker compose up            # 等 PX4 取得 GPS lock(~30s)

# 2) 後端(在 Mac host;gRPC 50051 已對外)
uv run uvicorn server:app --reload

# 3) 前端
cd web && npm install        # 第一次才需要
npm run dev                  # 打開 http://localhost:5173
```

### 操作

- **看位置**:Cesium 地球上的青色標記就是無人機,左上 HUD 顯示高度/速度/電量/模式,並畫出飛行軌跡。
- **點地圖飛過去**:按「Arm 解鎖」→「起飛」,然後在地圖上點任一點,無人機會 `goto` 飛過去。
- **鍵盤手動飛**:按「手動操控 (Offboard)」後,用 `WASD` 前後左右、`R/F` 升降、`Q/E` 轉向。
- 「降落」「返航 RTL」按鈕,以及「鏡頭跟隨」「清除軌跡」。

### Cesium 影像 token(選用)

預設用 OpenStreetMap 圖磚,**零設定即可跑**。想要 Cesium 官方高解析影像/地形,
在 `web/.env` 放 `VITE_CESIUM_ION_TOKEN=你的token`(免費,從 https://cesium.com/ion/tokens 取得)。
