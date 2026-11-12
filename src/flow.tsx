/**
 * Animated data flow: dots travel along every visible arrow, start → end
 * (both ways for two-headed arrows). Dashed arrows get slower, hollow dots,
 * which reads nicely as "async / optional".
 */
import {
  atom,
  getArrowInfo,
  getColorValue,
  useEditor,
  useValue,
  type TLArrowInfo,
  type TLArrowShape,
} from 'tldraw'

const STORAGE_KEY = 'explainboard:flow'
function loadFlow() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

export const flowEnabled = atom('flow enabled', loadFlow())
export function toggleFlow() {
  const value = !flowEnabled.get()
  flowEnabled.set(value)
  try {
    localStorage.setItem(STORAGE_KEY, value ? 'on' : 'off')
  } catch {
    /* storage unavailable: keep in memory only */
  }
}

const SPEED = 120 // page px per second
const SPACING = 150 // page px between dots

function bodyPath(info: TLArrowInfo): { d: string; length: number } {
  const s = info.start.point
  const e = info.end.point
  switch (info.type) {
    case 'straight':
      return { d: `M${s.x},${s.y} L${e.x},${e.y}`, length: info.length }
    case 'arc': {
      const { radius: r, largeArcFlag, sweepFlag, length } = info.bodyArc
      return { d: `M${s.x},${s.y} A${r},${r} 0 ${largeArcFlag} ${sweepFlag} ${e.x},${e.y}`, length }
    }
    case 'elbow': {
      const pts = info.route.points
      return { d: pts.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' '), length: info.route.distance }
    }
  }
}

interface FlowPath {
  id: string
  d: string
  transform: string
  length: number
  color: string
  dashed: boolean
  twoWay: boolean
  reverseOnly: boolean
}

export function FlowDots() {
  const editor = useEditor()
  const enabled = useValue('flow enabled', () => flowEnabled.get(), [])

  const paths = useValue(
    'flow paths',
    () => {
      if (!flowEnabled.get()) return []
      const colors = editor.getCurrentTheme().colors[editor.getColorMode()]
      const out: FlowPath[] = []
      for (const shape of editor.getCurrentPageShapes()) {
        if (shape.type !== 'arrow' || editor.isShapeHidden(shape)) continue
        const arrow = shape as TLArrowShape
        const info = getArrowInfo(editor, arrow)
        if (!info?.isValid) continue
        const { d, length } = bodyPath(info)
        if (!(length > 20)) continue
        const m = editor.getShapePageTransform(arrow)
        const startHead = arrow.props.arrowheadStart !== 'none'
        const endHead = arrow.props.arrowheadEnd !== 'none'
        out.push({
          id: arrow.id,
          d,
          transform: `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`,
          length,
          color: getColorValue(colors, arrow.props.color, 'solid'),
          dashed: arrow.props.dash === 'dashed' || arrow.props.dash === 'dotted',
          twoWay: startHead && endHead,
          reverseOnly: startHead && !endHead,
        })
      }
      return out
    },
    [editor],
  )

  const camera = useValue('camera', () => editor.getCamera(), [editor])

  if (!enabled || paths.length === 0) return null
  return (
    <svg className="eb-flow" aria-hidden="true">
      <g transform={`scale(${camera.z}) translate(${camera.x} ${camera.y})`}>
        {paths.map((p) => (
          <g key={p.id} transform={p.transform}>
            {p.twoWay ? (
              <>
                <Dots path={p} reverse={false} offset={0} />
                <Dots path={p} reverse offset={0.5} />
              </>
            ) : (
              <Dots path={p} reverse={p.reverseOnly} offset={0} />
            )}
          </g>
        ))}
      </g>
    </svg>
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
          fill={path.dashed ? 'var(--color-background, #fff)' : path.color}
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
