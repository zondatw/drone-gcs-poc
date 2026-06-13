import { describe, it, expect } from 'vitest'
import { randomRoute } from './route'

const M_PER_DEG = 111320

// 兩點間的粗略距離(公尺),跟 route.ts 用的同一套近似。
function distM(lat0: number, lon0: number, lat: number, lon: number): number {
  const dLat = (lat - lat0) * M_PER_DEG
  const dLon = (lon - lon0) * M_PER_DEG * Math.cos((lat0 * Math.PI) / 180)
  return Math.hypot(dLat, dLon)
}

describe('randomRoute', () => {
  it('產生 3~5 個航點', () => {
    for (let n = 0; n < 50; n++) {
      const r = randomRoute(47.3977, 8.5456)
      expect(r.length).toBeGreaterThanOrEqual(3)
      expect(r.length).toBeLessThanOrEqual(5)
    }
  })

  it('每個航點都在中心半徑 ~80–250m 內、且不等於中心', () => {
    const [clat, clon] = [47.3977, 8.5456]
    for (let n = 0; n < 50; n++) {
      for (const w of randomRoute(clat, clon)) {
        const d = distM(clat, clon, w.lat, w.lon)
        expect(d).toBeGreaterThan(50)
        expect(d).toBeLessThan(300)
      }
    }
  })

  it('回傳合法經緯度', () => {
    for (const w of randomRoute(47.3977, 8.5456)) {
      expect(Number.isFinite(w.lat)).toBe(true)
      expect(Number.isFinite(w.lon)).toBe(true)
    }
  })
})
