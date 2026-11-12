/** Icon gallery sidebar: search ~5k system + brand icons, click to drop on the canvas. */
import { useEffect, useMemo, useState } from 'react'
import { Sidebar } from '@excalidraw/excalidraw'
import { ESSENTIALS, getRecent, iconSvg, INK, insertIcon, loadCatalog, type IconEntry } from './icons'
import { getApi } from './state'

export const ICON_SIDEBAR = 'eb-icons'
const LIMIT = 240

type Filter = 'all' | 'system' | 'brand'

export function IconGallery() {
  const [catalog, setCatalog] = useState<IconEntry[] | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [brandColor, setBrandColor] = useState(true)
  const [label, setLabel] = useState(true)
  const [recent, setRecent] = useState<string[]>(getRecent)
  const [docked, setDocked] = useState(false)

  useEffect(() => {
    loadCatalog().then(setCatalog, (e) => setError(String(e)))
  }, [])

  const byId = useMemo(() => new Map((catalog ?? []).map((i) => [i.id, i])), [catalog])

  const results = useMemo(() => {
    if (!catalog) return []
    const q = query.trim().toLowerCase()
    const pool = catalog.filter((i) => filter === 'all' || i.pack === filter)
    if (!q) return pool
    const words = q.split(/\s+/)
    const hits = pool.filter((i) => words.every((w) => i.search.includes(w)))
    // Exact / prefix name matches first.
    const rank = (i: IconEntry) => (i.name.toLowerCase() === q ? 0 : i.name.toLowerCase().startsWith(q) ? 1 : 2)
    return hits.sort((a, b) => rank(a) - rank(b))
  }, [catalog, query, filter])

  const color = brandColor ? 'brand' : INK
  const add = (icon: IconEntry) => {
    insertIcon(icon, { color, label })
    setRecent(getRecent())
  }

  const pick = (ids: string[]) =>
    ids.map((id) => byId.get(id)).filter((i): i is IconEntry => !!i && (filter === 'all' || i.pack === filter))

  return (
    <Sidebar name={ICON_SIDEBAR} docked={docked} onDock={setDocked} className="eb-gallery">
      <Sidebar.Header>
        <div className="eb-gallery-title">
          <span className="eb-hanko">印</span> Icons
        </div>
      </Sidebar.Header>
      <div className="eb-gallery-body">
        <input
          className="eb-search"
          type="search"
          placeholder="Search postgres, kafka, server, llm…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          autoFocus
        />
        <div className="eb-chips">
          {(['all', 'system', 'brand'] as const).map((f) => (
            <button key={f} className={filter === f ? 'eb-chip on' : 'eb-chip'} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f === 'system' ? 'System' : 'Brands'}
            </button>
          ))}
        </div>
        <div className="eb-toggles">
          <label>
            <input type="checkbox" checked={brandColor} onChange={(e) => setBrandColor(e.target.checked)} /> Brand colors
          </label>
          <label>
            <input type="checkbox" checked={label} onChange={(e) => setLabel(e.target.checked)} /> Add caption
          </label>
        </div>

        {error && <p className="eb-error">Couldn't load icons: {error}</p>}
        {!catalog && !error && <p className="eb-muted">Loading ~5,000 icons…</p>}

        {catalog && !query && (
          <>
            {recent.length > 0 && <IconGrid title="Recent" icons={pick(recent)} color={color} onPick={add} />}
            <IconGrid title="Essentials" icons={pick(ESSENTIALS)} color={color} onPick={add} />
            <p className="eb-muted">Type to search all {catalog.length.toLocaleString()} icons.</p>
          </>
        )}
        {catalog && query && (
          <>
            <IconGrid
              title={`${results.length.toLocaleString()} found`}
              icons={results.slice(0, LIMIT)}
              color={color}
              onPick={add}
            />
            {results.length > LIMIT && <p className="eb-muted">Showing the first {LIMIT}. Refine the search for more.</p>}
            {results.length === 0 && <p className="eb-muted">Nothing matches “{query}”.</p>}
          </>
        )}

        <div className="eb-gallery-foot">
          <p>Need cloud architecture shapes (AWS, GCP, Azure, K8s)?</p>
          <button className="eb-link" onClick={() => getApi().toggleSidebar({ name: 'default', tab: 'library', force: true })}>
            Open the shape library → Browse libraries
          </button>
        </div>
      </div>
    </Sidebar>
  )
}

function IconGrid({
  title,
  icons,
  color,
  onPick,
}: {
  title: string
  icons: IconEntry[]
  color: string
  onPick: (icon: IconEntry) => void
}) {
  if (icons.length === 0) return null
  return (
    <section className="eb-grid-section">
      <h4>{title}</h4>
      <div className="eb-grid">
        {icons.map((icon) => (
          <button
            key={icon.id}
            className="eb-icon"
            title={`${icon.name}  ·  icon:${icon.id.split(':')[1]}`}
            onClick={() => onPick(icon)}
            dangerouslySetInnerHTML={{ __html: iconSvg(icon, color, 28) }}
          />
        ))}
      </div>
    </section>
  )
}
