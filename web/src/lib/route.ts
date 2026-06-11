import type { Waypoint } from './store'

// 公尺 → 經緯度位移(粗略,夠近距離航線用)。
const M_PER_DEG = 111320

// 以 (centerLat, centerLon) 為圓心生一條隨機航線:3~5 個航點,
// bearing 排序避免路線自交,半徑 80~250m。
export function randomRoute(centerLat: number, centerLon: number): Waypoint[] {
  const k = 3 + Math.floor(Math.random() * 3) // 3~5 點
  const cosLat = Math.cos((centerLat * Math.PI) / 180)
  // 隨機角度後排序,讓航點繞著中心一圈,看起來像條順路。
  const bearings = Array.from({ length: k }, () => Math.random() * 2 * Math.PI).sort((a, b) => a - b)
  return bearings.map((theta) => {
    const dist = 80 + Math.random() * 170 // 80~250m
    const dLat = (dist * Math.cos(theta)) / M_PER_DEG
    const dLon = (dist * Math.sin(theta)) / (M_PER_DEG * cosLat)
    return { lat: centerLat + dLat, lon: centerLon + dLon }
  })
}
