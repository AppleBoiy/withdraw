/**
 * Action dock: icons · text → diagram · library · flow · present.
 * Sits bottom-right next to Excalidraw's help button, so it never fights the
 * centered toolbar for space (that's what clipped "present" on narrower windows).
 * On phones it floats above Excalidraw's mobile footer.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { flowStore, toggleFlow } from './flow'
import { ICON_SIDEBAR } from './IconGallery'
import { startPresentation } from './presentation'
import { getApi, uiStore, useStore } from './state'
import { StepControls } from './steps'

/** Lucide icons (ISC), inlined so every browser draws the same thing. */
const Icon = ({ children, filled = false }: { children: ReactNode; filled?: boolean }) => (
  <svg
    className="eb-ico"
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth={filled ? 0 : 2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
)

const ICONS = {
  shapes: (
    <Icon>
      <path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <circle cx="17.5" cy="17.5" r="3.5" />
    </Icon>
  ),
  workflow: (
    <Icon>
      <rect width="8" height="8" x="3" y="3" rx="2" />
      <path d="M7 11v4a2 2 0 0 0 2 2h4" />
      <rect width="8" height="8" x="13" y="13" rx="2" />
    </Icon>
  ),
  book: (
    <Icon>
      <path d="M12 5v16" />
      <path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z" />
    </Icon>
  ),
  flow: (
    <Icon>
      <path d="M3 12h16" />
      <path d="m15 8 4 4-4 4" />
      <circle cx="6.5" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    </Icon>
  ),
  play: (
    <Icon filled>
      <path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" />
    </Icon>
  ),
}

/** Same breakpoints Excalidraw uses to switch to its phone layout. */
const PHONE_QUERY = '(max-width: 730px), (max-width: 1000px) and (max-height: 500px)'
export function usePhoneLayout() {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY)
    const onChange = () => setPhone(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return phone
}

/** The same icons, for the welcome screen's menu. */
export const DOCK_ICONS = ICONS

/** The secondary tools, each with a name and a line on what it does (shown on hover). */
type Tool = { key: string; icon: ReactNode; name: string; does: string; onClick: () => void; on?: boolean; primary?: boolean }

export function Dock({ phone, empty }: { phone: boolean; empty: boolean }) {
  const flow = useStore(flowStore)
  const tools: Tool[] = [
    { key: 'icons', icon: ICONS.shapes, name: 'Icons', does: '5,000 system & brand icons', onClick: () => getApi().toggleSidebar({ name: ICON_SIDEBAR }) },
    { key: 'diagram', icon: ICONS.workflow, name: 'Text → diagram', does: 'write a few lines, get a laid-out diagram', onClick: () => uiStore.set({ diagramOpen: true }) },
    { key: 'library', icon: ICONS.book, name: 'Library', does: 'AWS, GCP, K8s and other shape packs', onClick: () => getApi().toggleSidebar({ name: 'default', tab: 'library' }) },
    { key: 'flow', icon: ICONS.flow, name: flow ? 'Flow is on' : 'Flow', does: 'animate data along the arrows', onClick: toggleFlow, on: flow },
  ]
  // the hint shows whenever it fits: in full, or short beside the tools, or not at all if even that
  // would cover the welcome screen's title and menu
  const hintRef = useRef<HTMLDivElement>(null)
  const [hint, setHint] = useState<'full' | 'short' | 'none'>('full')
  useLayoutEffect(() => {
    if (!empty || phone) return
    const fits = (h: HTMLElement) => {
      const r = h.getBoundingClientRect()
      const covers = [...document.querySelectorAll('.eb-welcome, .excalidraw .welcome-screen-menu')].some((el) => {
        const c = el.getBoundingClientRect()
        return r.left < c.right + 16 && r.right > c.left - 16 && r.top < c.bottom + 8 && r.bottom > c.top - 8
      })
      return !covers && r.left > 8 && r.top > 8
    }
    const check = () => {
      const h = hintRef.current
      if (!h) return
      h.style.visibility = 'hidden'
      h.style.display = ''
      let best: 'full' | 'short' | 'none' = 'none'
      for (const v of ['full', 'short'] as const) {
        h.dataset.size = v
        if (fits(h)) { best = v; break }
      }
      h.dataset.size = best === 'none' ? 'full' : best
      h.style.visibility = ''
      setHint(best)
    }
    check()
    const late = setTimeout(check, 400) // the welcome screen mounts a moment after us
    addEventListener('resize', check)
    return () => { clearTimeout(late); removeEventListener('resize', check) }
  }, [empty, phone])
  const tip = (t: Tool) => ({ 'data-tip': t.name, 'data-does': t.does, 'aria-label': `${t.name}: ${t.does}` })
  return (
    <div className={phone ? 'eb-dock eb-dock-phone' : 'eb-dock'}>
      <StepControls />
      {empty && !phone && (
        // like the hints Excalidraw draws at the top, one for these tools until the first stroke
        <div className="eb-dock-hint" aria-hidden="true" ref={hintRef} data-size={hint === 'none' ? 'full' : hint} style={hint === 'none' ? { display: 'none' } : undefined}>
          <span className="eb-hint-full">Explain tools: icons, diagrams<br />from text, flow &amp; present</span>
          <span className="eb-hint-short">explain tools</span>
          <svg viewBox="0 0 60 64">
            <path d="M6 4C22 10 40 26 44 52" />
            <path d="M36 46l8 9 6-11" />
          </svg>
        </div>
      )}
      <div className="eb-tools" role="toolbar" aria-label="Explain tools">
        {tools.map((t) => (
          <button key={t.key} className={t.on ? 'eb-tool eb-on' : 'eb-tool'} onClick={t.onClick} aria-pressed={t.key === 'flow' ? !!t.on : undefined} {...tip(t)}>
            {t.icon}
          </button>
        ))}
        <span className="eb-tools-sep" aria-hidden="true" />
        <button className="eb-tool eb-tool-present" onClick={startPresentation} data-tip="Present" data-does="frames become slides · → next, Esc exit" aria-label="Present: frames become slides">
          {ICONS.play}
          <span>present</span>
        </button>
      </div>
    </div>
  )
}
