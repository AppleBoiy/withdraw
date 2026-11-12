/**
 * Canvas overlay: animated data-flow dots along arrows, plus step badges in
 * edit mode. Drawn in scene coordinates inside a group that mirrors
 * Excalidraw's camera: viewport = (scene + scroll) * zoom.
 */
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { createStore, sceneStore, useStore } from './state'
import { getStep } from './steps'
import { presentation } from './presentation'

const STORAGE_KEY = 'explainboard:flow'
function loadFlow() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

export const flowStore = createStore(loadFlow())

export function toggleFlow() {
  const value = !flowStore.get()
  flowStore.set(value)
  try {
    localStorage.setItem(STORAGE_KEY, value ? 'on' : 'off')
  } catch {
    /* storage unavailable: keep in memory only */
  }
}

const SPEED = 120 // scene px per second
const SPACING = 150 // scene px between dots

type P = [number, number]

/** Catmull-Rom through the points → cubic Béziers (close to Excalidraw's curved arrows). */
function curvePath(pts: P[]) {
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const c1: P = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2: P = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`
  }
  return d
}

interface FlowPath {
  id: string
  d: string
  length: number
  color: string
  dashed: boolean
  twoWay: boolean
  reverseOnly: boolean
}

function arrowPaths(elements: readonly ExcalidrawElement[]): FlowPath[] {
  const out: FlowPath[] = []
  for (const el of elements) {
    if (el.type !== 'arrow' || el.isDeleted || el.opacity === 0 || el.points.length < 2) continue
    const pts = el.points.map(([px, py]) => [el.x + px, el.y + py] as P)
    let length = 0
    for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
    if (length < 20) continue
    const curved = !('elbowed' in el && el.elbowed) && el.roundness && pts.length > 2
    out.push({
      id: el.id,
      d: curved ? curvePath(pts) : pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' '),
      length,
      color: el.strokeColor === 'transparent' ? '#231B14' : el.strokeColor,
      dashed: el.strokeStyle !== 'solid',
      twoWay: !!el.startArrowhead && !!el.endArrowhead,
      reverseOnly: !!el.startArrowhead && !el.endArrowhead,
    })
  }
  return out
}

export function CanvasOverlay() {
  const { elements, appState } = useStore(sceneStore)
  const flow = useStore(flowStore)
  const presenting = useStore(presentation).active
  if (!appState) return null

  const { scrollX, scrollY } = appState
  const z = appState.zoom.value
  const paths = flow ? arrowPaths(elements) : []
  const badges =
    presenting || z < 0.3
      ? []
      : elements.filter((e) => !e.isDeleted && getStep(e) > 0 && !(e.type === 'text' && e.containerId))

  return (
    <div className="eb-overlay" style={{ left: appState.offsetLeft, top: appState.offsetTop }}>
      {paths.length > 0 && (
        <svg className="eb-flow" aria-hidden="true">
          <g transform={`scale(${z}) translate(${scrollX} ${scrollY})`}>
            {paths.map((p) =>
              p.twoWay ? (
                <g key={p.id}>
                  <Dots path={p} reverse={false} offset={0} />
                  <Dots path={p} reverse offset={0.5} />
                </g>
              ) : (
                <Dots key={p.id} path={p} reverse={p.reverseOnly} offset={0} />
              ),
            )}
          </g>
        </svg>
      )}
      {badges.map((e) => {
        const cx = e.type === 'arrow' ? e.x + e.width / 2 : e.x
        const cy = e.type === 'arrow' ? e.y + e.height / 2 : e.y
        return (
          <div
            key={e.id}
            className="eb-step-badge"
            style={{ transform: `translate(${(cx + scrollX) * z - 11}px, ${(cy + scrollY) * z - 11}px)` }}
          >
            {getStep(e)}
          </div>
        )
      })}
    </div>
  )
}

function Dots({ path, reverse, offset }: { path: FlowPath; reverse: boolean; offset: number }) {
  const speed = path.dashed ? SPEED * 0.6 : SPEED
  const dur = Math.max(1.2, path.length / speed)
  const count = Math.max(1, Math.round(path.length / SPACING / (path.twoWay ? 2 : 1)))
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <circle
          key={`${count}-${i}`}
          r={path.dashed ? 4.5 : 5.5}
          fill={path.dashed ? 'var(--eb-paper)' : path.color}
          stroke={path.color}
          strokeWidth={path.dashed ? 2.5 : 0}
        >
          <animateMotion
            dur={`${dur}s`}
            repeatCount="indefinite"
            begin={`-${((i + offset) * dur) / count}s`}
            path={path.d}
            keyPoints={reverse ? '1;0' : '0;1'}
            keyTimes="0;1"
            calcMode="linear"
          />
        </circle>
      ))}
    </>
  )
}
