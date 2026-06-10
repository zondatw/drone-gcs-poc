# drone PoC

PX4 SITL + MAVSDK telemetry PoC, running on Apple Silicon Mac with Docker Desktop.

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
        │  gRPC (localhost:50051, also exposed to host)
        ▼
    telemetry.py  (or: uv run python telemetry.py on Mac)
```

## Run

```sh
docker compose up
```

Telemetry output appears in the compose logs once PX4 acquires GPS lock (~30s).

## Run Python on the Mac host instead

Port 50051 (gRPC) is exposed, so you can skip the in-container Python and run locally:

```sh
docker compose up app   # just mavsdk + px4, no telemetry.py
uv run python telemetry.py
```

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
