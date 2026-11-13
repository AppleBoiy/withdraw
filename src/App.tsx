import { useCallback, useEffect, useState } from 'react'
import { Excalidraw, MainMenu, WelcomeScreen, useHandleLibrary } from '@excalidraw/excalidraw'
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { insertDiagram } from './diagram'
import { EXAMPLES } from './examples'
import { CanvasOverlay } from './flow'
import { Dock, DOCK_ICONS, usePhoneLayout } from './Dock'
import { Mark } from './Mark'
import { ICON_SIDEBAR, IconGallery } from './IconGallery'
import { attachApi, libraryAdapter, listSnapshots, loadScene, restoreSnapshot, saveScene, saveStatus } from './persist'
import { PresentBar, presentation, startPresentation } from './presentation'
import { apiStore, getApi, pushScene, sceneStore, uiStore, useStore } from './state'

/** The syntax, one line each: what you write, and what it draws. */
const SYNTAX: [string, string][] = [
  ['## Frame title', 'a new frame (one slide)'],
  ['direction: down', 'lay it out right or down'],
  ['A -> B -> C', 'a chain of arrows'],
  ['A -> B: label', 'an arrow with a label'],
  ['A <-> B', 'two-way'],
  ['A ..> B', 'dashed: async, optional'],
  ['Name: db', 'kind: service, db, queue, llm, user, external, decision, data, entity'],
  ['Name: db green icon:postgresql', 'plus a colour and any icon from the gallery'],
  ['---', 'what follows appears on the next click'],
  ['# note', 'a comment'],
]
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

const initialData = loadScene()

function DiagramDialog() {
  const { diagramOpen } = useStore(uiStore)
  const [text, setText] = useState(EXAMPLES['Knowledge-graph extraction'])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!diagramOpen) return null
  const close = () => uiStore.set((u) => ({ ...u, diagramOpen: false }))

  const insert = async () => {
    setBusy(true)
    setError('')
    try {
      const count = await insertDiagram(text)
      if (count === 0) setError('Nothing to draw — add some nodes or edges.')
      else close()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="eb-modal-backdrop" onPointerDown={close}>
      <div
        className="eb-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="eb-diagram-title"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) insert()
        }}
      >
        <header className="eb-modal-head">
          <div>
            <h2 id="eb-diagram-title">
              Text <span className="eb-shu">→</span> diagram
            </h2>
            <p>Write the boxes and arrows; they are laid out as shapes you can edit.</p>
          </div>
          <button className="eb-modal-x" onClick={close} aria-label="Close">
            ×
          </button>
        </header>
        <div className="eb-modal-body">
          <div className="eb-editor">
            <div className="eb-editor-bar">
              <span>your diagram</span>
              <label>
                start from
                <select onChange={(e) => setText(EXAMPLES[e.target.value])} defaultValue="Knowledge-graph extraction">
                  {Object.keys(EXAMPLES).map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </label>
            </div>
            <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} autoFocus aria-label="Diagram text" />
          </div>
          <aside className="eb-cheat" aria-label="Syntax">
            <h3>Syntax</h3>
            <dl>
              {SYNTAX.map(([code, does]) => (
                <div key={code}>
                  <dt>
                    <code>{code}</code>
                  </dt>
                  <dd>{does}</dd>
                </div>
              ))}
            </dl>
          </aside>
        </div>
        <footer className="eb-modal-foot">
          {error ? <p className="eb-error">{error}</p> : <p className="eb-keys"><kbd>{MAC ? '⌘' : 'Ctrl'}</kbd> <kbd>↵</kbd> to add</p>}
          <div className="eb-actions">
            <button className="eb-btn" onClick={close}>
              Cancel
            </button>
            <button className="eb-btn eb-btn-primary" onClick={insert} disabled={busy}>
              {busy ? 'Drawing…' : 'Add to canvas'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

/** a quiet note of where the board stands: kept in this browser, or about to be */
function SaveNote() {
  const { state, at } = useStore(saveStatus)
  if (state === 'idle') return null
  const time = new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const text = state === 'error' ? 'Not saved: this browser is not keeping the board' : state === 'saved' ? `Saved in this browser · ${time}` : 'Saving…'
  return <div className={`eb-savenote eb-savenote-${state}`} role="status" aria-live="polite">{text}</div>
}

/** the board as it was: a snapshot at most every ten minutes of work, the last twenty kept */
function VersionsDialog() {
  const { versionsOpen } = useStore(uiStore)
  const [list, setList] = useState<{ key: string; savedAt: number; count: number }[] | null>(null)
  useEffect(() => { if (versionsOpen) { setList(null); void listSnapshots().then(setList) } }, [versionsOpen])
  if (!versionsOpen) return null
  const close = () => uiStore.set((u) => ({ ...u, versionsOpen: false }))
  return (
    <div className="eb-modal-backdrop" onPointerDown={close}>
      <div className="eb-modal eb-versions" role="dialog" aria-modal="true" aria-labelledby="eb-versions-title" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') close() }}>
        <header className="eb-modal-head">
          <div>
            <h2 id="eb-versions-title">Earlier versions</h2>
            <p>Kept in this browser, at most one every ten minutes of work. Restoring is a change like any other: undo takes it back.</p>
          </div>
          <button className="eb-modal-x" onClick={close} aria-label="Close">×</button>
        </header>
        <div className="eb-versions-list">
          {list === null ? <p className="eb-keys">Looking…</p> : list.length === 0 ? <p className="eb-keys">No earlier versions yet. The first is kept after ten minutes of drawing.</p> : (
            <ul>
              {list.map((v) => (
                <li key={v.key}>
                  <span><b>{new Date(v.savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</b> · {v.count} {v.count === 1 ? 'shape' : 'shapes'}</span>
                  <button className="eb-btn" onClick={async () => { if (await restoreSnapshot(v.key)) close() }}>Restore</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const presenting = useStore(presentation).active
  const phone = usePhoneLayout()
  const scene = useStore(sceneStore)
  const theme = scene.appState?.theme ?? 'light'
  const empty = !scene.elements?.some((e) => !e.isDeleted)

  useHandleLibrary({ excalidrawAPI: api, adapter: libraryAdapter })

  useEffect(() => {
    apiStore.set(api)
    attachApi(api)
    if (import.meta.env.DEV) (window as unknown as { __eb: unknown }).__eb = api
  }, [api])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const onChange = useCallback((elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
    pushScene(elements, appState)
    // Presenting changes opacities temporarily — never save that.
    if (!presentation.get().active) saveScene(elements, appState, files)
  }, [])

  return (
    <div className={presenting ? 'eb-root eb-presenting' : 'eb-root'}>
      <Excalidraw
        excalidrawAPI={setApi}
        initialData={initialData}
        onChange={onChange}
        viewModeEnabled={presenting}
        zenModeEnabled={presenting}
        name="Explainboard"
        UIOptions={{ canvasActions: { toggleTheme: true } }}
      >
        <MainMenu>
          <MainMenu.DefaultItems.LoadScene />
          <MainMenu.DefaultItems.SaveToActiveFile />
          <MainMenu.DefaultItems.Export />
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.Separator />
          <MainMenu.Item onSelect={() => uiStore.set((u) => ({ ...u, diagramOpen: true }))}>Text → diagram</MainMenu.Item>
          <MainMenu.Item onSelect={() => getApi().toggleSidebar({ name: ICON_SIDEBAR, force: true })}>Icon gallery</MainMenu.Item>
          <MainMenu.Item onSelect={startPresentation}>Present</MainMenu.Item>
          <MainMenu.Item onSelect={() => uiStore.set((u) => ({ ...u, versionsOpen: true }))}>Earlier versions…</MainMenu.Item>
          <MainMenu.Separator />
          <MainMenu.DefaultItems.CommandPalette />
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.DefaultItems.Help />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ToggleTheme />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
        </MainMenu>
        <WelcomeScreen>
          <WelcomeScreen.Center>
            <div className="eb-welcome">
              <Mark size={116} />
              <h1>Explainboard</h1>
              <p>sketch it · reveal it step by step · present it</p>
            </div>
            <WelcomeScreen.Center.Menu>
              <WelcomeScreen.Center.MenuItem icon={DOCK_ICONS.workflow} onSelect={() => uiStore.set((u) => ({ ...u, diagramOpen: true }))}>
                Text → diagram
              </WelcomeScreen.Center.MenuItem>
              <WelcomeScreen.Center.MenuItem icon={DOCK_ICONS.shapes} onSelect={() => getApi().toggleSidebar({ name: ICON_SIDEBAR, force: true })}>
                Icon gallery
              </WelcomeScreen.Center.MenuItem>
              <WelcomeScreen.Center.MenuItemLoadScene />
              <WelcomeScreen.Center.MenuItemHelp />
            </WelcomeScreen.Center.Menu>
          </WelcomeScreen.Center>
          <WelcomeScreen.Hints.ToolbarHint />
          <WelcomeScreen.Hints.MenuHint />
        </WelcomeScreen>
        <IconGallery />
      </Excalidraw>
      <CanvasOverlay />
      {!presenting && <Dock phone={phone} empty={empty} />}
      <PresentBar />
      <DiagramDialog />
      <VersionsDialog />
      {!presenting && <SaveNote />}
      <div className="eb-grain" aria-hidden="true" />
    </div>
  )
}
