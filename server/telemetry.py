"""
第 1 關:連到「已經在跑」的 mavsdk_server(由 compose 先背景啟動),印出遙測。
mavsdk_server 已用 udpin://0.0.0.0:14540 接住 PX4,並在 50051 提供 gRPC。
這裡的 Python 只負責用 gRPC 連上去、讀資料。
"""

import asyncio
from mavsdk import System


async def run():
    # 連到「已經在跑」的 mavsdk_server,不要讓 Python 自己再啟一個。
    # 指定 mavsdk_server_address 後,connect() 不會再 spawn server。
    drone = System(mavsdk_server_address="localhost", port=50051)
    print(">>> 連線到 mavsdk_server (localhost:50051)...", flush=True)
    await drone.connect()

    print(">>> 等待 PX4 心跳...", flush=True)
    async for state in drone.core.connection_state():
        if state.is_connected:
            print(">>> 已連線到 PX4!", flush=True)
            break

    print(">>> 等待 GPS 定位...", flush=True)
    async for health in drone.telemetry.health():
        if health.is_global_position_ok and health.is_home_position_ok:
            print(">>> 定位完成,開始讀取遙測。\n", flush=True)
            break

    await asyncio.gather(
        print_position(drone),
        print_battery(drone),
        print_flight_mode(drone),
    )


async def print_position(drone):
    async for position in drone.telemetry.position():
        print(
            f"[位置] 緯度 {position.latitude_deg:.7f}  "
            f"經度 {position.longitude_deg:.7f}  "
            f"相對高度 {position.relative_altitude_m:.1f} m",
            flush=True,
        )


async def print_battery(drone):
    async for battery in drone.telemetry.battery():
        print(f"[電量] {battery.remaining_percent * 100:.0f}%", flush=True)


async def print_flight_mode(drone):
    async for flight_mode in drone.telemetry.flight_mode():
        print(f"[模式] {flight_mode}", flush=True)


if __name__ == "__main__":
    asyncio.run(run())