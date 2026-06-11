import { DroneViewer } from './components/DroneViewer'
import { Hud } from './components/Hud'
import { ControlPanel } from './components/ControlPanel'
import { useTelemetry } from './hooks/useTelemetry'
import './App.css'

export default function App() {
  useTelemetry() // 開遙測 WebSocket,持續更新 store

  return (
    <div className="app">
      <DroneViewer />
      <Hud />
      <ControlPanel />
    </div>
  )
}
