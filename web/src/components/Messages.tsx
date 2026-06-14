import { useStore } from '../lib/store'
import { droneColor } from './DroneViewer'

// 距現在多久(訊息面板用):剛剛 / Ns / Nm / Nh。
function ago(t: number): string {
  const s = Math.max(0, Date.now() / 1000 - t)
  if (s < 2) return '剛剛'
  if (s < 60) return `${Math.round(s)}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  return `${Math.round(s / 3600)}h`
}

// 飛控訊息 log:把 STATUSTEXT(arming 失敗原因、預檢失敗、模式拒絕…)攤開,
// 解掉「為什麼不能 arm / 為什麼不動」的黑箱。全機共用,最新在上。
export function Messages() {
  const messages = useStore((s) => s.messages)
  const recent = messages.slice(-40).reverse()

  return (
    <section className="card msg-card">
      <h3>飛控訊息 {messages.length > 0 && <span className="msg-count">{messages.length}</span>}</h3>
      {recent.length === 0 ? (
        <div className="tip">尚無訊息 · 飛控回報(如 arm 失敗原因)會顯示在這</div>
      ) : (
        <ul className="msg-list">
          {recent.map((m) => (
            <li key={m.id} className={`msg msg-${m.sev}`}>
              <span className="msg-drone" style={{ color: droneColor(m.drone) }}>D{m.drone + 1}</span>
              <span className="msg-text">{m.text}</span>
              <span className="msg-time">{ago(m.t)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
