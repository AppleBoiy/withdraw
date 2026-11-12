import { useState } from 'react'
import { Tldraw, useEditor, useValue, type TLComponents } from 'tldraw'
import { insertDiagram } from './diagram'
import { EXAMPLES } from './examples'
import { PresentationControls, presentation, startPresentation } from './presentation'

const SYNTAX_HELP = `## Frame title        → new frame (slide)
direction: down        → layout (right | down)
A -> B -> C            → edges (chain)
A -> B: label          → labelled edge
A <-> B   A ..> B      → two-way / dashed
Name: db | queue | llm | user | external | decision | data | entity [+ color]`

function TopRightPanel() {
  const editor = useEditor()
  const presenting = useValue('presenting', () => presentation.get().active, [])
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(EXAMPLES['Knowledge-graph extraction'])
  const [error, setError] = useState('')

  if (presenting) return null

  const insert = async () => {
    try {
      setError('')
      const count = await insertDiagram(editor, text)
      if (count === 0) setError('Nothing to draw — add some nodes or edges.')
      else setOpen(false)
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <>
      <div className="eb-panel">
        <button onClick={() => setOpen(true)}>Text → diagram</button>
        <button className="eb-primary" onClick={() => startPresentation(editor)}>
          ▶ Present
        </button>
      </div>
      {open && (
        <div className="eb-modal-backdrop" onPointerDown={() => setOpen(false)}>
          <div
            className="eb-modal"
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <h2>Text → diagram</h2>
            <label>
              Start from an example:{' '}
              <select onChange={(e) => setText(EXAMPLES[e.target.value])} defaultValue="Knowledge-graph extraction">
                {Object.keys(EXAMPLES).map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
            <pre className="eb-help">{SYNTAX_HELP}</pre>
            {error && <p className="eb-error">{error}</p>}
            <div className="eb-actions">
              <button onClick={() => setOpen(false)}>Cancel</button>
              <button className="eb-primary" onClick={insert}>
                Add to canvas
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const components: TLComponents = {
  SharePanel: TopRightPanel,
  InFrontOfTheCanvas: PresentationControls,
}

export default function App() {
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw
        persistenceKey="explainboard"
        components={components}
        licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY}
      />
    </div>
  )
}
