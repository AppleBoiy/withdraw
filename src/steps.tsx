/**
 * Step-by-step reveal.
 *
 * Any shape can carry `meta.step` (a number). Step 0 / no step = always visible.
 * While presenting, a slide starts with only step-0 shapes and each "next"
 * reveals the next step before moving on to the following slide.
 */
import {
  useEditor,
  useValue,
  type Editor,
  type TLArrowBinding,
  type TLShape,
  type TLShapeId,
} from 'tldraw'
import { presentation } from './presentation'

export function getStep(shape: TLShape): number {
  const s = shape.meta?.step
  return typeof s === 'number' && s > 0 ? s : 0
}

/** Sorted distinct steps used inside a slide (always starts with 0). */
export function getSlideSteps(editor: Editor, frameId: TLShapeId): number[] {
  const steps = new Set<number>([0])
  for (const id of editor.getShapeAndDescendantIds([frameId])) {
    const shape = editor.getShape(id)
    if (shape) steps.add(getStep(shape))
  }
  return [...steps].sort((a, b) => a - b)
}

export function setStep(editor: Editor, ids: TLShapeId[], step: number) {
  const value = Math.max(0, Math.round(step))
  editor.markHistoryStoppingPoint('set reveal step')
  editor.updateShapes(
    ids
      .map((id) => editor.getShape(id))
      .filter((s): s is TLShape => !!s)
      .map((s) => ({ id: s.id, type: s.type, meta: { ...s.meta, step: value } })),
  )
}

/**
 * Assign steps to a frame's contents by following its arrows: sources appear
 * first, then whatever they point to, one hop per step. Arrows appear together
 * with the shape they point at. Unconnected shapes stay at step 0.
 */
export function autoSteps(editor: Editor, frameId: TLShapeId) {
  const children = editor.getSortedChildIdsForParent(frameId).map((id) => editor.getShape(id)!)
  const arrows = children.filter((s) => s.type === 'arrow')
  const nodes = children.filter((s) => s.type !== 'arrow')
  const nodeIds = new Set(nodes.map((n) => n.id))

  const edges: { arrow: TLShapeId; from: TLShapeId; to: TLShapeId }[] = []
  for (const arrow of arrows) {
    const bindings = editor.getBindingsFromShape<TLArrowBinding>(arrow, 'arrow')
    const from = bindings.find((b) => b.props.terminal === 'start')?.toId
    const to = bindings.find((b) => b.props.terminal === 'end')?.toId
    if (from && to && nodeIds.has(from) && nodeIds.has(to)) edges.push({ arrow: arrow.id, from, to })
  }

  const incoming = new Map<TLShapeId, number>()
  for (const e of edges) incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1)
  const connected = new Set(edges.flatMap((e) => [e.from, e.to]))

  // BFS from sources (connected nodes with no incoming edges). Pure cycles fall back to step 0.
  const layer = new Map<TLShapeId, number>()
  const queue = [...connected].filter((id) => !incoming.get(id))
  if (queue.length === 0 && connected.size) queue.push([...connected][0])
  queue.forEach((id) => layer.set(id, 0))
  while (queue.length) {
    const id = queue.shift()!
    for (const e of edges) {
      if (e.from === id && !layer.has(e.to)) {
        layer.set(e.to, layer.get(id)! + 1)
        queue.push(e.to)
      }
    }
  }

  const updates: { id: TLShapeId; step: number }[] = nodes.map((n) => ({ id: n.id, step: layer.get(n.id) ?? 0 }))
  for (const e of edges) {
    updates.push({ id: e.arrow, step: Math.max(layer.get(e.from) ?? 0, layer.get(e.to) ?? 0) })
  }
  for (const a of arrows) if (!edges.some((e) => e.arrow === a.id)) updates.push({ id: a.id, step: 0 })

  editor.markHistoryStoppingPoint('auto steps')
  editor.updateShapes(
    updates.map(({ id, step }) => {
      const s = editor.getShape(id)!
      return { id, type: s.type, meta: { ...s.meta, step } }
    }),
  )
}

/** Toolbar shown while shapes are selected: set / auto-assign reveal steps. */
export function StepControls() {
  const editor = useEditor()
  const selection = useValue('selected shapes', () => editor.getSelectedShapes(), [editor])
  if (selection.length === 0) return null

  const steps = new Set(selection.map(getStep))
  const current = steps.size === 1 ? [...steps][0] : null
  const ids = selection.map((s) => s.id)
  const frames = selection.filter((s) => s.type === 'frame')

  return (
    <div className="eb-steps" title="Reveal step while presenting (0 = shown immediately)">
      <span>Step</span>
      <button onClick={() => setStep(editor, ids, (current ?? 1) - 1)} disabled={current === 0}>
        −
      </button>
      <b>{current ?? '–'}</b>
      <button onClick={() => setStep(editor, ids, (current ?? 0) + 1)}>+</button>
      {frames.length > 0 && (
        <button
          title="Reveal this frame's contents in arrow order"
          onClick={() => frames.forEach((f) => autoSteps(editor, f.id))}
        >
          Auto
        </button>
      )}
    </div>
  )
}

/** Small numbered badges on shapes that have a reveal step (edit mode only). */
export function StepBadges() {
  const editor = useEditor()
  const badges = useValue(
    'step badges',
    () => {
      if (presentation.get().active || editor.getZoomLevel() < 0.3) return []
      const out: { id: string; x: number; y: number; step: number }[] = []
      for (const shape of editor.getCurrentPageShapes()) {
        const step = getStep(shape)
        if (!step) continue
        const bounds = editor.getShapePageBounds(shape)
        if (!bounds) continue
        // Arrows: badge at the middle; other shapes: top-left corner.
        const anchor = shape.type === 'arrow' ? bounds.center : bounds.point
        const p = editor.pageToViewport(anchor)
        out.push({ id: shape.id, x: p.x, y: p.y, step })
      }
      return out
    },
    [editor],
  )

  return (
    <>
      {badges.map((b) => (
        <div key={b.id} className="eb-step-badge" style={{ transform: `translate(${b.x - 10}px, ${b.y - 10}px)` }}>
          {b.step}
        </div>
      ))}
    </>
  )
}
