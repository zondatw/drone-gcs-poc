import { useStore } from '../lib/store'
import { api } from '../lib/api'
import { useKeyboardControl } from '../hooks/useKeyboardControl'

// 左側欄:小型 GCS 儀表板 — 連線/遙測 + 飛行控制 + 航線規劃。
export function Sidebar() {
  const t = useStore((s) => s.telemetry)
  const connected = useStore((s) => s.connected)
  const offboardActive = useStore((s) => s.offboardActive)
  const setOffboardActive = useStore((s) => s.setOffboardActive)
  const follow = useStore((s) => s.follow)
  const setFollow = useStore((s) => s.setFollow)
  const resetTrail = useStore((s) => s.resetTrail)

  const waypoints = useStore((s) => s.waypoints)
  const missionAlt = useStore((s) => s.missionAlt)
  const missionSpeed = useStore((s) => s.missionSpeed)
  const setMissionAlt = useStore((s) => s.setMissionAlt)
  const setMissionSpeed = useStore((s) => s.setMissionSpeed)
  const undoWaypoint = useStore((s) => s.undoWaypoint)
  const clearWaypoints = useStore((s) => s.clearWaypoints)

  useKeyboardControl() // 掛鍵盤監聽 (只在 offboardActive 時真的送)

  const toggleOffboard = async () => {
    if (offboardActive) {
      await api.offboardStop()
      setOffboardActive(false)
    } else {
      const r = await api.offboardStart()
      if (r.ok) setOffboardActive(true)
      else alert('Offboard 啟動失敗: ' + r.error)
    }
  }

  const uploadMission = async () => {
    if (!waypoints.length) return alert('先在地圖上點幾個航點')
    const r = await api.missionUpload(waypoints, missionAlt, missionSpeed)
    if (!r.ok) alert('上傳失敗: ' + r.error)
  }
  const startMission = async () => {
    const r = await api.missionStart()
    // PX4 SITL 常回 TIMEOUT 但其實有開始(進度會在儀表板更新),所以只在「非 timeout」時才示警。
    if (!r.ok && !String(r.error).includes('TIMEOUT')) alert('開始任務失敗: ' + r.error)
  }

  const batt = t.battery_pct
  const battClass = batt == null ? '' : batt > 50 ? 'ok' : batt > 20 ? 'warn' : 'bad'
  const mode = t.flight_mode?.replace('FlightMode.', '') ?? '—'
  const climb = t.vd == null ? null : -t.vd
  const missionActive = t.mission_total != null && t.mission_total > 0
  const missionAt = t.mission_current == null || t.mission_current < 0 ? 0 : t.mission_current

  return (
    <aside className="sidebar">
      <div className="brand">🛩 Drone GCS</div>

      {/* ── 連線 + 遙測儀表板 ── */}
      <section className="card">
        <div className="conn">
          <span className={`dot ${connected ? 'ok' : 'bad'}`} />
          {connected ? '已連線' : '連線中…'}
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
          <Gauge label="高度" value={fmt(t.rel_alt, 1)} unit="m" />
          <Gauge label="地速" value={fmt(t.ground_speed, 1)} unit="m/s" />
          <Gauge label="爬升" value={fmt(climb, 1)} unit="m/s" />
          <Gauge label="航向" value={fmt(t.heading, 0)} unit="°" />
          <Gauge label="解鎖" value={t.armed == null ? '—' : t.armed ? '是' : '否'} />
          <Gauge label="座標" value={t.lat == null ? '—' : `${t.lat.toFixed(4)}, ${t.lon!.toFixed(4)}`} small />
        </div>
      </section>

      {/* ── 飛行控制 ── */}
      <section className="card">
        <h3>飛行控制</h3>
        <div className="btn-grid">
          <button onClick={() => api.arm()}>Arm 解鎖</button>
          <button onClick={() => api.takeoff()}>起飛</button>
          <button onClick={() => api.land()}>降落</button>
          <button onClick={() => api.rtl()}>返航 RTL</button>
        </div>
        <button className={offboardActive ? 'wide active' : 'wide'} onClick={toggleOffboard}>
          {offboardActive ? '■ 停止手動操控' : '▶ 手動操控 (Offboard)'}
        </button>
        {offboardActive && (
          <div className="hint"><b>WASD</b> 前後左右 · <b>R/F</b> 升降 · <b>Q/E</b> 轉向</div>
        )}
        <label className="check">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          鏡頭跟隨
        </label>
      </section>

      {/* ── 航線規劃 (GCS) ── */}
      <section className="card">
        <h3>航線規劃</h3>
        <div className="tip">在地圖上點選 → 加入航點</div>

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

        <div className="wp-count">
          航點數:<b>{waypoints.length}</b>
          <span className="wp-actions">
            <button onClick={undoWaypoint} disabled={!waypoints.length}>↶ 復原</button>
            <button onClick={clearWaypoints} disabled={!waypoints.length}>清除航線</button>
          </span>
        </div>

        <div className="btn-grid">
          <button onClick={uploadMission} disabled={!waypoints.length}>上傳航線</button>
          <button className="primary" onClick={startMission}>▶ 開始任務</button>
          <button onClick={() => api.missionPause()}>‖ 暫停</button>
          <button onClick={() => api.missionClear()}>清除任務</button>
        </div>

        {missionActive && (
          <div className="mission-prog">
            任務進度:第 <b>{missionAt}</b> / {t.mission_total} 航點
          </div>
        )}
      </section>

      <button className="wide ghost" onClick={resetTrail}>清除飛行軌跡</button>
    </aside>
  )
}

function fmt(v: number | null, digits: number) {
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
