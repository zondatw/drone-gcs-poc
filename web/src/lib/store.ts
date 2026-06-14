import { create } from 'zustand'

// 後端 /ws/telemetry 推來的單台遙測快照。
export interface Telemetry {
  id: number | null
  lat: number | null
  lon: number | null
  abs_alt: number | null
  rel_alt: number | null
  ground_alt: number | null
  heading: number | null
  ground_speed: number | null
  vd: number | null
  vn: number | null
  ve: number | null
  battery_pct: number | null
  flight_mode: string | null
  armed: boolean | null
  mission_current: number | null
  mission_total: number | null
  connected: boolean | null
  stale_s: number | null // 距上次收到遙測幾秒(失聯/新鮮度判斷)
}

const EMPTY: Telemetry = {
  id: null, lat: null, lon: null, abs_alt: null, rel_alt: null, ground_alt: null,
  heading: null, ground_speed: null, vd: null, vn: null, ve: null,
  battery_pct: null, flight_mode: null, armed: null,
  mission_current: null, mission_total: null, connected: null, stale_s: null,
}

export interface Waypoint {
  lat: number
  lon: number
}

// 指令送出回饋用的 toast。
export type ToastKind = 'ok' | 'warn' | 'err'
export interface Toast {
  id: number
  text: string
  kind: ToastKind
}
let toastSeq = 0

// 每台無人機在前端的狀態(遙測 + 自己的軌跡/航線/任務設定)。
export interface DroneClient {
  telemetry: Telemetry
  trail: number[] // 攤平的 [lon, lat, height, ...]
  waypoints: Waypoint[]
  missionAlt: number
  missionSpeed: number
  offboardActive: boolean
}

function makeDrone(): DroneClient {
  return { telemetry: EMPTY, trail: [], waypoints: [], missionAlt: 30, missionSpeed: 5, offboardActive: false }
}

const TRAIL_MAX = 3000
const TRAIL_MIN_MOVE = 0.5

interface State {
  drones: DroneClient[]
  activeIndex: number // 目前控制中的那台
  connected: boolean // 遙測 WS 是否連上
  follow: boolean
  toasts: Toast[] // 指令送出回饋

  setTelemetry: (payload: { drones: Telemetry[] }) => void
  setConnected: (c: boolean) => void
  setActiveIndex: (i: number) => void
  setFollow: (v: boolean) => void
  pushToast: (text: string, kind: ToastKind) => void
  dismissToast: (id: number) => void

  setWaypoints: (i: number, waypoints: Waypoint[]) => void // 覆寫指定第 i 台(群組亂數用)

  // 以下都作用在 activeIndex 那台:
  resetTrail: () => void
  addWaypoint: (w: Waypoint) => void
  moveWaypoint: (i: number, w: Waypoint) => void
  insertWaypoint: (i: number, w: Waypoint) => void
  removeWaypoint: (i: number) => void
  undoWaypoint: () => void
  clearWaypoints: () => void
  setMissionAlt: (v: number) => void
  setMissionSpeed: (v: number) => void
  setOffboardActive: (v: boolean) => void
}

// 只改 activeIndex 那台的小工具。
function updateActive(s: State, fn: (d: DroneClient) => DroneClient): Partial<State> {
  return { drones: s.drones.map((d, i) => (i === s.activeIndex ? fn(d) : d)) }
}

export const useStore = create<State>((set) => ({
  drones: [],
  activeIndex: 0,
  connected: false,
  follow: true,
  toasts: [],

  pushToast: (text, kind) =>
    set((s) => ({ toasts: [...s.toasts, { id: ++toastSeq, text, kind }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setTelemetry: ({ drones: ts }) =>
    set((s) => ({
      drones: ts.map((t, i) => {
        const prev = s.drones[i] ?? makeDrone()
        const trail = prev.trail
        if (t.lat != null && t.lon != null) {
          const n = trail.length
          const dLat = n ? Math.abs(t.lat - trail[n - 2]) : 1
          const dLon = n ? Math.abs(t.lon - trail[n - 3]) : 1
          if (!n || dLat > TRAIL_MIN_MOVE * 1e-5 || dLon > TRAIL_MIN_MOVE * 1e-5) {
            trail.push(t.lon, t.lat, t.rel_alt ?? 0)
            if (trail.length > TRAIL_MAX * 3) trail.splice(0, 3)
          }
        }
        return { ...prev, telemetry: t, trail: [...trail] }
      }),
    })),
  setConnected: (connected) => set({ connected }),
  setActiveIndex: (activeIndex) => set({ activeIndex }),
  setFollow: (follow) => set({ follow }),

  setWaypoints: (i, waypoints) =>
    set((s) => ({ drones: s.drones.map((d, j) => (j === i ? { ...d, waypoints } : d)) })),
  resetTrail: () => set((s) => updateActive(s, (d) => ({ ...d, trail: [] }))),
  addWaypoint: (w) => set((s) => updateActive(s, (d) => ({ ...d, waypoints: [...d.waypoints, w] }))),
  moveWaypoint: (i, w) =>
    set((s) => updateActive(s, (d) => ({ ...d, waypoints: d.waypoints.map((o, j) => (j === i ? w : o)) }))),
  insertWaypoint: (i, w) =>
    set((s) => updateActive(s, (d) => {
      const next = d.waypoints.slice()
      next.splice(i, 0, w)
      return { ...d, waypoints: next }
    })),
  removeWaypoint: (i) =>
    set((s) => updateActive(s, (d) => ({ ...d, waypoints: d.waypoints.filter((_, j) => j !== i) }))),
  undoWaypoint: () => set((s) => updateActive(s, (d) => ({ ...d, waypoints: d.waypoints.slice(0, -1) }))),
  clearWaypoints: () => set((s) => updateActive(s, (d) => ({ ...d, waypoints: [] }))),
  setMissionAlt: (missionAlt) => set((s) => updateActive(s, (d) => ({ ...d, missionAlt }))),
  setMissionSpeed: (missionSpeed) => set((s) => updateActive(s, (d) => ({ ...d, missionSpeed }))),
  setOffboardActive: (offboardActive) => set((s) => updateActive(s, (d) => ({ ...d, offboardActive }))),
}))
