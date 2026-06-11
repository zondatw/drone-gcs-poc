import { useEffect, useMemo } from 'react'
import {
  Viewer, Entity, PointGraphics, LabelGraphics, PolylineGraphics, useCesium,
} from 'resium'
import * as Cesium from 'cesium'
import { useStore } from '../lib/store'
import { api } from '../lib/api'

// 起飛點 (PX4 SITL 預設,蘇黎世)。
const HOME_LON = 8.5456
const HOME_LAT = 47.3977

// 有 Cesium ion token 就用官方高解析影像/地形;沒有就 fallback OpenStreetMap,零設定可跑。
const ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined
if (ION_TOKEN) Cesium.Ion.defaultAccessToken = ION_TOKEN

// 跟隨時的鏡頭相對位置 (entity 的 ENU 座標: 東, 北, 上):從南方 250m、上方 200m 看過去。
const VIEW_FROM = new Cesium.Cartesian3(0, -250, 200)

// 一進場做的事:換底圖、定鏡頭、掛點擊 goto。
// 用 useCesium() 拿 viewer 才保證 viewer 已經建好 (放在 <Viewer> 子層),
// 比起在父層用 ref.current?.cesiumElement 可靠 — 後者在 effect 執行時常常還是 null。
function SceneSetup() {
  const { viewer } = useCesium()
  const setTarget = useStore((s) => s.setTarget)

  useEffect(() => {
    if (!viewer) return

    // 沒有 ion token 時,明確換成 OpenStreetMap 底圖 (不然預設 ion 影像沒 token 會整顆地球黑掉)。
    if (!ION_TOKEN) {
      viewer.imageryLayers.removeAll()
      viewer.imageryLayers.addImageryProvider(
        new Cesium.UrlTemplateImageryProvider({
          url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          credit: '© OpenStreetMap contributors',
          maximumLevel: 19,
        }),
      )
    }

    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(HOME_LON, HOME_LAT - 0.004, 600),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-35), roll: 0 },
    })

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const cartesian = viewer.camera.pickEllipsoid(e.position, viewer.scene.globe.ellipsoid)
      if (!cartesian) return
      const c = Cesium.Cartographic.fromCartesian(cartesian)
      const lon = Cesium.Math.toDegrees(c.longitude)
      const lat = Cesium.Math.toDegrees(c.latitude)
      setTarget([lon, lat])
      api.goto(lat, lon)
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    return () => handler.destroy()
  }, [viewer, setTarget])

  return null
}

// 鏡頭跟隨無人機 (用 entity id 找,不用 ref)。
function FollowCam() {
  const { viewer } = useCesium()
  const follow = useStore((s) => s.follow)
  const hasPos = useStore((s) => s.telemetry.lat != null)

  useEffect(() => {
    if (!viewer) return
    viewer.trackedEntity = follow && hasPos ? viewer.entities.getById('drone') : undefined
  }, [viewer, follow, hasPos])

  return null
}

export function DroneViewer() {
  const t = useStore((s) => s.telemetry)
  const trail = useStore((s) => s.trail)
  const target = useStore((s) => s.target)

  const hasPos = t.lat != null && t.lon != null
  const dronePos = hasPos
    ? Cesium.Cartesian3.fromDegrees(t.lon!, t.lat!, t.rel_alt ?? 0)
    : undefined
  const droneOrientation = useMemo(() => {
    if (!dronePos) return undefined
    const hpr = new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(t.heading ?? 0), 0, 0)
    return Cesium.Transforms.headingPitchRollQuaternion(dronePos, hpr)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.lon, t.lat, t.rel_alt, t.heading])

  const trailPositions = useMemo(
    () => (trail.length >= 6 ? Cesium.Cartesian3.fromDegreesArrayHeights(trail) : []),
    [trail],
  )

  return (
    <Viewer
      full
      baseLayerPicker={false}
      geocoder={false}
      timeline={false}
      animation={false}
      homeButton={false}
      navigationHelpButton={false}
      sceneModePicker={false}
      fullscreenButton={false}
    >
      <SceneSetup />
      <FollowCam />

      {dronePos && (
        <Entity id="drone" position={dronePos} orientation={droneOrientation} viewFrom={VIEW_FROM}>
          <PointGraphics
            pixelSize={14}
            color={Cesium.Color.CYAN}
            outlineColor={Cesium.Color.BLACK}
            outlineWidth={2}
          />
          <LabelGraphics
            text="DRONE"
            font="13px sans-serif"
            fillColor={Cesium.Color.WHITE}
            showBackground
            backgroundColor={new Cesium.Color(0, 0, 0, 0.6)}
            pixelOffset={new Cesium.Cartesian2(0, -24)}
          />
        </Entity>
      )}

      {trailPositions.length > 0 && (
        <Entity>
          <PolylineGraphics
            positions={trailPositions}
            width={3}
            material={Cesium.Color.CYAN.withAlpha(0.7)}
            clampToGround={false}
          />
        </Entity>
      )}

      {target && (
        <Entity position={Cesium.Cartesian3.fromDegrees(target[0], target[1], t.ground_alt ?? 0)}>
          <PointGraphics
            pixelSize={12}
            color={Cesium.Color.ORANGE}
            outlineColor={Cesium.Color.WHITE}
            outlineWidth={2}
          />
          <LabelGraphics
            text="目標"
            font="12px sans-serif"
            fillColor={Cesium.Color.ORANGE}
            pixelOffset={new Cesium.Cartesian2(0, -20)}
          />
        </Entity>
      )}
    </Viewer>
  )
}
