# drone PoC

PX4 SITL + MAVSDK PoC, running on Apple Silicon Mac with Docker Desktop.

- **第 1 關** — [server/telemetry.py](server/telemetry.py):連上 mavsdk_server,把遙測印在 console。
- **第 2 關** — [server/server.py](server/server.py) + [web/](web/):飛行控制 + Cesium 3D 即時地圖（見下方）。
- **第 3 關** — 同上再長成小型 **GCS**:側欄儀表板 + 點地圖規劃航點上傳飛控 + 畫預定航線（見下方）。
- **第 4 關** — **多機**:N 台各自獨立的 PX4 SITL,側欄選台、每台各自遙測/航線/任務（見下方）。

```
drone/
  server/             ← Python 後端 (server.py, telemetry.py, pyproject.toml) — 在這裡跑 uv
  web/                ← React + Cesium 前端
  gen_compose.py      ← 產生 N 台的 docker-compose.yaml(第 4 關)
  docker-compose.yaml ← 由 gen_compose.py 產生(預設 3 台)
```

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
[ Mac host ]  server/telemetry.py (第1關)  或  server/server.py + web/ (第2關)
```

容器只提供 PX4 + mavsdk_server,Python 客戶端一律跑在 Mac host —— 這樣
mavsdk_server 只有**一個** gRPC 客戶端;兩個客戶端會讓 arm/takeoff 的命令 ACK timeout。

## Run

```sh
docker compose up                       # PX4 + mavsdk_server,等 GPS lock (~30s)
cd server && uv run python telemetry.py  # 第 1 關: 在 host 印遙測
```

`uv` 指令都要在 `server/` 底下跑（pyproject.toml 在那裡）。連到容器內已對外的 gRPC 50051,印出位置/電量/模式。

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

讓無人機飛、並用 3D 地球即時看它在哪。後端 [server/server.py](server/server.py) 沿用上面的
mavsdk_server gRPC 連線,再對前端開遙測 / 控制介面;前端 [web/](web/) 是
React + Vite + CesiumJS(resium)。

```
mavsdk_server :50051 ──gRPC──> server/server.py :8000 ──WS/REST──> web/ (Cesium) :5173
```

### 跑起來(三個終端機)

```sh
# 1) PX4 + mavsdk_server(同上)
docker compose up                       # 等 PX4 取得 GPS lock(~30s)

# 2) 後端(在 server/ 底下;gRPC 50051 已對外)
cd server && uv run uvicorn server:app --reload

# 3) 前端
cd web && npm install        # 第一次才需要
npm run dev                  # 打開 http://localhost:5173
```

### 操作

- **看位置**:Cesium 地球上的青色標記就是無人機,左側欄儀表板顯示連線/高度/速度/電量/模式,並畫出青色飛行軌跡。
- **鍵盤手動飛**:按「手動操控 (Offboard)」後,用 `WASD` 前後左右、`R/F` 升降、`Q/E` 轉向。
- 「Arm 解鎖」「起飛」「降落」「返航 RTL」按鈕,以及「鏡頭跟隨」「清除飛行軌跡」。

### Cesium 影像 token(選用)

預設用 OpenStreetMap 圖磚,**零設定即可跑**。想要 Cesium 官方高解析影像/地形,
在 `web/.env` 放 `VITE_CESIUM_ION_TOKEN=你的token`(免費,從 https://cesium.com/ion/tokens 取得)。

## 第 3 關:小型 GCS — 航線規劃

在第 2 關的地圖 + 控制之上,長出地面站(GCS)雛形:**左側欄儀表板**(連線狀態、電量條、速度、
高度、模式、任務進度)、**點地圖規劃航點**並上傳到飛控執行、地圖上同時畫出**飛行軌跡**(青色)
與**預定航線**(黃色虛線 + 編號航點)。

後端新增 [server/server.py](server/server.py) 的 `mission` 端點(用 MAVSDK mission plugin):

```
POST /api/mission/upload  { waypoints:[{lat,lon}], alt, speed }   # 上傳航點任務
POST /api/mission/start                                            # 開始(自動 arm + 切 MISSION)
POST /api/mission/pause / clear                                    # 暫停 / 清除
```
任務進度(第幾個航點 / 共幾個)會跟著 `/ws/telemetry` 一起推回前端儀表板。

### 規劃並飛一條航線

1. 在地圖上**依序點選**幾個點 → 出現黃色編號航點與預定航線(此時只是規劃,還沒送飛控)。
2. **編輯航點**:直接在地圖上**拖曳**航點移動、**右鍵**刪除;側欄航點清單每列也有 **＋ 插入**(在該點後插中點)、**✕ 刪除**。
3. 側欄設定**高度 / 速度**,按「**上傳航線**」把任務送進 PX4。
4. 按「**開始任務**」→ 無人機自動 arm、起飛、依序飛過每個航點;側欄即時顯示「第 N / 共 M 航點」。
5. 「暫停 / 清除任務」「復原 / 清除航線」隨時可用。

## 第 4 關:多機 GCS

把整套 GCS 長成**多機**:N 台各自獨立的 `PX4 SITL + mavsdk_server`(各自一個 gRPC host port
50051/50052/50053…),後端為每台開一條 `System`(一個 `DroneAgent`)。側欄可**選台**,被選中那台
才是「目前控制中」——它的遙測、航線、任務都各自獨立;地圖上每台用**不同顏色**的標記與軌跡。

```
台數 N: px4-sitl-{i} + mavsdk-{i}  ── host gRPC 5005{i} ──> DroneAgent[i] ──┐
                                                                            ▼
            server.py :8000   REST /api/drone/{i}/...   WS /ws/telemetry {drones:[…]}
```

### 跑起來(台數預設 3)

```sh
# 1) 產生 N 台的 compose 並啟動(每台一組獨立容器,起飛點自動錯開)
python gen_compose.py 3        # 想要幾台就帶幾(預設 3)
docker compose up              # 等各台 GPS lock(多台會久一點)

# 2) 後端 —— DRONE_COUNT 要跟上面一致
cd server && DRONE_COUNT=3 uv run uvicorn server:app --reload

# 3) 前端(同前)
cd web && npm run dev
```

> 資源吃緊就降到 2 台:`python gen_compose.py 2` + `DRONE_COUNT=2`。

### 操作
- 側欄最上面的 **D1 / D2 / D3** 是選台器(顏色對應地圖標記、附電量),點一下切換「**目前控制中**」那台。
- 其下的儀表板、飛行控制、航線規劃**全部只作用在控制中那台**;切到別台就各自規劃、各自飛,互不干擾。
- REST 全部帶索引,例:`POST /api/drone/1/takeoff` 只讓第 2 台(index 1)起飛。

### 群組指令(一次對全部)
選台器下方的「**群組指令**」卡可一鍵對**所有** drone 下令:**全部 Arm / 全部起飛 / 全部降落 / 全部返航**
(`POST /api/all/{arm,takeoff,land,rtl}`,後端 `asyncio.gather` 並行 fan-out)。每台**各自獨立**執行:
全部起飛是各自原地垂直爬升、全部返航是各自飛回**自己的** home 降落,水平分開不交會。

> 注意:同時跑 3 台 PX4 SITL 很吃 CPU,sim 會明顯變慢、指令偶爾 ACK timeout(群組會回各台 `{ok}` 結果);
> 要順順跑建議 2 台(`gen_compose.py 2` + `DRONE_COUNT=2`)。
