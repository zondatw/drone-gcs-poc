import { DroneViewer } from './components/DroneViewer'
import { Sidebar } from './components/Sidebar'
import { useTelemetry } from './hooks/useTelemetry'
import './App.css'

export default function App() {
  useTelemetry() // 開遙測 WebSocket,持續更新 store

  return (
    <div className="app">
      <Sidebar />
      <div className="map">
        <DroneViewer />
      </div>
    </div>
  )
}
