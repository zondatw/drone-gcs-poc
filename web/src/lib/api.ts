import type { Waypoint } from './store'

// 呼叫後端 REST 指令 (走 vite proxy -> server.py)。每個指令都指定第 i 台 drone。
async function post(path: string, body?: unknown) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

const base = (i: number) => `/api/drone/${i}`

export const api = {
  arm: (i: number) => post(`${base(i)}/arm`),
  takeoff: (i: number, alt = 10) => post(`${base(i)}/takeoff`, { alt }),
  land: (i: number) => post(`${base(i)}/land`),
  rtl: (i: number) => post(`${base(i)}/rtl`),
  goto: (i: number, lat: number, lon: number, alt?: number) => post(`${base(i)}/goto`, { lat, lon, alt }),
  offboardStart: (i: number) => post(`${base(i)}/offboard/start`),
  offboardStop: (i: number) => post(`${base(i)}/offboard/stop`),

  missionUpload: (i: number, waypoints: Waypoint[], alt: number, speed: number) =>
    post(`${base(i)}/mission/upload`, { waypoints, alt, speed }),
  missionStart: (i: number) => post(`${base(i)}/mission/start`),
  missionPause: (i: number) => post(`${base(i)}/mission/pause`),
  missionClear: (i: number) => post(`${base(i)}/mission/clear`),

  // 群組指令:一次對全部 drone
  allArm: () => post('/api/all/arm'),
  allTakeoff: (alt = 10) => post('/api/all/takeoff', { alt }),
  allLand: () => post('/api/all/land'),
  allRtl: () => post('/api/all/rtl'),
}
