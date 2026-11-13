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

/** Step numbers on the canvas (the reveal order). They can be hidden; the selected shapes keep theirs. */
const BADGES_KEY = 'explainboard:step-numbers'
export const badgesStore = createStore((() => {
  try {
    return localStorage.getItem(BADGES_KEY) !== 'off'
  } catch {
    return true
  }
})())
export function toggleBadges() {
  const value = !badgesStore.get()
  badgesStore.set(value)
  try {
    localStorage.setItem(BADGES_KEY, value ? 'on' : 'off')
  } catch {
    /* storage unavailable: keep in memory only */
  }
}

/**
 * Where each step number goes. One number per thing you see: an icon or label inside a shape that
 * appears with it shares the shape's number. Each number sits on the outline of what it belongs to
 * (the upper-left of a shape, a third of the way along an arrow), never on the empty corner of a
 * bounding box, so it can't be mistaken for a neighbour's.
 */
type Badge = { el: ExcalidrawElement; x: number; y: number }
const SHAPES = new Set(['rectangle', 'ellipse', 'diamond', 'frame', 'magicframe', 'embeddable', 'iframe'])

function along(el: ExcalidrawElement & { points?: readonly (readonly [number, number])[] }, t: number): [number, number] {
  const pts = el.points ?? []
  if (pts.length < 2) return [el.x + el.width / 2, el.y + el.height / 2]
  const seg: number[] = []
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
    seg.push(d)
    total += d
  }
  let want = total * t
  for (let i = 0; i < seg.length; i++) {
    if (want <= seg[i] || i === seg.length - 1) {
      const k = seg[i] ? want / seg[i] : 0
      return [el.x + pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, el.y + pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k]
    }
    want -= seg[i]
  }
  return [el.x, el.y]
}

function anchor(el: ExcalidrawElement): [number, number] {
  const { x, y, width: w, height: h } = el
  switch (el.type) {
    case 'arrow':
    case 'line':
      return along(el as never, 0.3)
    case 'ellipse':
      return [x + w / 2 - (w / 2) * Math.SQRT1_2, y + h / 2 - (h / 2) * Math.SQRT1_2]
    case 'diamond':
      return [x + w / 4, y + h / 4]
    default:
      return [x + 6, y + 6]
  }
}

const inside = (a: ExcalidrawElement, b: ExcalidrawElement) => {
  const cx = a.x + a.width / 2, cy = a.y + a.height / 2
  return cx > b.x && cx < b.x + b.width && cy > b.y && cy < b.y + b.height && a.width * a.height < b.width * b.height
}

export function stepBadges(elements: readonly ExcalidrawElement[]): Badge[] {
  const stepped = elements.filter((e) => !e.isDeleted && getStep(e) > 0 && !(e.type === 'text' && e.containerId))
  const shapes = stepped.filter((e) => SHAPES.has(e.type))
  return stepped
    .filter((e) => {
      if (SHAPES.has(e.type) || e.type === 'arrow' || e.type === 'line') return true
      // an icon, image or free text sitting inside a shape that appears at the same step
      return !shapes.some((s) => getStep(s) === getStep(e) && inside(e, s))
    })
    .map((el) => {
      const [x, y] = anchor(el)
      return { el, x, y }
    })
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
  const showBadges = useStore(badgesStore)
  if (!appState) return null
  const selected = appState.selectedElementIds ?? {}

  const { scrollX, scrollY } = appState
  const z = appState.zoom.value
  const paths = flow ? arrowPaths(elements) : []
  const badges =
    presenting || z < 0.3
      ? []
      : stepBadges(elements).filter((b) => showBadges || selected[b.el.id])

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
      {badges.map(({ el, x, y }) => (
        <div
          key={el.id}
          className="eb-step-badge"
          title={`Appears at step ${getStep(el)} when presenting`}
          style={{ transform: `translate(${(x + scrollX) * z - 11}px, ${(y + scrollY) * z - 11}px)` }}
        >
          {getStep(el)}
        </div>
      ))}
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
