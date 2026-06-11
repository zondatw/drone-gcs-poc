import { useStore } from '../lib/store'
import { api } from '../lib/api'
import { useKeyboardControl } from '../hooks/useKeyboardControl'

// 右上角浮層:指令按鈕 + offboard 手動操控切換。
export function ControlPanel() {
  const offboardActive = useStore((s) => s.offboardActive)
  const setOffboardActive = useStore((s) => s.setOffboardActive)
  const follow = useStore((s) => s.follow)
  const setFollow = useStore((s) => s.setFollow)
  const resetTrail = useStore((s) => s.resetTrail)

  useKeyboardControl() // 掛上鍵盤監聽 (只在 offboardActive 時真的送)

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

  return (
    <div className="panel">
      <div className="panel-title">飛行控制</div>
      <div className="btn-grid">
        <button onClick={() => api.arm()}>Arm 解鎖</button>
        <button onClick={() => api.takeoff()}>起飛</button>
        <button onClick={() => api.land()}>降落</button>
        <button onClick={() => api.rtl()}>返航 RTL</button>
      </div>

      <button
        className={offboardActive ? 'wide active' : 'wide'}
        onClick={toggleOffboard}
      >
        {offboardActive ? '■ 停止手動操控' : '▶ 手動操控 (Offboard)'}
      </button>

      {offboardActive && (
        <div className="hint">
          <b>WASD</b> 前後左右 · <b>R/F</b> 升降 · <b>Q/E</b> 轉向
        </div>
      )}

      <label className="check">
        <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
        鏡頭跟隨
      </label>

      <button className="wide ghost" onClick={resetTrail}>清除軌跡</button>

      <div className="tip">點地圖任一點 → 無人機 goto 飛過去</div>
    </div>
  )
}
