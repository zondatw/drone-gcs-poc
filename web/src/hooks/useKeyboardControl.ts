import { useEffect } from 'react'
import { useStore } from '../lib/store'

const SPEED = 3 // m/s 水平 / 垂直
const YAW_RATE = 30 // deg/s
const RATE_HZ = 15

// Offboard 啟用時,用鍵盤即時送速度 setpoint 到 /ws/control:
//   W/S = 前/後   A/D = 左/右   R/F = 上/下   Q/E = 左轉/右轉
// body 座標系: forward 前正, right 右正, down 下正, yawspeed 順時針正。
export function useKeyboardControl() {
  const offboardActive = useStore((s) => s.offboardActive)

  useEffect(() => {
    if (!offboardActive) return

    const ws = new WebSocket(`ws://${location.host}/ws/control`)
    const keys = new Set<string>()

    const onDown = (e: KeyboardEvent) => {
      if ('wsadrfqe'.includes(e.key.toLowerCase())) {
        keys.add(e.key.toLowerCase())
        e.preventDefault()
      }
    }
    const onUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase())
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)

    const timer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return
      const k = (c: string) => (keys.has(c) ? 1 : 0)
      ws.send(
        JSON.stringify({
          forward: (k('w') - k('s')) * SPEED,
          right: (k('d') - k('a')) * SPEED,
          down: (k('f') - k('r')) * SPEED, // f=下降(down正), r=上升
          yawspeed: (k('e') - k('q')) * YAW_RATE,
        }),
      )
    }, 1000 / RATE_HZ)

    return () => {
      clearInterval(timer)
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      ws.close()
    }
  }, [offboardActive])
}
