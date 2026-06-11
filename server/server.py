"""
第 2~3 關:飛行控制 + 即時遙測 + 航線任務 Web 後端 (小型 GCS)。

沿用第 1 關 (telemetry.py) 連到「已經在跑」的 mavsdk_server (gRPC localhost:50051) 的做法,
但這裡不只讀遙測,還對外開這些介面給前端 (web/) 用:

  - WS  /ws/telemetry  : 持續推播 位置 / 姿態 / 速度 / 電量 / 模式 / 任務進度
  - WS  /ws/control    : 收 WASD 速度 setpoint -> offboard.set_velocity_body (手動操控)
  - REST /api/...       : arm / takeoff / land / rtl / goto / offboard 起停 (按鈕 + 點地圖)
  - REST /api/mission/* : 上傳航點任務 / 開始 / 暫停 / 清除 (第 3 關 GCS 航線規劃)

啟動: uv run uvicorn server:app --reload  (PX4 + mavsdk_server 需先用 docker compose 跑起來)
"""

import asyncio
import contextlib
import json
import logging

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from mavsdk import System
from mavsdk.action import ActionError
from mavsdk.mission import MissionItem, MissionPlan, MissionError
from mavsdk.offboard import OffboardError, VelocityBodyYawspeed

log = logging.getLogger("drone")
logging.basicConfig(level=logging.INFO, format="%(message)s")

DEFAULT_TAKEOFF_ALT_M = 10.0  # 起飛目標高度 (相對地面)

# ── 共享狀態 ──────────────────────────────────────────────────────────────
# drone: 單一條 mavsdk 連線,整個 app 共用。
# latest: 各遙測串流各自更新進來的「最新快照」,由推播迴圈定時 fan-out。
# subscribers: 每個 /ws/telemetry 連線一個 asyncio.Queue。
drone = System(mavsdk_server_address="localhost", port=50051)
latest: dict = {
    "lat": None, "lon": None,
    "abs_alt": None, "rel_alt": None, "ground_alt": None,
    "heading": None, "ground_speed": None, "vd": None,
    "battery_pct": None, "flight_mode": None, "armed": None,
    "mission_current": None, "mission_total": None,  # 任務進度 (第 N 個 / 共幾個)
}
subscribers: set[asyncio.Queue] = set()
_offboard_active = False


def broadcast() -> None:
    """把目前 latest 快照丟進每個訂閱者的 queue (掉滿就丟舊的,不阻塞遙測)。"""
    payload = json.dumps(latest)
    for q in subscribers:
        if q.full():
            with contextlib.suppress(asyncio.QueueEmpty):
                q.get_nowait()
        q.put_nowait(payload)


# ── 遙測訂閱:每種串流各跑一條 task,只更新 latest ──────────────────────────
async def _watch_position() -> None:
    async for p in drone.telemetry.position():
        latest["lat"] = p.latitude_deg
        latest["lon"] = p.longitude_deg
        latest["abs_alt"] = p.absolute_altitude_m
        latest["rel_alt"] = p.relative_altitude_m
        # 地面 AMSL 高度 = 絕對高度 - 相對高度,goto 用它把「相對高度」換成 AMSL。
        latest["ground_alt"] = p.absolute_altitude_m - p.relative_altitude_m


async def _watch_attitude() -> None:
    async for a in drone.telemetry.attitude_euler():
        latest["heading"] = a.yaw_deg  # 航向 (NED, 0=北, 順時針為正)


async def _watch_velocity() -> None:
    async for v in drone.telemetry.velocity_ned():
        latest["ground_speed"] = (v.north_m_s ** 2 + v.east_m_s ** 2) ** 0.5
        latest["vd"] = v.down_m_s


async def _watch_battery() -> None:
    async for b in drone.telemetry.battery():
        # 這個 mavsdk 版本的 remaining_percent 已經是 0~100,不用再乘 100。
        latest["battery_pct"] = b.remaining_percent


async def _watch_flight_mode() -> None:
    async for m in drone.telemetry.flight_mode():
        latest["flight_mode"] = str(m)


async def _watch_armed() -> None:
    async for armed in drone.telemetry.armed():
        latest["armed"] = armed


async def _watch_mission_progress() -> None:
    async for mp in drone.mission.mission_progress():
        latest["mission_current"] = mp.current  # 已抵達的航點索引 (-1 = 尚未開始)
        latest["mission_total"] = mp.total


async def _push_loop() -> None:
    """固定 ~10Hz 把 latest 推給所有前端,讓 battery/mode 這種低頻變化也會傳到。"""
    while True:
        broadcast()
        await asyncio.sleep(0.1)


# ── App 生命週期:連線 -> 等定位 -> 開遙測 task ────────────────────────────
@contextlib.asynccontextmanager
async def lifespan(_: FastAPI):
    log.info(">>> 連線到 mavsdk_server (localhost:50051)...")
    await drone.connect()

    log.info(">>> 等待 PX4 心跳...")
    async for state in drone.core.connection_state():
        if state.is_connected:
            log.info(">>> 已連線到 PX4!")
            break

    log.info(">>> 等待 GPS 定位...")
    async for health in drone.telemetry.health():
        if health.is_global_position_ok and health.is_home_position_ok:
            log.info(">>> 定位完成,開始推播遙測。")
            break

    tasks = [
        asyncio.create_task(c) for c in (
            _watch_position(), _watch_attitude(), _watch_velocity(),
            _watch_battery(), _watch_flight_mode(), _watch_armed(),
            _watch_mission_progress(),
            _push_loop(),
        )
    ]
    try:
        yield
    finally:
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


app = FastAPI(title="drone control", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite dev server
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── 遙測 WebSocket ────────────────────────────────────────────────────────
@app.websocket("/ws/telemetry")
async def ws_telemetry(ws: WebSocket) -> None:
    await ws.accept()
    q: asyncio.Queue = asyncio.Queue(maxsize=4)
    subscribers.add(q)
    try:
        await ws.send_text(json.dumps(latest))  # 先送一份目前狀態
        while True:
            await ws.send_text(await q.get())
    except WebSocketDisconnect:
        pass
    finally:
        subscribers.discard(q)


# ── 控制 WebSocket:WASD 速度 setpoint ────────────────────────────────────
@app.websocket("/ws/control")
async def ws_control(ws: WebSocket) -> None:
    await ws.accept()
    try:
        while True:
            data = json.loads(await ws.receive_text())
            if not _offboard_active:
                continue  # 還沒進 offboard 就忽略,避免 mavsdk 報錯
            await drone.offboard.set_velocity_body(
                VelocityBodyYawspeed(
                    float(data.get("forward", 0.0)),
                    float(data.get("right", 0.0)),
                    float(data.get("down", 0.0)),
                    float(data.get("yawspeed", 0.0)),
                )
            )
    except WebSocketDisconnect:
        pass


# ── REST 指令 ─────────────────────────────────────────────────────────────
async def cmd(coro):
    """跑一個 mavsdk 動作,把 ActionError 收成乾淨的 JSON 而不是 500。

    PX4 SITL 在指令快速連發時,命令常常其實有執行、只是 ACK 慢而回 TIMEOUT;
    這裡一律回 {ok, error},前端不會看到嚇人的 500。
    """
    try:
        await coro
        return {"ok": True}
    except (ActionError, MissionError) as e:
        return {"ok": False, "error": str(e)}


class GotoBody(BaseModel):
    lat: float
    lon: float
    alt: float | None = None  # 相對起飛點高度 (m);省略則維持目前飛行高度


class TakeoffBody(BaseModel):
    alt: float = DEFAULT_TAKEOFF_ALT_M


@app.post("/api/arm")
async def api_arm():
    return await cmd(drone.action.arm())


@app.post("/api/takeoff")
async def api_takeoff(body: TakeoffBody):
    await cmd(drone.action.set_takeoff_altitude(body.alt))
    await cmd(drone.action.arm())
    return {**await cmd(drone.action.takeoff()), "alt": body.alt}


@app.post("/api/land")
async def api_land():
    return await cmd(drone.action.land())


@app.post("/api/rtl")
async def api_rtl():
    return await cmd(drone.action.return_to_launch())


@app.post("/api/goto")
async def api_goto(body: GotoBody):
    # goto_location 吃 AMSL 絕對高度。沒給 alt 就維持目前絕對高度;
    # 給了 alt (相對地面) 則換成 AMSL = 地面 AMSL + alt。
    if body.alt is not None and latest["ground_alt"] is not None:
        abs_alt = latest["ground_alt"] + body.alt
    else:
        abs_alt = latest["abs_alt"]
    if abs_alt is None:
        return {"ok": False, "error": "尚未取得高度遙測"}
    return {
        **await cmd(drone.action.goto_location(body.lat, body.lon, abs_alt, float("nan"))),
        "abs_alt": abs_alt,
    }


@app.post("/api/offboard/start")
async def api_offboard_start():
    global _offboard_active
    # offboard 啟動前必須已 arm,且要先送一個 setpoint。
    with contextlib.suppress(Exception):
        await drone.action.arm()
    await drone.offboard.set_velocity_body(VelocityBodyYawspeed(0, 0, 0, 0))
    try:
        await drone.offboard.start()
    except OffboardError as e:
        return {"ok": False, "error": str(e)}
    _offboard_active = True
    return {"ok": True}


@app.post("/api/offboard/stop")
async def api_offboard_stop():
    global _offboard_active
    _offboard_active = False
    with contextlib.suppress(OffboardError):
        await drone.offboard.stop()
    return {"ok": True}


@app.get("/api/state")
async def api_state():
    return {**latest, "offboard": _offboard_active}


# ── 航線任務 (第 3 關 GCS) ────────────────────────────────────────────────
class Waypoint(BaseModel):
    lat: float
    lon: float
    alt: float | None = None  # 相對地面高度 (m);省略則用整條任務的預設高度


class MissionBody(BaseModel):
    waypoints: list[Waypoint]
    alt: float = 30.0    # 預設航點高度 (相對地面)
    speed: float = 5.0   # 巡航速度 (m/s)


def _make_item(lat: float, lon: float, alt: float, speed: float) -> MissionItem:
    """把一個航點包成 MissionItem;不需要的相機/雲台欄位全給 NaN。"""
    nan = float("nan")
    return MissionItem(
        lat, lon, alt, speed,
        True,                              # is_fly_through: 直接穿過不停留
        nan, nan,                          # gimbal pitch / yaw
        MissionItem.CameraAction.NONE,
        nan, nan, nan, nan, nan,           # loiter / photo interval / acceptance radius / yaw / photo distance
        MissionItem.VehicleAction.NONE,
    )


@app.post("/api/mission/upload")
async def api_mission_upload(body: MissionBody):
    if not body.waypoints:
        return {"ok": False, "error": "沒有航點"}
    items = [
        _make_item(w.lat, w.lon, w.alt if w.alt is not None else body.alt, body.speed)
        for w in body.waypoints
    ]
    await cmd(drone.mission.clear_mission())
    return {**await cmd(drone.mission.upload_mission(MissionPlan(items))), "count": len(items)}


@app.post("/api/mission/start")
async def api_mission_start():
    # 開始任務前要先 arm;PX4 會切到 MISSION 模式自動飛航點。
    with contextlib.suppress(Exception):
        await drone.action.arm()
    return await cmd(drone.mission.start_mission())


@app.post("/api/mission/pause")
async def api_mission_pause():
    return await cmd(drone.mission.pause_mission())


@app.post("/api/mission/clear")
async def api_mission_clear():
    return await cmd(drone.mission.clear_mission())
