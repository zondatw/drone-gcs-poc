import { create } from 'zustand'

// 後端 /ws/telemetry 推來的遙測快照。
export interface Telemetry {
  lat: number | null
  lon: number | null
  abs_alt: number | null
  rel_alt: number | null
  ground_alt: number | null
  heading: number | null
  ground_speed: number | null
  vd: number | null
  battery_pct: number | null
  flight_mode: string | null
  armed: boolean | null
  mission_current: number | null
  mission_total: number | null
}

const EMPTY: Telemetry = {
  lat: null, lon: null, abs_alt: null, rel_alt: null, ground_alt: null,
  heading: null, ground_speed: null, vd: null,
  battery_pct: null, flight_mode: null, armed: null,
  mission_current: null, mission_total: null,
}

// 規劃中的航點 (相對地面高度 alt 由整條任務的預設高度決定,存經緯度即可)。
export interface Waypoint {
  lat: number
  lon: number
}

const TRAIL_MAX = 3000 // 軌跡最多保留的點數
const TRAIL_MIN_MOVE = 0.5 // 移動超過 ~0.5m 才記一個新軌跡點 (粗略換算)

interface State {
  telemetry: Telemetry
  connected: boolean
  trail: number[] // 攤平的 [lon, lat, height, ...] 飛行軌跡,給 Cesium 用
  offboardActive: boolean
  follow: boolean // 鏡頭是否跟隨無人機

  // 航線規劃 (第 3 關 GCS)
  waypoints: Waypoint[]
  missionAlt: number // 航點高度 (相對地面 m)
  missionSpeed: number // 巡航速度 (m/s)

  setTelemetry: (t: Telemetry) => void
  setConnected: (c: boolean) => void
  setOffboardActive: (v: boolean) => void
  setFollow: (v: boolean) => void
  resetTrail: () => void
  addWaypoint: (w: Waypoint) => void
  undoWaypoint: () => void
  clearWaypoints: () => void
  setMissionAlt: (v: number) => void
  setMissionSpeed: (v: number) => void
}

export const useStore = create<State>((set) => ({
  telemetry: EMPTY,
  connected: false,
  trail: [],
  offboardActive: false,
  follow: true,
  waypoints: [],
  missionAlt: 30,
  missionSpeed: 5,

  setTelemetry: (t) =>
    set((s) => {
      const trail = s.trail
      if (t.lat != null && t.lon != null) {
        const n = trail.length
        const dLat = n ? Math.abs(t.lat - trail[n - 2]) : 1
        const dLon = n ? Math.abs(t.lon - trail[n - 3]) : 1
        // ~1e-5 度 ≈ 1m;只有明顯移動才加點,避免靜止時塞爆。
        if (!n || dLat > TRAIL_MIN_MOVE * 1e-5 || dLon > TRAIL_MIN_MOVE * 1e-5) {
          trail.push(t.lon, t.lat, t.rel_alt ?? 0)
          if (trail.length > TRAIL_MAX * 3) trail.splice(0, 3)
        }
      }
      return { telemetry: t, trail: [...trail] }
    }),
  setConnected: (c) => set({ connected: c }),
  setOffboardActive: (offboardActive) => set({ offboardActive }),
  setFollow: (follow) => set({ follow }),
  resetTrail: () => set({ trail: [] }),
  addWaypoint: (w) => set((s) => ({ waypoints: [...s.waypoints, w] })),
  undoWaypoint: () => set((s) => ({ waypoints: s.waypoints.slice(0, -1) })),
  clearWaypoints: () => set({ waypoints: [] }),
  setMissionAlt: (missionAlt) => set({ missionAlt }),
  setMissionSpeed: (missionSpeed) => set({ missionSpeed }),
}))
