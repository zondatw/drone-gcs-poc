import { describe, it, expect, beforeEach } from 'vitest'
import { useStore, type Telemetry } from './store'

// 把部分欄位疊上全 null 的底,組一個 Telemetry。
function tel(p: Partial<Telemetry>): Telemetry {
  return {
    id: null, lat: null, lon: null, abs_alt: null, rel_alt: null, ground_alt: null,
    heading: null, ground_speed: null, vd: null, vn: null, ve: null,
    battery_pct: null, flight_mode: null, armed: null,
    mission_current: null, mission_total: null, connected: null, stale_s: null, ...p,
  }
}

const s = () => useStore.getState()

beforeEach(() => {
  useStore.setState({ drones: [], activeIndex: 0, toasts: [], connected: false, follow: true, messages: [] })
})

describe('setTelemetry', () => {
  it('依 payload 建立每台 drone', () => {
    s().setTelemetry({ drones: [tel({ lat: 47, lon: 8 }), tel({ lat: 47.1, lon: 8.1 })] })
    expect(s().drones.length).toBe(2)
    expect(s().drones[0].telemetry.lat).toBe(47)
    expect(s().drones[1].telemetry.lon).toBe(8.1)
  })

  it('payload 帶 messages 時更新 messages,沒帶時保留', () => {
    s().setTelemetry({
      drones: [tel({ lat: 47, lon: 8 })],
      messages: [{ id: 1, drone: 0, sev: 'err', text: 'Arming denied', t: 1700000000 }],
    })
    expect(s().messages.length).toBe(1)
    expect(s().messages[0].sev).toBe('err')
    s().setTelemetry({ drones: [tel({ lat: 47.001, lon: 8 })] }) // 沒帶 messages
    expect(s().messages.length).toBe(1) // 保留
  })

  it('移動時累積軌跡、靜止時不重複加點', () => {
    s().setTelemetry({ drones: [tel({ lat: 47, lon: 8, rel_alt: 10 })] })
    expect(s().drones[0].trail.length).toBe(3) // 第一點 [lon,lat,h]
    s().setTelemetry({ drones: [tel({ lat: 47.001, lon: 8.001, rel_alt: 10 })] }) // 明顯移動
    expect(s().drones[0].trail.length).toBe(6)
    s().setTelemetry({ drones: [tel({ lat: 47.001, lon: 8.001, rel_alt: 10 })] }) // 原地
    expect(s().drones[0].trail.length).toBe(6)
  })
})

describe('航點操作(作用在 activeIndex)', () => {
  beforeEach(() => {
    s().setTelemetry({ drones: [tel({ lat: 47, lon: 8 }), tel({ lat: 47.1, lon: 8.1 })] })
  })

  it('addWaypoint 加到目前控制中那台', () => {
    s().addWaypoint({ lat: 47, lon: 8 })
    expect(s().drones[0].waypoints.length).toBe(1)
    s().setActiveIndex(1)
    s().addWaypoint({ lat: 47.1, lon: 8.1 })
    expect(s().drones[1].waypoints.length).toBe(1)
    expect(s().drones[0].waypoints.length).toBe(1) // 不影響別台
  })

  it('move / insert / remove / undo / clear', () => {
    s().addWaypoint({ lat: 1, lon: 1 })
    s().addWaypoint({ lat: 2, lon: 2 })
    s().moveWaypoint(0, { lat: 9, lon: 9 })
    expect(s().drones[0].waypoints[0]).toEqual({ lat: 9, lon: 9 })
    s().insertWaypoint(1, { lat: 5, lon: 5 })
    expect(s().drones[0].waypoints.map((w) => w.lat)).toEqual([9, 5, 2])
    s().removeWaypoint(1)
    expect(s().drones[0].waypoints.map((w) => w.lat)).toEqual([9, 2])
    s().undoWaypoint()
    expect(s().drones[0].waypoints.length).toBe(1)
    s().clearWaypoints()
    expect(s().drones[0].waypoints.length).toBe(0)
  })

  it('setWaypoints 寫到指定那台(不一定是 active)', () => {
    s().setActiveIndex(0)
    s().setWaypoints(1, [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }])
    expect(s().drones[1].waypoints.length).toBe(2)
    expect(s().drones[0].waypoints.length).toBe(0)
  })
})

describe('toasts', () => {
  it('push 遞增 id、dismiss 移除', () => {
    s().pushToast('甲', 'ok')
    s().pushToast('乙', 'err')
    expect(s().toasts.length).toBe(2)
    expect(s().toasts[1].id).toBeGreaterThan(s().toasts[0].id)
    expect(s().toasts[0].kind).toBe('ok')
    const id0 = s().toasts[0].id
    s().dismissToast(id0)
    expect(s().toasts.map((t) => t.id)).not.toContain(id0)
    expect(s().toasts.length).toBe(1)
  })
})
