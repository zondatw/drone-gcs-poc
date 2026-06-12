// 自製「俯視四旋翼」圖示 + 螺旋槳轉動動畫(畫在 canvas 上,給 Cesium billboard 當 image)。
// 機身用該台顏色;預先把旋翼葉片轉到 NUM_FRAMES 個角度各畫一張,動畫時依時間循環切換。

const SIZE = 128
const C = SIZE / 2 // 中心
const ARM = 42 // 機臂長
const HUB = 15 // 旋翼半徑
const NUM_FRAMES = 12

// 四個旋翼相對中心的角度(X 型):45/135/225/315 度。
const ROTOR_DIRS = [-45, 45, 135, 225].map((d) => (d * Math.PI) / 180)

const cache = new Map<string, HTMLCanvasElement[]>()

function rotorCenter(theta: number): [number, number] {
  return [C + ARM * Math.cos(theta), C + ARM * Math.sin(theta)]
}

function drawBlades(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number) {
  // 動態模糊圓盤(營造高速旋轉感)
  ctx.beginPath()
  ctx.arc(x, y, HUB, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(220,230,240,0.22)'
  ctx.fill()
  // 兩片葉片
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.fillStyle = 'rgba(20,24,30,0.85)'
  for (let b = 0; b < 2; b++) {
    ctx.rotate(Math.PI)
    ctx.beginPath()
    ctx.ellipse(0, 0, HUB, 2.6, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
  // 旋翼軸心
  ctx.beginPath()
  ctx.arc(x, y, 3, 0, Math.PI * 2)
  ctx.fillStyle = '#11151b'
  ctx.fill()
}

function drawFrame(color: string, rotorAngle: number): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = cv.height = SIZE
  const ctx = cv.getContext('2d')!

  // 機臂(從中心連到四個旋翼)
  ctx.strokeStyle = '#1b2129'
  ctx.lineWidth = 9
  ctx.lineCap = 'round'
  for (const th of ROTOR_DIRS) {
    const [rx, ry] = rotorCenter(th)
    ctx.beginPath()
    ctx.moveTo(C, C)
    ctx.lineTo(rx, ry)
    ctx.stroke()
  }

  // 機身(該台顏色)
  ctx.beginPath()
  ctx.arc(C, C, 16, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  ctx.lineWidth = 2.5
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'
  ctx.stroke()

  // 機首指示(往「上」=北,billboard 會再依航向轉),白色三角形
  ctx.beginPath()
  ctx.moveTo(C, C - 22)
  ctx.lineTo(C - 6, C - 11)
  ctx.lineTo(C + 6, C - 11)
  ctx.closePath()
  ctx.fillStyle = '#f4f8ff'
  ctx.fill()

  // 四個旋翼
  for (const th of ROTOR_DIRS) {
    const [rx, ry] = rotorCenter(th)
    drawBlades(ctx, rx, ry, rotorAngle)
  }
  return cv
}

function framesFor(color: string): HTMLCanvasElement[] {
  let frames = cache.get(color)
  if (!frames) {
    // 2 葉片 → 每 π 重複一次,把 0~π 切成 NUM_FRAMES 格即連續。
    frames = Array.from({ length: NUM_FRAMES }, (_, f) => drawFrame(color, (f / NUM_FRAMES) * Math.PI))
    cache.set(color, frames)
  }
  return frames
}

// 依現在時間回傳該顏色當下這格(~25fps 循環,看起來像高速旋轉)。
export function droneFrame(color: string): HTMLCanvasElement {
  const frames = framesFor(color)
  const idx = Math.floor(performance.now() / 40) % NUM_FRAMES
  return frames[idx]
}
