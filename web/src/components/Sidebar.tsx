import { useStore, type DroneClient } from '../lib/store'
import { api } from '../lib/api'
import { randomRoute } from '../lib/route'
import { droneColor } from './DroneViewer'
import { useKeyboardControl } from '../hooks/useKeyboardControl'

// 該台的中心點:有遙測座標就用它(地面時即起飛點),否則 fallback home(Zurich + i·0.0008)。
function centerOf(d: DroneClient | undefined, i: number): [number, number] {
  const t = d?.telemetry
  if (t?.lat != null && t?.lon != null) return [t.lat, t.lon]
  return [47.3977 + 0.0008 * i, 8.5456]
}

// 左側欄:多機 GCS 儀表板 — 選台 + (目前控制中那台的) 遙測 / 飛控 / 航線。
export function Sidebar() {
  const drones = useStore((s) => s.drones)
  const activeIndex = useStore((s) => s.activeIndex)
  const setActiveIndex = useStore((s) => s.setActiveIndex)
  const connected = useStore((s) => s.connected)
  const follow = useStore((s) => s.follow)
  const setFollow = useStore((s) => s.setFollow)

  const setMissionAlt = useStore((s) => s.setMissionAlt)
  const setMissionSpeed = useStore((s) => s.setMissionSpeed)
  const setOffboardActive = useStore((s) => s.setOffboardActive)
  const resetTrail = useStore((s) => s.resetTrail)
  const undoWaypoint = useStore((s) => s.undoWaypoint)
  const clearWaypoints = useStore((s) => s.clearWaypoints)
  const insertWaypoint = useStore((s) => s.insertWaypoint)
  const removeWaypoint = useStore((s) => s.removeWaypoint)
  const setWaypoints = useStore((s) => s.setWaypoints)

  useKeyboardControl()

  const active = drones[activeIndex]
  const t = active?.telemetry
  const waypoints = active?.waypoints ?? []
  const offboardActive = active?.offboardActive ?? false
  const missionAlt = active?.missionAlt ?? 30
  const missionSpeed = active?.missionSpeed ?? 5

  const insertAfter = (i: number) => {
    const a = waypoints[i]
    const b = waypoints[i + 1]
    insertWaypoint(i + 1, b
      ? { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 }
      : { lat: a.lat + 0.0005, lon: a.lon + 0.0005 })
  }

  const toggleOffboard = async () => {
    if (offboardActive) {
      await api.offboardStop(activeIndex)
      setOffboardActive(false)
    } else {
      const r = await api.offboardStart(activeIndex)
      if (r.ok) setOffboardActive(true)
      else alert('Offboard 啟動失敗: ' + r.error)
    }
  }

  const uploadMission = async () => {
    if (!waypoints.length) return alert('先在地圖上點幾個航點')
    const r = await api.missionUpload(activeIndex, waypoints, missionAlt, missionSpeed)
    if (!r.ok) alert('上傳失敗: ' + r.error)
  }
  // ▶ 開始任務:有航線才會 enable;一鍵 upload+start(跟「全部開始任務」一致)。
  const startMission = async () => {
    if (!waypoints.length) return
    await api.missionUpload(activeIndex, waypoints, missionAlt, missionSpeed)
    const r = await api.missionStart(activeIndex)
    if (!r.ok && !String(r.error).includes('TIMEOUT')) alert('開始任務失敗: ' + r.error)
  }

  // 🎲 亂數航線:幫 active 那台生一條。
  const randomActive = () => setWaypoints(activeIndex, randomRoute(...centerOf(active, activeIndex)))

  // 🎲 全部亂數航線:每台各生一條(繞自己的中心)。
  const randomAll = () => drones.forEach((d, i) => setWaypoints(i, randomRoute(...centerOf(d, i))))

  // ▶ 全部開始任務:每台有航點才上傳→開始(各台並行,單台內有序);回報哪幾台沒成功。
  const startAll = async () => {
    const targets = drones.map((d, i) => ({ d, i })).filter((x) => x.d.waypoints.length)
    if (!targets.length) return alert('沒有任何航線,先按「🎲 全部亂數航線」或在地圖上點航點')
    const results = await Promise.all(targets.map(async ({ d, i }) => {
      await api.missionUpload(i, d.waypoints, d.missionAlt, d.missionSpeed)
      return { i, r: await api.missionStart(i) }
    }))
    const failed = results.filter((x) => !x.r.ok).map((x) => `D${x.i + 1}`)
    if (failed.length) alert(`這些沒能開始: ${failed.join(', ')}(可再按一次)`)
  }

  // ‖ 全部暫停任務。
  const pauseAll = () => Promise.all(drones.map((_, i) => api.missionPause(i)))

  const batt = t?.battery_pct ?? null
  const battClass = batt == null ? '' : batt > 50 ? 'ok' : batt > 20 ? 'warn' : 'bad'
  const mode = t?.flight_mode?.replace('FlightMode.', '') ?? '—'
  const climb = t?.vd == null ? null : -t.vd
  const missionActive = t?.mission_total != null && t.mission_total > 0
  const missionAt = t?.mission_current == null || t.mission_current < 0 ? 0 : t.mission_current

  // ── 按鈕前置條件(用可靠的遙測;flight_mode 可靠,mission_total 不可靠不用)──
  const isAirborne = (d: DroneClient) => (d.telemetry.rel_alt ?? 0) > 1.5
  const isRunning = (d: DroneClient) => /MISSION|TAKEOFF/.test(d.telemetry.flight_mode ?? '')
  const conn = connected && !!t?.connected
  const armed = !!t?.armed
  const airborne = active ? isAirborne(active) : false
  const running = active ? isRunning(active) : false
  const hasRoute = waypoints.length > 0
  // 群組聚合
  const anyRoute = drones.some((d) => d.waypoints.length > 0)
  const anyAirborne = drones.some(isAirborne)
  const anyGround = drones.some((d) => !isAirborne(d))
  const anyRunning = drones.some(isRunning)

  return (
    <aside className="sidebar">
      <div className="brand">🛩 Drone GCS · {drones.length} 機</div>

      {/* ── 選台 ── */}
      <div className="fleet">
        {drones.length === 0 && <span className="tip">連線中…</span>}
        {drones.map((d, i) => (
          <button
            key={i}
            className={`drone-chip${i === activeIndex ? ' active' : ''}`}
            onClick={() => setActiveIndex(i)}
          >
            <span className="chip-dot" style={{ background: droneColor(i) }} />
            D{i + 1}
            <span className={`chip-batt ${d.telemetry.battery_pct != null && d.telemetry.battery_pct <= 20 ? 'bad' : ''}`}>
              {d.telemetry.battery_pct == null ? '—' : `${d.telemetry.battery_pct.toFixed(0)}%`}
            </span>
          </button>
        ))}
      </div>

      {/* ── 群組指令:一次對全部 ── */}
      <section className="card">
        <h3>群組指令 · 全部 {drones.length} 機</h3>
        <div className="btn-grid">
          <button onClick={() => api.allArm()} disabled={!connected}>全部 Arm</button>
          <button className="primary" onClick={() => api.allTakeoff()} disabled={!anyGround}
            title={!anyGround ? '都已在空中' : ''}>全部起飛</button>
          <button onClick={() => api.allLand()} disabled={!anyAirborne}
            title={!anyAirborne ? '都在地面' : ''}>全部降落</button>
          <button onClick={() => api.allRtl()} disabled={!anyAirborne}
            title={!anyAirborne ? '都在地面' : ''}>全部返航</button>
        </div>
      </section>

      {/* ── 群組任務:亂數航線 + 全部一起跑 ── */}
      <section className="card">
        <h3>群組任務 · 每台各飛各的</h3>
        <button className="wide" onClick={randomAll} disabled={!connected}>🎲 全部亂數航線</button>
        <div className="btn-grid" style={{ marginTop: 8 }}>
          <button className="primary" onClick={startAll} disabled={!anyRoute}
            title={!anyRoute ? '先產生航線(🎲 全部亂數航線)' : ''}>▶ 全部開始任務</button>
          <button onClick={pauseAll} disabled={!anyRunning}
            title={!anyRunning ? '沒有任務在執行' : ''}>‖ 全部暫停</button>
        </div>
      </section>

      {/* ── 連線 + 遙測 (active) ── */}
      <section className="card">
        <div className="conn">
          <span className={`dot ${connected && t?.connected ? 'ok' : 'bad'}`} />
          控制中:<b style={{ color: droneColor(activeIndex) }}>D{activeIndex + 1}</b>
          <span className="mode-pill">{mode}</span>
        </div>

        <div className="batt-row">
          <span>電量</span>
          <div className="batt-bar">
            <div className={`batt-fill ${battClass}`} style={{ width: `${batt ?? 0}%` }} />
          </div>
          <b>{batt == null ? '—' : `${batt.toFixed(0)}%`}</b>
        </div>

        <div className="gauges">
          <Gauge label="高度" value={fmt(t?.rel_alt, 1)} unit="m" />
          <Gauge label="地速" value={fmt(t?.ground_speed, 1)} unit="m/s" />
          <Gauge label="爬升" value={fmt(climb, 1)} unit="m/s" />
          <Gauge label="航向" value={fmt(t?.heading, 0)} unit="°" />
          <Gauge label="解鎖" value={t?.armed == null ? '—' : t.armed ? '是' : '否'} />
          <Gauge label="座標" value={t?.lat == null ? '—' : `${t.lat.toFixed(4)}, ${t.lon!.toFixed(4)}`} small />
        </div>
      </section>

      {/* ── 飛行控制 (active) ── */}
      <section className="card">
        <h3>飛行控制 · D{activeIndex + 1}</h3>
        <div className="btn-grid">
          <button onClick={() => api.arm(activeIndex)} disabled={!conn || armed}
            title={armed ? '已解鎖' : !conn ? '等待連線' : ''}>Arm 解鎖</button>
          <button onClick={() => api.takeoff(activeIndex)} disabled={!conn || airborne}
            title={airborne ? '已在空中' : !conn ? '等待連線' : ''}>起飛</button>
          <button onClick={() => api.land(activeIndex)} disabled={!conn || !airborne}
            title={!airborne ? '在地面,先起飛' : ''}>降落</button>
          <button onClick={() => api.rtl(activeIndex)} disabled={!conn || !airborne}
            title={!airborne ? '在地面,先起飛' : ''}>返航 RTL</button>
        </div>
        <button className={offboardActive ? 'wide active' : 'wide'} onClick={toggleOffboard} disabled={!conn}>
          {offboardActive ? '■ 停止手動操控' : '▶ 手動操控 (Offboard)'}
        </button>
        {offboardActive && (
          <div className="hint"><b>WASD</b> 前後左右 · <b>R/F</b> 升降 · <b>Q/E</b> 轉向</div>
        )}
        <label className="check">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          鏡頭跟隨控制中那台
        </label>
      </section>

      {/* ── 航線規劃 (active) ── */}
      <section className="card">
        <h3>航線規劃 · D{activeIndex + 1}</h3>
        <div className="tip">點地圖加航點 · 拖曳移動 · 右鍵刪除</div>

        <div className="field-row">
          <label>高度 (m)
            <input type="number" value={missionAlt} min={5} step={5}
              onChange={(e) => setMissionAlt(Number(e.target.value))} />
          </label>
          <label>速度 (m/s)
            <input type="number" value={missionSpeed} min={1} step={1}
              onChange={(e) => setMissionSpeed(Number(e.target.value))} />
          </label>
        </div>

        <button className="wide" onClick={randomActive} disabled={!conn}>🎲 亂數航線</button>

        <div className="wp-count">
          航點數:<b>{waypoints.length}</b>
          <span className="wp-actions">
            <button onClick={undoWaypoint} disabled={!waypoints.length}>↶ 復原</button>
            <button onClick={clearWaypoints} disabled={!waypoints.length}>清除航線</button>
          </span>
        </div>

        {waypoints.length > 0 && (
          <ul className="wp-list">
            {waypoints.map((w, i) => (
              <li key={i}>
                <span className="wp-no">{i + 1}</span>
                <span className="wp-xy">{w.lat.toFixed(5)}, {w.lon.toFixed(5)}</span>
                <button title="在此點後插入" onClick={() => insertAfter(i)}>＋</button>
                <button title="刪除此航點" onClick={() => removeWaypoint(i)}>✕</button>
              </li>
            ))}
          </ul>
        )}

        <div className="btn-grid">
          <button onClick={uploadMission} disabled={!hasRoute}
            title={!hasRoute ? '先規劃航線(🎲 或點地圖)' : ''}>上傳航線</button>
          <button className="primary" onClick={startMission} disabled={!hasRoute}
            title={!hasRoute ? '先規劃航線(🎲 或點地圖)' : ''}>▶ 開始任務</button>
          <button onClick={() => api.missionPause(activeIndex)} disabled={!running}
            title={!running ? '沒有任務在執行' : ''}>‖ 暫停</button>
          <button onClick={() => api.missionClear(activeIndex)} disabled={!hasRoute && !running}>清除任務</button>
        </div>

        {running && (
          <div className="mission-prog">
            ● 任務執行中{missionActive ? `:第 ${missionAt} / ${t!.mission_total} 航點` : ''}
          </div>
        )}
      </section>

      <button className="wide ghost" onClick={resetTrail}>清除 D{activeIndex + 1} 軌跡</button>
    </aside>
  )
}

function fmt(v: number | null | undefined, digits: number) {
  return v == null ? '—' : v.toFixed(digits)
}

function Gauge({ label, value, unit, small }: { label: string; value: string; unit?: string; small?: boolean }) {
  return (
    <div className={`gauge${small ? ' wide-gauge' : ''}`}>
      <span className="g-label">{label}</span>
      <span className="g-value">{value}{unit && <em>{unit}</em>}</span>
    </div>
  )
}
