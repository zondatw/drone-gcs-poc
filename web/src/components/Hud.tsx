import { useStore } from '../lib/store'

function fmt(v: number | null, digits = 1, suffix = '') {
  return v == null ? '—' : `${v.toFixed(digits)}${suffix}`
}

// 左上角浮層:即時數字遙測。
export function Hud() {
  const t = useStore((s) => s.telemetry)
  const connected = useStore((s) => s.connected)

  return (
    <div className="hud">
      <div className="hud-row">
        <span className={`dot ${connected ? 'ok' : 'bad'}`} />
        {connected ? '已連線' : '連線中…'}
      </div>
      <Item label="飛行模式" value={t.flight_mode?.replace('FlightMode.', '') ?? '—'} />
      <Item label="解鎖 (Armed)" value={t.armed == null ? '—' : t.armed ? '是' : '否'} />
      <Item label="相對高度" value={fmt(t.rel_alt, 1, ' m')} />
      <Item label="地速" value={fmt(t.ground_speed, 1, ' m/s')} />
      <Item label="爬升率" value={fmt(t.vd == null ? null : -t.vd, 1, ' m/s')} />
      <Item label="航向" value={fmt(t.heading, 0, '°')} />
      <Item label="電量" value={fmt(t.battery_pct, 0, ' %')} />
      <Item label="緯度" value={fmt(t.lat, 6)} />
      <Item label="經度" value={fmt(t.lon, 6)} />
    </div>
  )
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="hud-row">
      <span className="hud-label">{label}</span>
      <span className="hud-value">{value}</span>
    </div>
  )
}
