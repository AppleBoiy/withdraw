/**
 * Step-by-step reveal.
 *
 * Any element can carry `customData.step` (a number). Step 0 / none = always visible.
 * While presenting, a slide starts with only step-0 elements and each "next"
 * reveals the next step before moving on to the following slide.
 */
import { CaptureUpdateAction, newElementWith } from '@excalidraw/excalidraw'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { getApi, sceneStore, useStore } from './state'

export function getStep(el: ExcalidrawElement): number {
  const s = el.customData?.step
  return typeof s === 'number' && s > 0 ? s : 0
}

/** Elements that belong to a frame (bound labels included). */
export function frameChildren(elements: readonly ExcalidrawElement[], frameId: string) {
  return elements.filter((e) => !e.isDeleted && e.frameId === frameId)
}

/** Sorted distinct steps used inside a slide (always starts with 0). */
export function getSlideSteps(elements: readonly ExcalidrawElement[], frameId: string): number[] {
  const steps = new Set<number>([0])
  for (const el of frameChildren(elements, frameId)) steps.add(getStep(el))
  return [...steps].sort((a, b) => a - b)
}

function updateSteps(changes: Map<string, number>) {
  const api = getApi()
  api.updateScene({
    elements: api
      .getSceneElementsIncludingDeleted()
      .map((el) =>
        changes.has(el.id) ? newElementWith(el, { customData: { ...el.customData, step: changes.get(el.id)! } }) : el,
      ),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  })
}

export function setStep(ids: string[], step: number) {
  const value = Math.max(0, Math.round(step))
  updateSteps(new Map(ids.map((id) => [id, value])))
}

/**
 * Assign steps to a frame's contents by following its arrows: sources appear
 * first, then whatever they point to, one hop per step. Arrows appear together
 * with the element they point at. Unconnected elements stay at step 0.
 */
export function autoSteps(frameId: string) {
  const children = frameChildren(getApi().getSceneElements(), frameId).filter(
    (e) => !(e.type === 'text' && e.containerId),
  )
  const arrows = children.filter((e) => e.type === 'arrow')
  const nodes = children.filter((e) => e.type !== 'arrow')
  const nodeIds = new Set(nodes.map((n) => n.id))

  const edges: { arrow: string; from: string; to: string }[] = []
  for (const a of arrows) {
    if (a.type !== 'arrow') continue
    const from = a.startBinding?.elementId
    const to = a.endBinding?.elementId
    if (from && to && nodeIds.has(from) && nodeIds.has(to)) edges.push({ arrow: a.id, from, to })
  }

  const incoming = new Map<string, number>()
  for (const e of edges) incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1)
  const connected = new Set(edges.flatMap((e) => [e.from, e.to]))

  // BFS from sources. Pure cycles fall back to the first node.
  const layer = new Map<string, number>()
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

  // Icons/images sitting on top of a node follow that node.
  const at = (id: string) => layer.get(id) ?? 0
  const changes = new Map<string, number>()
  for (const n of nodes) {
    let step = at(n.id)
    if (!connected.has(n.id)) {
      const host = nodes.find(
        (h) => h !== n && connected.has(h.id) && n.x >= h.x && n.y >= h.y && n.x + n.width <= h.x + h.width && n.y + n.height <= h.y + h.height,
      )
      if (host) step = at(host.id)
    }
    changes.set(n.id, step)
  }
  for (const e of edges) changes.set(e.arrow, Math.max(at(e.from), at(e.to)))
  for (const a of arrows) if (!changes.has(a.id)) changes.set(a.id, 0)
  updateSteps(changes)
}

/** Toolbar shown while elements are selected: set / auto-assign reveal steps. */
export function StepControls() {
  const { elements, appState } = useStore(sceneStore)
  const selectedIds = appState?.selectedElementIds ?? {}
  const selection = elements.filter((e) => selectedIds[e.id] && !e.isDeleted)
  if (selection.length === 0) return null

  const steps = new Set(selection.map(getStep))
  const current = steps.size === 1 ? [...steps][0] : null
  const ids = selection.map((s) => s.id)
  const frames = selection.filter((s) => s.type === 'frame')

  return (
    <div className="eb-steps" title="Reveal step while presenting (0 = shown immediately)">
      <span className="eb-steps-label">step</span>
      <button onClick={() => setStep(ids, (current ?? 1) - 1)} disabled={current === 0} aria-label="Earlier step">
        −
      </button>
      <b>{current ?? '–'}</b>
      <button onClick={() => setStep(ids, (current ?? 0) + 1)} aria-label="Later step">
        +
      </button>
      {frames.length > 0 && (
        <button className="eb-steps-auto" title="Reveal this frame in arrow order" onClick={() => frames.forEach((f) => autoSteps(f.id))}>
          auto
        </button>
      )}
    </div>
  )
}
