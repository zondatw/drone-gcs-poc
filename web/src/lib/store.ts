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
}

const EMPTY: Telemetry = {
  lat: null, lon: null, abs_alt: null, rel_alt: null, ground_alt: null,
  heading: null, ground_speed: null, vd: null,
  battery_pct: null, flight_mode: null, armed: null,
}

const TRAIL_MAX = 3000 // 軌跡最多保留的點數
const TRAIL_MIN_MOVE = 0.5 // 移動超過 ~0.5m 才記一個新軌跡點 (粗略換算)

interface State {
  telemetry: Telemetry
  connected: boolean
  trail: number[] // 攤平的 [lon, lat, height, lon, lat, height, ...],給 Cesium 用
  target: [number, number] | null // 點地圖 goto 的目標 [lon, lat]
  offboardActive: boolean
  follow: boolean // 鏡頭是否跟隨無人機
  setTelemetry: (t: Telemetry) => void
  setConnected: (c: boolean) => void
  setTarget: (t: [number, number] | null) => void
  setOffboardActive: (v: boolean) => void
  setFollow: (v: boolean) => void
  resetTrail: () => void
}

export const useStore = create<State>((set) => ({
  telemetry: EMPTY,
  connected: false,
  trail: [],
  target: null,
  offboardActive: false,
  follow: true,
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
  setTarget: (target) => set({ target }),
  setOffboardActive: (offboardActive) => set({ offboardActive }),
  setFollow: (follow) => set({ follow }),
  resetTrail: () => set({ trail: [] }),
}))
