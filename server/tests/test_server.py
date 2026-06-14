"""server.py 單元 / 端點測試。

策略:mavsdk 的 System 只在 .connect() 才連線,建構子不連線,所以可以安全 import server
(會建好 N 個 DroneAgent),再把要測的 agent 的 `system` / 方法換成 mock,不碰真實無人機。
"""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient
from mavsdk.action import ActionError
from mavsdk.mission import MissionError, MissionItem

import server


def _action_error(code="TIMEOUT", text="Timeout"):
    return ActionError(SimpleNamespace(result=code, result_str=text), "arm()")


def _mission_error(code="BUSY", text="Busy"):
    return MissionError(SimpleNamespace(result=code, result_str=text), "upload()")


def make_agent(i=0):
    """一台 system 全 mock 的 DroneAgent。"""
    a = server.DroneAgent(i)
    a.system = MagicMock()
    return a


# ── cmd():把 mavsdk 例外收成 {ok,error} ──────────────────────────────────
async def test_cmd_ok():
    async def coro():
        return "done"
    assert await server.cmd(coro()) == {"ok": True}


async def test_cmd_action_error():
    async def coro():
        raise _action_error()
    r = await server.cmd(coro())
    assert r["ok"] is False and "TIMEOUT" in r["error"]


async def test_cmd_mission_error():
    async def coro():
        raise _mission_error()
    r = await server.cmd(coro())
    assert r["ok"] is False and "BUSY" in r["error"]


# ── _make_item():航點 → MissionItem ─────────────────────────────────────
def test_make_item():
    it = server._make_item(47.1, 8.2, 30.0, 5.0)
    assert isinstance(it, MissionItem)
    assert it.latitude_deg == 47.1 and it.longitude_deg == 8.2
    assert it.relative_altitude_m == 30.0 and it.speed_m_s == 5.0
    assert it.is_fly_through is True
    assert it.camera_action == MissionItem.CameraAction.NONE
    assert it.vehicle_action == MissionItem.VehicleAction.NONE
    assert it.gimbal_pitch_deg != it.gimbal_pitch_deg  # NaN


# ── get_agent() 邊界 ─────────────────────────────────────────────────────
def test_get_agent_bounds():
    assert server.get_agent(0) is server.agents[0]
    assert server.get_agent(-1) is None
    assert server.get_agent(len(server.agents)) is None


# ── snapshot 形狀 ────────────────────────────────────────────────────────
def test_snapshot_shape():
    a = make_agent(2)
    snap = a.snapshot()
    assert snap["id"] == 2
    assert snap["offboard"] is False
    for k in ("lat", "lon", "rel_alt", "flight_mode", "armed", "connected", "stale_s"):
        assert k in snap


# ── 失聯偵測:stale_s + _watch_connection ─────────────────────────────────
def test_stale_s_none_until_touch():
    a = make_agent()
    assert a.snapshot()["stale_s"] is None
    a._touch()
    s = a.snapshot()["stale_s"]
    assert s is not None and 0 <= s < 1


async def test_watch_connection_updates_connected():
    a = make_agent()
    states = [True, False, True]

    async def gen():
        for v in states:
            yield SimpleNamespace(is_connected=v)
    a.system.core.connection_state = lambda: gen()

    await a._watch_connection()  # 跑到串流結束
    assert a.latest["connected"] is True  # 反映最後一個狀態


# ── goto():相對高度 → AMSL ──────────────────────────────────────────────
async def test_goto_uses_ground_alt():
    a = make_agent()
    a.system.action.goto_location = AsyncMock()
    a.latest["ground_alt"] = 500.0
    a.latest["abs_alt"] = 530.0
    r = await a.goto(47.0, 8.0, 25.0)  # 相對 25m → 500+25
    assert r["ok"] is True and r["abs_alt"] == 525.0
    args = a.system.action.goto_location.call_args.args
    assert args[0] == 47.0 and args[1] == 8.0 and args[2] == 525.0


async def test_goto_keeps_abs_alt_when_no_alt():
    a = make_agent()
    a.system.action.goto_location = AsyncMock()
    a.latest["ground_alt"] = 500.0
    a.latest["abs_alt"] = 540.0
    r = await a.goto(47.0, 8.0, None)
    assert r["abs_alt"] == 540.0


async def test_goto_no_telemetry_errors():
    a = make_agent()
    a.latest["abs_alt"] = None
    r = await a.goto(47.0, 8.0, None)
    assert r["ok"] is False and "高度" in r["error"]


# ── mission_upload():空 / 重試 ──────────────────────────────────────────
async def test_mission_upload_empty():
    a = make_agent()
    r = await a.mission_upload([], 30, 5)
    assert r["ok"] is False


async def test_mission_upload_calls_clear_then_upload():
    a = make_agent()
    a.system.mission.clear_mission = AsyncMock()
    a.system.mission.upload_mission = AsyncMock()
    wps = [SimpleNamespace(lat=47.0, lon=8.0, alt=None),
           SimpleNamespace(lat=47.1, lon=8.1, alt=None)]
    r = await a.mission_upload(wps, 30, 5)
    assert r["ok"] is True and r["count"] == 2
    a.system.mission.clear_mission.assert_awaited_once()
    a.system.mission.upload_mission.assert_awaited_once()


async def test_mission_upload_retries_on_failure(monkeypatch):
    monkeypatch.setattr(server.asyncio, "sleep", AsyncMock())
    a = make_agent()
    a.system.mission.clear_mission = AsyncMock()
    # 前兩次 upload 失敗(timeout),第三次成功
    a.system.mission.upload_mission = AsyncMock(side_effect=[_mission_error(), _mission_error(), None])
    wps = [SimpleNamespace(lat=47.0, lon=8.0, alt=None)]
    r = await a.mission_upload(wps, 30, 5)
    assert r["ok"] is True
    assert a.system.mission.upload_mission.await_count == 3


# ── mission_start():arm 重試 + 用 flight_mode 驗證 ──────────────────────
async def test_mission_start_success_when_mission(monkeypatch):
    monkeypatch.setattr(server.asyncio, "sleep", AsyncMock())
    a = make_agent()

    async def arm():
        a.latest["armed"] = True
    a.system.action.arm = AsyncMock(side_effect=arm)

    async def start():
        a.latest["flight_mode"] = "FlightMode.MISSION"
    a.system.mission.start_mission = AsyncMock(side_effect=start)

    r = await a.mission_start()
    assert r == {"ok": True}


async def test_mission_start_accepts_takeoff(monkeypatch):
    monkeypatch.setattr(server.asyncio, "sleep", AsyncMock())
    a = make_agent()
    a.latest["armed"] = True
    a.system.action.arm = AsyncMock()

    async def start():
        a.latest["flight_mode"] = "FlightMode.TAKEOFF"  # 地面起飛階段也算啟動
    a.system.mission.start_mission = AsyncMock(side_effect=start)

    r = await a.mission_start()
    assert r == {"ok": True}


async def test_mission_start_fails_if_never_armed(monkeypatch):
    monkeypatch.setattr(server.asyncio, "sleep", AsyncMock())
    a = make_agent()
    a.latest["armed"] = False  # arm 一直沒成功(預檢失敗)
    a.system.action.arm = AsyncMock()
    a.system.mission.start_mission = AsyncMock()

    r = await a.mission_start()
    assert r["ok"] is False and "解鎖" in r["error"]
    assert a.system.mission.start_mission.await_count == 0  # 沒 arm 不會 start


# ── REST 端點(TestClient,不跑 lifespan;mock agent 方法)────────────────
@pytest.fixture
def client():
    return TestClient(server.app)


def test_endpoint_routes_to_agent(client):
    server.agents[0].arm = AsyncMock(return_value={"ok": True, "tag": "a0"})
    r = client.post("/api/drone/0/arm")
    assert r.status_code == 200 and r.json()["tag"] == "a0"


def test_endpoint_out_of_range(client):
    r = client.post(f"/api/drone/{len(server.agents)}/arm")
    assert r.json() == server.NOT_FOUND


def test_state_endpoint_shape(client):
    r = client.get("/api/state")
    body = r.json()
    assert "drones" in body and len(body["drones"]) == len(server.agents)
    assert body["drones"][0]["id"] == 0


def test_all_arm_fans_out(client):
    for ag in server.agents:
        ag.arm = AsyncMock(return_value={"ok": True})
    r = client.post("/api/all/arm")
    results = r.json()["results"]
    assert len(results) == len(server.agents)
    assert all(x["ok"] for x in results)


def test_takeoff_passes_alt(client):
    server.agents[1].takeoff = AsyncMock(return_value={"ok": True})
    client.post("/api/drone/1/takeoff", json={"alt": 42})
    server.agents[1].takeoff.assert_awaited_once_with(42)
