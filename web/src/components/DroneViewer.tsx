import { useEffect, useMemo } from 'react'
import {
  Viewer, Entity, PointGraphics, BillboardGraphics, LabelGraphics, PolylineGraphics, useCesium,
} from 'resium'
import * as Cesium from 'cesium'
import { useStore, type Waypoint } from '../lib/store'
import { droneFrame } from '../lib/droneIcon'

// 起飛點 (PX4 SITL 預設,蘇黎世)。
const HOME_LON = 8.5456
const HOME_LAT = 47.3977

const ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined
if (ION_TOKEN) Cesium.Ion.defaultAccessToken = ION_TOKEN

const VIEW_FROM = new Cesium.Cartesian3(0, -250, 200)
const ROUTE_MATERIAL = new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.YELLOW })

// 每台 drone 的顏色。
export const PALETTE = ['#22d3ee', '#f472d0', '#ff9f1c', '#a3e635', '#60a5fa', '#f87171']
const COLORS = PALETTE.map((c) => Cesium.Color.fromCssColorString(c))
export const droneColor = (i: number) => PALETTE[i % PALETTE.length]
const cz = (i: number) => COLORS[i % COLORS.length]

function pickLonLat(viewer: Cesium.Viewer, pos: Cesium.Cartesian2): Waypoint | null {
  const cart = viewer.camera.pickEllipsoid(pos, viewer.scene.globe.ellipsoid)
  if (!cart) return null
  const c = Cesium.Cartographic.fromCartesian(cart)
  return { lat: Cesium.Math.toDegrees(c.latitude), lon: Cesium.Math.toDegrees(c.longitude) }
}

function pickWaypointIndex(viewer: Cesium.Viewer, pos: Cesium.Cartesian2): number {
  const picked = viewer.scene.pick(pos)
  const id = picked?.id?.id
  return typeof id === 'string' && id.startsWith('wp-') ? Number(id.slice(3)) : -1
}

// 進場:換底圖、定鏡頭、掛互動(點擊加航點 / 拖曳 / 右鍵刪除,都作用在 active 那台)。
function SceneSetup() {
  const { viewer } = useCesium()
  const addWaypoint = useStore((s) => s.addWaypoint)
  const moveWaypoint = useStore((s) => s.moveWaypoint)
  const removeWaypoint = useStore((s) => s.removeWaypoint)

  useEffect(() => {
    if (!viewer) return

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
      destination: Cesium.Cartesian3.fromDegrees(HOME_LON, HOME_LAT - 0.004, 700),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-35), roll: 0 },
    })

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    let dragIndex = -1
    let dragged = false

    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const i = pickWaypointIndex(viewer, e.position)
      if (i >= 0) {
        dragIndex = i
        dragged = false
        viewer.scene.screenSpaceCameraController.enableInputs = false
      }
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN)

    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      if (dragIndex < 0) return
      const wp = pickLonLat(viewer, e.endPosition)
      if (wp) {
        moveWaypoint(dragIndex, wp)
        dragged = true
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

    handler.setInputAction(() => {
      if (dragIndex >= 0) {
        dragIndex = -1
        viewer.scene.screenSpaceCameraController.enableInputs = true
      }
    }, Cesium.ScreenSpaceEventType.LEFT_UP)

    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      if (dragged) {
        dragged = false
        return
      }
      if (pickWaypointIndex(viewer, e.position) >= 0) return
      const wp = pickLonLat(viewer, e.position)
      if (wp) addWaypoint(wp)
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const i = pickWaypointIndex(viewer, e.position)
      if (i >= 0) removeWaypoint(i)
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK)

    return () => handler.destroy()
  }, [viewer, addWaypoint, moveWaypoint, removeWaypoint])

  return null
}

// 鏡頭跟隨「目前控制中」那台。
function FollowCam() {
  const { viewer } = useCesium()
  const follow = useStore((s) => s.follow)
  const activeIndex = useStore((s) => s.activeIndex)
  const hasPos = useStore((s) => s.drones[s.activeIndex]?.telemetry.lat != null)

  useEffect(() => {
    if (!viewer) return
    viewer.trackedEntity = follow && hasPos ? viewer.entities.getById(`drone-${activeIndex}`) : undefined
  }, [viewer, follow, activeIndex, hasPos])

  return null
}

export function DroneViewer() {
  const drones = useStore((s) => s.drones)
  const activeIndex = useStore((s) => s.activeIndex)

  const active = drones[activeIndex]
  const waypoints = active?.waypoints ?? []
  const missionAlt = active?.missionAlt ?? 30

  const routePositions = useMemo(
    () =>
      waypoints.length >= 2
        ? Cesium.Cartesian3.fromDegreesArrayHeights(waypoints.flatMap((w) => [w.lon, w.lat, missionAlt]))
        : [],
    [waypoints, missionAlt],
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

      {/* 每台無人機:彩色標記 + 各自顏色的軌跡 */}
      {drones.map((d, i) => {
        const t = d.telemetry
        if (t.lat == null || t.lon == null) return null
        const pos = Cesium.Cartesian3.fromDegrees(t.lon, t.lat, t.rel_alt ?? 0)
        const isActive = i === activeIndex
        const trail = d.trail.length >= 6 ? Cesium.Cartesian3.fromDegreesArrayHeights(d.trail) : []
        // 機首對齊「飛行方向」:移動中用航跡(velocity),否則用機頭 yaw。
        // 把 ENU 方位向量轉成世界座標,當 billboard 的 alignedAxis → 不管鏡頭怎麼轉都對齊真實方位。
        const useVel = (t.ground_speed ?? 0) > 0.6 && t.vn != null && t.ve != null
        const east = useVel ? t.ve! : Math.sin(Cesium.Math.toRadians(t.heading ?? 0))
        const north = useVel ? t.vn! : Math.cos(Cesium.Math.toRadians(t.heading ?? 0))
        const headingAxis = Cesium.Matrix4.multiplyByPointAsVector(
          Cesium.Transforms.eastNorthUpToFixedFrame(pos),
          new Cesium.Cartesian3(east, north, 0),
          new Cesium.Cartesian3(),
        )
        Cesium.Cartesian3.normalize(headingAxis, headingAxis)
        return (
          <Entity key={`drone-${i}`} id={`drone-${i}`} position={pos} viewFrom={VIEW_FROM}>
            {/* 俯視四旋翼圖示:image 每幀切換做螺旋槳動畫;alignedAxis=世界方位向量 → 機首對齊飛行方向 */}
            <BillboardGraphics
              image={new Cesium.CallbackProperty(() => droneFrame(droneColor(i)), false)}
              alignedAxis={headingAxis}
              scale={isActive ? 0.62 : 0.46}
              disableDepthTestDistance={Number.POSITIVE_INFINITY}
            />
            <LabelGraphics
              text={`D${i + 1}`}
              font={isActive ? 'bold 14px sans-serif' : '12px sans-serif'}
              fillColor={Cesium.Color.WHITE}
              showBackground
              backgroundColor={new Cesium.Color(0, 0, 0, isActive ? 0.75 : 0.5)}
              pixelOffset={new Cesium.Cartesian2(0, -26)}
            />
            {trail.length > 0 && (
              <PolylineGraphics positions={trail} width={isActive ? 4 : 2} material={cz(i).withAlpha(0.7)} />
            )}
          </Entity>
        )
      })}

      {/* 其它台的航線:各自顏色(細實線 + 小點),讓「每台不同航線」一眼看到 */}
      {drones.map((d, i) => {
        if (i === activeIndex || d.waypoints.length < 2) return null
        const positions = Cesium.Cartesian3.fromDegreesArrayHeights(
          d.waypoints.flatMap((w) => [w.lon, w.lat, d.missionAlt]),
        )
        return (
          <Entity key={`route-${i}`}>
            <PolylineGraphics positions={positions} width={2} material={cz(i).withAlpha(0.85)} />
          </Entity>
        )
      })}
      {drones.flatMap((d, i) =>
        i === activeIndex
          ? []
          : d.waypoints.map((w, j) => (
              <Entity key={`owp-${i}-${j}`} position={Cesium.Cartesian3.fromDegrees(w.lon, w.lat, d.missionAlt)}>
                <PointGraphics pixelSize={7} color={cz(i)} outlineColor={Cesium.Color.BLACK} outlineWidth={1} />
              </Entity>
            )),
      )}

      {/* active 那台的預定航線(黃色虛線)*/}
      {routePositions.length > 0 && (
        <Entity>
          <PolylineGraphics positions={routePositions} width={2} material={ROUTE_MATERIAL} />
        </Entity>
      )}

      {/* active 那台的航點(可拖曳/右鍵刪除,編號)*/}
      {waypoints.map((w, i) => (
        <Entity key={`wp-${i}`} id={`wp-${i}`} position={Cesium.Cartesian3.fromDegrees(w.lon, w.lat, missionAlt)}>
          <PointGraphics pixelSize={12} color={Cesium.Color.YELLOW} outlineColor={Cesium.Color.BLACK} outlineWidth={2} />
          <LabelGraphics
            text={`${i + 1}`}
            font="bold 13px sans-serif"
            fillColor={Cesium.Color.BLACK}
            showBackground
            backgroundColor={Cesium.Color.YELLOW}
            pixelOffset={new Cesium.Cartesian2(0, -20)}
          />
        </Entity>
      ))}
    </Viewer>
  )
}
