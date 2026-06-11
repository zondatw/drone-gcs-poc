// 呼叫後端 REST 指令 (走 vite proxy -> server.py)。
async function post(path: string, body?: unknown) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

export const api = {
  arm: () => post('/api/arm'),
  takeoff: (alt = 10) => post('/api/takeoff', { alt }),
  land: () => post('/api/land'),
  rtl: () => post('/api/rtl'),
  goto: (lat: number, lon: number, alt?: number) => post('/api/goto', { lat, lon, alt }),
  offboardStart: () => post('/api/offboard/start'),
  offboardStop: () => post('/api/offboard/stop'),
}
