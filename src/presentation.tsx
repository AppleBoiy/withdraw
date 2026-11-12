/**
 * Presentation mode: every top-level frame on the page is a slide.
 * Slides are ordered top-to-bottom in rows, then left-to-right.
 * Inside a slide, shapes with `meta.step` are revealed one step at a time.
 */
import { useEffect } from 'react'
import { atom, useEditor, useValue, type Editor, type TLShape, type TLShapeId } from 'tldraw'
import { getSlideSteps, getStep } from './steps'
import { flowEnabled, toggleFlow } from './flow'

/** `step` is an index into the current slide's list of distinct steps. */
export const presentation = atom('presentation', { active: false, index: 0, step: 0 })

/** Shapes hidden by step-by-step reveal. Read by tldraw's getShapeVisibility. */
const hiddenIds = atom('hidden ids', new Set<TLShapeId>())

export function getShapeVisibility(shape: TLShape) {
  return hiddenIds.get().has(shape.id) ? 'hidden' : 'inherit'
}

export function getSlides(editor: Editor): TLShape[] {
  const pageId = editor.getCurrentPageId()
  const frames = editor
    .getCurrentPageShapes()
    .filter((s) => s.type === 'frame' && s.parentId === pageId)
  const rowHeight = 400
  return frames.sort((a, b) => {
    const rowA = Math.round(a.y / rowHeight)
    const rowB = Math.round(b.y / rowHeight)
    return rowA !== rowB ? rowA - rowB : a.x - b.x
  })
}

/** Show slide `index` with its steps revealed up to `step` (Infinity = all). */
function showSlide(editor: Editor, index: number, step = 0) {
  const slides = getSlides(editor)
  if (slides.length === 0) return
  const clamped = Math.max(0, Math.min(index, slides.length - 1))
  const steps = getSlideSteps(editor, slides[clamped].id)
  const stepIdx = Math.max(0, Math.min(step, steps.length - 1))

  // Hide later steps in this slide and in all following slides;
  // earlier slides stay fully revealed (they are visible while the camera pans).
  const hidden = new Set<TLShapeId>()
  slides.forEach((slide, i) => {
    if (i < clamped) return
    const threshold = i === clamped ? steps[stepIdx] : 0
    for (const id of editor.getShapeAndDescendantIds([slide.id])) {
      const shape = editor.getShape(id)
      if (shape && getStep(shape) > threshold) hidden.add(id)
    }
  })
  hiddenIds.set(hidden)

  const prev = presentation.get()
  if (!prev.active || prev.index !== clamped) {
    const bounds = editor.getShapePageBounds(slides[clamped])
    if (bounds) editor.zoomToBounds(bounds, { inset: 48, animation: { duration: 500 } })
  }
  presentation.set({ active: true, index: clamped, step: stepIdx })
}

function next(editor: Editor) {
  const { index, step } = presentation.get()
  const slide = getSlides(editor)[index]
  if (slide && step < getSlideSteps(editor, slide.id).length - 1) showSlide(editor, index, step + 1)
  else if (index < getSlides(editor).length - 1) showSlide(editor, index + 1, 0)
}

function prev(editor: Editor) {
  const { index, step } = presentation.get()
  if (step > 0) showSlide(editor, index, step - 1)
  else if (index > 0) showSlide(editor, index - 1, Infinity)
}

export function startPresentation(editor: Editor) {
  if (getSlides(editor).length === 0) {
    window.alert('Add at least one frame (press F) — each frame is a slide.')
    return
  }
  editor.selectNone()
  editor.updateInstanceState({ isFocusMode: true })
  showSlide(editor, 0)
}

export function stopPresentation(editor: Editor) {
  editor.updateInstanceState({ isFocusMode: false })
  hiddenIds.set(new Set())
  presentation.set({ active: false, index: 0, step: 0 })
}

/** Rendered in front of the canvas: slide controls + keyboard navigation. */
export function PresentationControls() {
  const editor = useEditor()
  const state = useValue('presentation', () => presentation.get(), [])
  const total = useValue('slide count', () => getSlides(editor).length, [editor])
  const stepCount = useValue(
    'step count',
    () => {
      const slide = getSlides(editor)[presentation.get().index]
      return slide ? getSlideSteps(editor, slide.id).length : 1
    },
    [editor],
  )
  const flow = useValue('flow', () => flowEnabled.get(), [])

  useEffect(() => {
    if (!state.active) return
    const onKey = (e: KeyboardEvent) => {
      let handled = true
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) next(editor)
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) prev(editor)
      else if (e.key === 'Home') showSlide(editor, 0)
      else if (e.key === 'End') showSlide(editor, Infinity, Infinity)
      else if (e.key === 'Escape') stopPresentation(editor)
      else if (e.key === 'd' || e.key === 'D') toggleFlow()
      else handled = false
      if (handled) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    // Capture phase so tldraw doesn't also nudge shapes / change tools.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [state.active, editor])

  if (!state.active) return null
  const atStart = state.index === 0 && state.step === 0
  const atEnd = state.index >= total - 1 && state.step >= stepCount - 1
  return (
    <div className="eb-present-bar" onPointerDown={(e) => e.stopPropagation()}>
      <button onClick={() => prev(editor)} disabled={atStart}>
        ‹
      </button>
      <span>
        {state.index + 1} / {total}
        {stepCount > 1 && (
          <span className="eb-step-dots" aria-label={`step ${state.step + 1} of ${stepCount}`}>
            {Array.from({ length: stepCount }, (_, i) => (
              <i key={i} className={i <= state.step ? 'on' : ''} />
            ))}
          </span>
        )}
      </span>
      <button onClick={() => next(editor)} disabled={atEnd}>
        ›
      </button>
      <button className={flow ? 'eb-on' : ''} onClick={toggleFlow} title="Animated data flow (D)">
        Flow
      </button>
      <button onClick={() => stopPresentation(editor)}>Exit</button>
    </div>
  )
}
