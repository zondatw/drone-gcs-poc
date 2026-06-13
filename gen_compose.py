#!/usr/bin/env python3
"""
產生多機版的 docker-compose.yaml(第 4 關)。

每台無人機 = 一組獨立容器:
  - px4-sitl-{i} : PX4 SITL,用 PX4_HOME_LAT/LON 給錯開的起飛點,對外開 gRPC host port 5005{i}
  - mavsdk-{i}   : 跟 px4-sitl-{i} 共用 network namespace,跑 mavsdk_server(udpin 14540 → gRPC 50051)

每組容器各自一個 netns,所以 PX4 都用預設 14540 不會衝突;對外則是 host port 50051、50052…
後端(server.py)再為每個 host port 開一條 System。

用法:
    python gen_compose.py [N=3]      # 產生 N 台的 docker-compose.yaml

注意:後端的 DRONE_COUNT 要設成一樣的 N(見 README)。
"""

import sys
from pathlib import Path

# 起飛點基準(蘇黎世,PX4 SITL 預設);每台往北偏一點,地圖上才不會疊在一起。
HOME_LAT = 47.3977
HOME_LON = 8.5456
HOME_ALT = 488.0
LAT_STEP = 0.0008  # 每台間隔 ~90m

HEADER = """\
# 全容器化多機 GCS —— 本檔由 gen_compose.py 產生,別手改。
#
# 每台無人機一組獨立容器(各自 netns):
#   px4-sitl-{{i}}  PX4 SITL(PX4_HOME_* 錯開起飛點)→ 對外 gRPC host port 5005{{i}}
#   mavsdk-{{i}}    與 px4-sitl-{{i}} 共用 netns,跑 mavsdk_server(udpin 14540 → gRPC 50051)
# 再加上:
#   backend        FastAPI,連各 px4-sitl-{{i}}:50051(gRPC/TCP,跨容器 OK)→ :8000
#   web            nginx serve 前端 build,並 proxy /api、/ws 給 backend → :5173
#
# 一鍵全起(前後端 + 無人機):
#   python gen_compose.py {n}
#   docker compose up --build        # 第一次需 build images;之後 docker compose up
#   開 http://localhost:5173
#   (要 Cesium 衛星圖:先 export VITE_CESIUM_ION_TOKEN=你的token 再 build)
#
# 只起 infra、前後端改在 host 跑(開發 hot reload):
#   docker compose up px4-sitl-1 mavsdk-1 [px4-sitl-2 mavsdk-2 ...]
#   cd server && DRONE_COUNT={n} uv run uvicorn server:app --reload
#   cd web && npm run dev
"""

MAVSDK_CMD = """\
        set -e
        BIN=/app/.mavsdk_server_linux
        if [ ! -x "$$BIN" ]; then
          echo '>>> 下載 mavsdk_server v3.15.0 (linux-arm64-musl) ...'
          python -c "import urllib.request; urllib.request.urlretrieve('https://github.com/mavlink/MAVSDK/releases/download/v3.15.0/mavsdk_server_linux-arm64-musl','$$BIN')"
          chmod +x "$$BIN"
        fi
        echo '>>> 啟動 mavsdk_server (udpin 14540, gRPC 50051) ...'
        exec "$$BIN" udpin://0.0.0.0:14540 -p 50051
"""


def service_block(i: int) -> str:
    host_port = 50050 + i
    lat = HOME_LAT + LAT_STEP * (i - 1)
    return f"""\
  px4-sitl-{i}:
    image: px4io/px4-sitl:latest
    extra_hosts:
      - "host.docker.internal:127.0.0.1"   # keeps MAVLink on localhost
    environment:
      PX4_HOME_LAT: "{lat:.6f}"
      PX4_HOME_LON: "{HOME_LON:.6f}"
      PX4_HOME_ALT: "{HOME_ALT:.1f}"
    ports:
      - "{host_port}:50051"   # 對外 gRPC(drone {i})

  mavsdk-{i}:
    image: python:3.13-slim
    depends_on:
      - px4-sitl-{i}
    network_mode: "service:px4-sitl-{i}"
    working_dir: /app
    volumes:
      - ./server:/app
    command:
      - sh
      - -c
      - |
{MAVSDK_CMD}    restart: "no"
"""


def app_block(n: int) -> str:
    # 後端連各 px4-sitl 容器的 gRPC(內部 port 50051);前端 nginx proxy 給後端。
    targets = ",".join(f"px4-sitl-{i}:50051" for i in range(1, n + 1))
    depends = "\n".join(f"      - mavsdk-{i}" for i in range(1, n + 1))
    return f"""\
  backend:
    build: ./server
    depends_on:
{depends}
    environment:
      MAVSDK_TARGETS: "{targets}"
    ports:
      - "8000:8000"
    restart: "no"

  web:
    build: ./web
    depends_on:
      - backend
    environment:                       # token 在「啟動時」帶入(不烤進 image)
      VITE_CESIUM_ION_TOKEN: "${{VITE_CESIUM_ION_TOKEN:-}}"
    ports:
      - "5173:80"
    restart: "no"
"""


def main() -> None:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    if n < 1:
        sys.exit("台數至少 1")
    drones = "\n".join(service_block(i) for i in range(1, n + 1))
    out = HEADER.format(n=n) + "\nservices:\n" + drones + "\n" + app_block(n)
    Path("docker-compose.yaml").write_text(out)
    print(f"已產生全容器化的 docker-compose.yaml({n} 台 + backend + web)")
    print("一鍵全起: docker compose up --build  →  開 http://localhost:5173")


if __name__ == "__main__":
    main()
