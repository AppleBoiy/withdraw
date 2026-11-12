/**
 * Presentation mode: every frame is a slide, ordered top-to-bottom in rows,
 * then left-to-right. Inside a slide, elements with a step are revealed one
 * click at a time (hidden elements get opacity 0 without touching undo history;
 * the original opacities come back on exit).
 */
import { useEffect } from 'react'
import { CaptureUpdateAction, newElementWith } from '@excalidraw/excalidraw'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { createStore, getApi, useStore } from './state'
import { getSlideSteps, getStep } from './steps'
import { flowStore, toggleFlow } from './flow'

/** `step` is an index into the current slide's list of distinct steps. */
export const presentation = createStore({ active: false, index: 0, step: 0, total: 0, stepCount: 1 })

let originalOpacity = new Map<string, number>()
let fitTimer: number | undefined

export function getSlides(elements: readonly ExcalidrawElement[]) {
  const frames = elements.filter((e) => e.type === 'frame' && !e.isDeleted)
  const rowHeight = 400
  return frames.sort((a, b) => {
    const rowA = Math.round(a.y / rowHeight)
    const rowB = Math.round(b.y / rowHeight)
    return rowA !== rowB ? rowA - rowB : a.x - b.x
  })
}

/** Show slide `index` with its steps revealed up to `step` (Infinity = all). */
function showSlide(index: number, step = 0) {
  const api = getApi()
  const all = api.getSceneElementsIncludingDeleted()
  const slides = getSlides(all)
  if (slides.length === 0) return
  const clamped = Math.max(0, Math.min(index, slides.length - 1))
  const steps = getSlideSteps(all, slides[clamped].id)
  const stepIdx = Math.max(0, Math.min(step, steps.length - 1))

  // Hide later steps in this slide and all following slides; earlier slides stay fully revealed.
  const threshold = new Map<string, number>()
  slides.forEach((s, i) => {
    if (i >= clamped) threshold.set(s.id, i === clamped ? steps[stepIdx] : 0)
  })
  const hidden = new Set<string>()
  for (const el of all) {
    const t = el.frameId ? threshold.get(el.frameId) : undefined
    if (t !== undefined && getStep(el) > t) hidden.add(el.id)
  }
  // Labels follow their container / arrow.
  for (const el of all) if (el.type === 'text' && el.containerId && hidden.has(el.containerId)) hidden.add(el.id)

  api.updateScene({
    elements: all.map((el) => {
      const want = hidden.has(el.id) ? 0 : (originalOpacity.get(el.id) ?? el.opacity)
      return el.opacity === want ? el : newElementWith(el, { opacity: want })
    }),
    captureUpdate: CaptureUpdateAction.NEVER,
  })

  const prev = presentation.get()
  if (!prev.active || prev.index !== clamped) {
    // Wait for React to apply view/zen mode first — that re-render would cancel the camera animation.
    const frameId = slides[clamped].id
    window.clearTimeout(fitTimer) // fast key presses: only the latest slide wins
    fitTimer = window.setTimeout(() => {
      const frame = api.getSceneElements().find((e) => e.id === frameId)
      if (frame) api.scrollToContent(frame, { fitToViewport: true, viewportZoomFactor: 0.92, animate: true, duration: 500 })
    }, prev.active ? 0 : 80)
  }
  presentation.set({ active: true, index: clamped, step: stepIdx, total: slides.length, stepCount: steps.length })
}

function next() {
  const { index, step, stepCount, total } = presentation.get()
  if (step < stepCount - 1) showSlide(index, step + 1)
  else if (index < total - 1) showSlide(index + 1, 0)
}

function prev() {
  const { index, step } = presentation.get()
  if (step > 0) showSlide(index, step - 1)
  else if (index > 0) showSlide(index - 1, Infinity)
}

export function startPresentation() {
  const api = getApi()
  const all = api.getSceneElementsIncludingDeleted()
  if (getSlides(all).length === 0) {
    window.alert('Add at least one frame (press F) — each frame is a slide.')
    return
  }
  originalOpacity = new Map(all.map((e) => [e.id, e.opacity]))
  api.updateScene({
    appState: {
      selectedElementIds: {},
      frameRendering: { enabled: true, name: true, outline: false, clip: true },
    },
    captureUpdate: CaptureUpdateAction.NEVER,
  })
  presentation.set((p) => ({ ...p, active: false }))
  showSlide(0)
}

export function stopPresentation() {
  const api = getApi()
  api.updateScene({
    elements: api.getSceneElementsIncludingDeleted().map((el) => {
      const o = originalOpacity.get(el.id)
      return o !== undefined && o !== el.opacity ? newElementWith(el, { opacity: o }) : el
    }),
    appState: { frameRendering: { enabled: true, name: true, outline: true, clip: true } },
    captureUpdate: CaptureUpdateAction.NEVER,
  })
  originalOpacity = new Map()
  presentation.set({ active: false, index: 0, step: 0, total: 0, stepCount: 1 })
}

/** Slide controls + keyboard navigation (rendered while presenting). */
export function PresentBar() {
  const state = useStore(presentation)
  const flow = useStore(flowStore)

  useEffect(() => {
    if (!state.active) return
    const onKey = (e: KeyboardEvent) => {
      let handled = true
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) next()
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) prev()
      else if (e.key === 'Home') showSlide(0)
      else if (e.key === 'End') showSlide(Infinity, Infinity)
      else if (e.key === 'Escape') stopPresentation()
      else if (e.key === 'd' || e.key === 'D') toggleFlow()
      else handled = false
      if (handled) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    // Capture phase so Excalidraw doesn't also scroll / switch tools.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [state.active])

  if (!state.active) return null
  const atStart = state.index === 0 && state.step === 0
  const atEnd = state.index >= state.total - 1 && state.step >= state.stepCount - 1
  return (
    <div className="eb-present-bar">
      <button onClick={prev} disabled={atStart} aria-label="Back">
        ‹
      </button>
      <span className="eb-present-count">
        {state.index + 1} <i>/</i> {state.total}
        {state.stepCount > 1 && (
          <span className="eb-step-dots" aria-label={`step ${state.step + 1} of ${state.stepCount}`}>
            {Array.from({ length: state.stepCount }, (_, i) => (
              <i key={i} className={i <= state.step ? 'on' : ''} />
            ))}
          </span>
        )}
      </span>
      <button onClick={next} disabled={atEnd} aria-label="Next">
        ›
      </button>
      <span className="eb-sep" />
      <button className={flow ? 'eb-on' : ''} onClick={toggleFlow} title="Animated data flow (D)">
        flow
      </button>
      <button onClick={stopPresentation} title="Exit (Esc)">
        exit
      </button>
    </div>
  )
}
