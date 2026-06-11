import { useEffect } from 'react'
import { useStore } from '../lib/store'

// 連 /ws/telemetry,把後端推來的快照寫進 store。斷線會自動重連。
export function useTelemetry() {
  const setTelemetry = useStore((s) => s.setTelemetry)
  const setConnected = useStore((s) => s.setConnected)

  useEffect(() => {
    let ws: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let closed = false

    const connect = () => {
      ws = new WebSocket(`ws://${location.host}/ws/telemetry`)
      ws.onopen = () => setConnected(true)
      ws.onmessage = (e) => setTelemetry(JSON.parse(e.data))
      ws.onclose = () => {
        setConnected(false)
        if (!closed) retry = setTimeout(connect, 1000)
      }
      ws.onerror = () => ws?.close()
    }
    connect()

    return () => {
      closed = true
      if (retry) clearTimeout(retry)
      ws?.close()
    }
  }, [setTelemetry, setConnected])
}
