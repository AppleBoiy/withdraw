/**
 * Presentation mode: every top-level frame on the page is a slide.
 * Slides are ordered top-to-bottom in rows, then left-to-right.
 */
import { useEffect } from 'react'
import { atom, useEditor, useValue, type Editor, type TLShape } from 'tldraw'

export const presentation = atom('presentation', { active: false, index: 0 })

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

function showSlide(editor: Editor, index: number) {
  const slides = getSlides(editor)
  if (slides.length === 0) return
  const clamped = Math.max(0, Math.min(index, slides.length - 1))
  const bounds = editor.getShapePageBounds(slides[clamped])
  if (bounds) editor.zoomToBounds(bounds, { inset: 48, animation: { duration: 500 } })
  presentation.set({ active: true, index: clamped })
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
  presentation.set({ active: false, index: 0 })
}

/** Rendered in front of the canvas: slide controls + keyboard navigation. */
export function PresentationControls() {
  const editor = useEditor()
  const state = useValue('presentation', () => presentation.get(), [])
  const total = useValue('slide count', () => getSlides(editor).length, [editor])

  useEffect(() => {
    if (!state.active) return
    const onKey = (e: KeyboardEvent) => {
      const { index } = presentation.get()
      let handled = true
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) showSlide(editor, index + 1)
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) showSlide(editor, index - 1)
      else if (e.key === 'Home') showSlide(editor, 0)
      else if (e.key === 'End') showSlide(editor, Infinity)
      else if (e.key === 'Escape') stopPresentation(editor)
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
  return (
    <div className="eb-present-bar" onPointerDown={(e) => e.stopPropagation()}>
      <button onClick={() => showSlide(editor, state.index - 1)} disabled={state.index === 0}>
        ‹
      </button>
      <span>
        {state.index + 1} / {total}
      </span>
      <button onClick={() => showSlide(editor, state.index + 1)} disabled={state.index >= total - 1}>
        ›
      </button>
      <button onClick={() => stopPresentation(editor)}>Exit</button>
    </div>
  )
}
