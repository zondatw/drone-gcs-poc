"""
第 2~4 關:多機飛行控制 + 即時遙測 + 航線任務 Web 後端(小型 GCS)。

沿用第 1 關 (telemetry.py) 連 mavsdk_server 的做法,但這裡管理 **N 台** 無人機:
每台 = 一個 DroneAgent,連到自己的 mavsdk_server(gRPC localhost:5005{i}),各自一條 System。

對前端開:
  - WS  /ws/telemetry        : 推 {"drones":[每台的遙測快照…]}
  - WS  /ws/control          : 收 {drone:i, forward,…} → agents[i] offboard 速度
  - REST /api/drone/{i}/...   : arm/takeoff/land/rtl/goto/offboard/mission… 指定第 i 台
  - GET  /api/state           : {"drones":[…]} (驗證用)

台數由環境變數 DRONE_COUNT 決定(預設 3),對應 gRPC ports 50051、50052…
啟動: cd server && DRONE_COUNT=3 uv run uvicorn server:app --reload
"""

import asyncio
import contextlib
import json
import logging
import os

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from mavsdk import System
from mavsdk.action import ActionError
from mavsdk.mission import MissionItem, MissionPlan, MissionError
from mavsdk.offboard import OffboardError, VelocityBodyYawspeed

log = logging.getLogger("drone")
logging.basicConfig(level=logging.INFO, format="%(message)s")

DRONE_COUNT = int(os.environ.get("DRONE_COUNT", "3"))
BASE_GRPC_PORT = 50051  # drone i → 50051 + i
DEFAULT_TAKEOFF_ALT_M = 10.0


async def cmd(coro):
    """跑一個 mavsdk 動作,把 ActionError/MissionError 收成乾淨 JSON 而不是 500。

    PX4 SITL 指令快速連發時常其實有執行、只是 ACK 慢回 TIMEOUT;這裡一律回 {ok, error}。
    """
    try:
        await coro
        return {"ok": True}
    except (ActionError, MissionError) as e:
        return {"ok": False, "error": str(e)}


def _make_item(lat: float, lon: float, alt: float, speed: float) -> MissionItem:
    """把一個航點包成 MissionItem;不需要的相機/雲台欄位全給 NaN。"""
    nan = float("nan")
    return MissionItem(
        lat, lon, alt, speed,
        True,                              # is_fly_through
        nan, nan,                          # gimbal pitch / yaw
        MissionItem.CameraAction.NONE,
        nan, nan, nan, nan, nan,
        MissionItem.VehicleAction.NONE,
    )


class DroneAgent:
    """一台無人機:一條 System 連到自己的 mavsdk_server,維護自己的 latest 快照與指令。"""

    def __init__(self, index: int) -> None:
        self.index = index
        self.port = BASE_GRPC_PORT + index
        self.system = System(mavsdk_server_address="localhost", port=self.port)
        self.offboard_active = False
        self.latest: dict = {
            "id": index,
            "lat": None, "lon": None,
            "abs_alt": None, "rel_alt": None, "ground_alt": None,
            "heading": None, "ground_speed": None, "vd": None,
            "battery_pct": None, "flight_mode": None, "armed": None,
            "mission_current": None, "mission_total": None,
            "connected": False,
        }

    def snapshot(self) -> dict:
        return {**self.latest, "offboard": self.offboard_active}

    # ── 連線 + 遙測訂閱 ──────────────────────────────────────────────────
    async def connect_and_watch(self) -> None:
        tag = f"[drone {self.index}]"
        log.info(f">>> {tag} 連線到 mavsdk_server (localhost:{self.port})...")
        await self.system.connect()

        async for state in self.system.core.connection_state():
            if state.is_connected:
                log.info(f">>> {tag} 已連線到 PX4!")
                self.latest["connected"] = True
                break

        async for health in self.system.telemetry.health():
            if health.is_global_position_ok and health.is_home_position_ok:
                log.info(f">>> {tag} 定位完成,開始推播遙測。")
                break

        await asyncio.gather(
            self._watch_position(), self._watch_attitude(), self._watch_velocity(),
            self._watch_battery(), self._watch_flight_mode(), self._watch_armed(),
            self._watch_mission_progress(),
        )

    async def _watch_position(self) -> None:
        async for p in self.system.telemetry.position():
            self.latest["lat"] = p.latitude_deg
            self.latest["lon"] = p.longitude_deg
            self.latest["abs_alt"] = p.absolute_altitude_m
            self.latest["rel_alt"] = p.relative_altitude_m
            self.latest["ground_alt"] = p.absolute_altitude_m - p.relative_altitude_m

    async def _watch_attitude(self) -> None:
        async for a in self.system.telemetry.attitude_euler():
            self.latest["heading"] = a.yaw_deg

    async def _watch_velocity(self) -> None:
        async for v in self.system.telemetry.velocity_ned():
            self.latest["ground_speed"] = (v.north_m_s ** 2 + v.east_m_s ** 2) ** 0.5
            self.latest["vd"] = v.down_m_s

    async def _watch_battery(self) -> None:
        async for b in self.system.telemetry.battery():
            self.latest["battery_pct"] = b.remaining_percent  # 此版本已是 0~100

    async def _watch_flight_mode(self) -> None:
        async for m in self.system.telemetry.flight_mode():
            self.latest["flight_mode"] = str(m)

    async def _watch_armed(self) -> None:
        async for armed in self.system.telemetry.armed():
            self.latest["armed"] = armed

    async def _watch_mission_progress(self) -> None:
        async for mp in self.system.telemetry.mission_progress():
            self.latest["mission_current"] = mp.current
            self.latest["mission_total"] = mp.total

    # ── 動作 ────────────────────────────────────────────────────────────
    async def arm(self):
        return await cmd(self.system.action.arm())

    async def takeoff(self, alt: float):
        await cmd(self.system.action.set_takeoff_altitude(alt))
        await cmd(self.system.action.arm())
        return {**await cmd(self.system.action.takeoff()), "alt": alt}

    async def land(self):
        return await cmd(self.system.action.land())

    async def rtl(self):
        return await cmd(self.system.action.return_to_launch())

    async def goto(self, lat: float, lon: float, alt: float | None):
        if alt is not None and self.latest["ground_alt"] is not None:
            abs_alt = self.latest["ground_alt"] + alt
        else:
            abs_alt = self.latest["abs_alt"]
        if abs_alt is None:
            return {"ok": False, "error": "尚未取得高度遙測"}
        return {
            **await cmd(self.system.action.goto_location(lat, lon, abs_alt, float("nan"))),
            "abs_alt": abs_alt,
        }

    async def offboard_start(self):
        with contextlib.suppress(Exception):
            await self.system.action.arm()
        await self.system.offboard.set_velocity_body(VelocityBodyYawspeed(0, 0, 0, 0))
        try:
            await self.system.offboard.start()
        except OffboardError as e:
            return {"ok": False, "error": str(e)}
        self.offboard_active = True
        return {"ok": True}

    async def offboard_stop(self):
        self.offboard_active = False
        with contextlib.suppress(OffboardError):
            await self.system.offboard.stop()
        return {"ok": True}

    async def set_velocity(self, forward: float, right: float, down: float, yawspeed: float):
        if not self.offboard_active:
            return
        await self.system.offboard.set_velocity_body(
            VelocityBodyYawspeed(forward, right, down, yawspeed)
        )

    async def mission_upload(self, waypoints: list, alt: float, speed: float):
        if not waypoints:
            return {"ok": False, "error": "沒有航點"}
        items = [
            _make_item(w.lat, w.lon, w.alt if w.alt is not None else alt, speed)
            for w in waypoints
        ]
        await cmd(self.system.mission.clear_mission())
        return {**await cmd(self.system.mission.upload_mission(MissionPlan(items))),
                "count": len(items)}

    async def mission_start(self):
        with contextlib.suppress(Exception):
            await self.system.action.arm()
        return await cmd(self.system.mission.start_mission())

    async def mission_pause(self):
        return await cmd(self.system.mission.pause_mission())

    async def mission_clear(self):
        return await cmd(self.system.mission.clear_mission())


# ── 全域:N 個 agent + 訂閱者 ─────────────────────────────────────────────
agents: list[DroneAgent] = [DroneAgent(i) for i in range(DRONE_COUNT)]
subscribers: set[asyncio.Queue] = set()


def all_snapshot() -> str:
    return json.dumps({"drones": [a.snapshot() for a in agents]})


def broadcast() -> None:
    payload = all_snapshot()
    for q in subscribers:
        if q.full():
            with contextlib.suppress(asyncio.QueueEmpty):
                q.get_nowait()
        q.put_nowait(payload)


async def _push_loop() -> None:
    while True:
        broadcast()
        await asyncio.sleep(0.1)


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI):
    log.info(f">>> 啟動 {DRONE_COUNT} 台無人機 (gRPC ports {BASE_GRPC_PORT}..{BASE_GRPC_PORT + DRONE_COUNT - 1})")
    # 每台獨立並行連線/訂閱(某台還沒 GPS 不會 block 其它台),外加一條推播迴圈。
    tasks = [asyncio.create_task(a.connect_and_watch()) for a in agents]
    tasks.append(asyncio.create_task(_push_loop()))
    try:
        yield
    finally:
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


app = FastAPI(title="multi-drone GCS", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_agent(i: int) -> DroneAgent | None:
    return agents[i] if 0 <= i < len(agents) else None


# ── 遙測 WebSocket ────────────────────────────────────────────────────────
@app.websocket("/ws/telemetry")
async def ws_telemetry(ws: WebSocket) -> None:
    await ws.accept()
    q: asyncio.Queue = asyncio.Queue(maxsize=4)
    subscribers.add(q)
    try:
        await ws.send_text(all_snapshot())
        while True:
            await ws.send_text(await q.get())
    except WebSocketDisconnect:
        pass
    finally:
        subscribers.discard(q)


# ── 控制 WebSocket:{drone:i, forward,right,down,yawspeed} ─────────────────
@app.websocket("/ws/control")
async def ws_control(ws: WebSocket) -> None:
    await ws.accept()
    try:
        while True:
            data = json.loads(await ws.receive_text())
            agent = get_agent(int(data.get("drone", 0)))
            if agent is None:
                continue
            await agent.set_velocity(
                float(data.get("forward", 0.0)),
                float(data.get("right", 0.0)),
                float(data.get("down", 0.0)),
                float(data.get("yawspeed", 0.0)),
            )
    except WebSocketDisconnect:
        pass


# ── REST:每個指令都帶 drone 索引 ─────────────────────────────────────────
class GotoBody(BaseModel):
    lat: float
    lon: float
    alt: float | None = None


class TakeoffBody(BaseModel):
    alt: float = DEFAULT_TAKEOFF_ALT_M


class Waypoint(BaseModel):
    lat: float
    lon: float
    alt: float | None = None


class MissionBody(BaseModel):
    waypoints: list[Waypoint]
    alt: float = 30.0
    speed: float = 5.0


NOT_FOUND = {"ok": False, "error": "drone 索引超出範圍"}


@app.post("/api/drone/{i}/arm")
async def api_arm(i: int):
    a = get_agent(i)
    return await a.arm() if a else NOT_FOUND


@app.post("/api/drone/{i}/takeoff")
async def api_takeoff(i: int, body: TakeoffBody):
    a = get_agent(i)
    return await a.takeoff(body.alt) if a else NOT_FOUND


@app.post("/api/drone/{i}/land")
async def api_land(i: int):
    a = get_agent(i)
    return await a.land() if a else NOT_FOUND


@app.post("/api/drone/{i}/rtl")
async def api_rtl(i: int):
    a = get_agent(i)
    return await a.rtl() if a else NOT_FOUND


@app.post("/api/drone/{i}/goto")
async def api_goto(i: int, body: GotoBody):
    a = get_agent(i)
    return await a.goto(body.lat, body.lon, body.alt) if a else NOT_FOUND


@app.post("/api/drone/{i}/offboard/start")
async def api_offboard_start(i: int):
    a = get_agent(i)
    return await a.offboard_start() if a else NOT_FOUND


@app.post("/api/drone/{i}/offboard/stop")
async def api_offboard_stop(i: int):
    a = get_agent(i)
    return await a.offboard_stop() if a else NOT_FOUND


@app.post("/api/drone/{i}/mission/upload")
async def api_mission_upload(i: int, body: MissionBody):
    a = get_agent(i)
    return await a.mission_upload(body.waypoints, body.alt, body.speed) if a else NOT_FOUND


@app.post("/api/drone/{i}/mission/start")
async def api_mission_start(i: int):
    a = get_agent(i)
    return await a.mission_start() if a else NOT_FOUND


@app.post("/api/drone/{i}/mission/pause")
async def api_mission_pause(i: int):
    a = get_agent(i)
    return await a.mission_pause() if a else NOT_FOUND


@app.post("/api/drone/{i}/mission/clear")
async def api_mission_clear(i: int):
    a = get_agent(i)
    return await a.mission_clear() if a else NOT_FOUND


# ── 群組指令:一次對全部 drone 下令(並行)─────────────────────────────────
async def _fanout(action) -> dict:
    results = await asyncio.gather(
        *(action(a) for a in agents), return_exceptions=True
    )
    return {"results": [
        r if not isinstance(r, Exception) else {"ok": False, "error": str(r)}
        for r in results
    ]}


@app.post("/api/all/arm")
async def api_all_arm():
    return await _fanout(lambda a: a.arm())


@app.post("/api/all/takeoff")
async def api_all_takeoff(body: TakeoffBody):
    return await _fanout(lambda a: a.takeoff(body.alt))


@app.post("/api/all/land")
async def api_all_land():
    return await _fanout(lambda a: a.land())


@app.post("/api/all/rtl")
async def api_all_rtl():
    return await _fanout(lambda a: a.rtl())


@app.get("/api/state")
async def api_state():
    return {"drones": [a.snapshot() for a in agents]}
