/**
 * Icon catalog: Lucide (generic system icons, ISC) + Simple Icons (brand logos, CC0).
 * Both packs are loaded lazily the first time the gallery opens.
 */
import { CaptureUpdateAction, convertToExcalidrawElements, viewportCoordsToSceneCoords } from '@excalidraw/excalidraw'
import type { BinaryFileData, DataURL } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement, FileId } from '@excalidraw/excalidraw/element/types'
import { getApi, newId } from './state'

export type IconPack = 'system' | 'brand'

export interface IconEntry {
  /** `system:database` or `brand:postgresql` */
  id: string
  name: string
  pack: IconPack
  /** lower-case text searched by the gallery */
  search: string
  /** brand color without '#', for brand icons */
  hex?: string
  /** raw SVG body (Lucide: full svg markup, Simple Icons: path data) */
  body: string
}

export const INK = '#231B14'

/** Shown first when the search box is empty. */
export const ESSENTIALS = [
  'system:user', 'system:users', 'system:monitor', 'system:smartphone', 'system:globe',
  'system:server', 'system:database', 'system:hard-drive', 'system:cloud', 'system:container',
  'system:layers', 'system:network', 'system:workflow', 'system:git-branch', 'system:cpu',
  'system:bot', 'system:brain', 'system:sparkles', 'system:message-square', 'system:search',
  'system:file-text', 'system:files', 'system:folder', 'system:table', 'system:list-ordered',
  'system:lock', 'system:key-round', 'system:shield-check', 'system:mail', 'system:bell',
  'system:activity', 'system:chart-line', 'system:gauge', 'system:zap', 'system:timer',
  'system:settings', 'system:wrench', 'system:inbox', 'system:send', 'system:webhook',
  'brand:python', 'brand:fastapi', 'brand:docker', 'brand:kubernetes', 'brand:postgresql',
  'brand:redis', 'brand:apachekafka', 'brand:neo4j', 'brand:anthropic', 'brand:googlegemini',
  'brand:huggingface', 'brand:langchain', 'brand:github', 'brand:githubactions', 'brand:googlecloud',
  'brand:vercel', 'brand:nginx', 'brand:react', 'brand:nextdotjs', 'brand:elasticsearch',
]

let catalog: Promise<IconEntry[]> | null = null

export function loadCatalog(): Promise<IconEntry[]> {
  catalog ??= Promise.all([loadSystem(), loadBrands()]).then(([a, b]) => [...a, ...b])
  return catalog
}

async function loadSystem(): Promise<IconEntry[]> {
  const [mod, tags] = await Promise.all([
    import('lucide-static') as Promise<Record<string, unknown>>,
    import('lucide-static/tags.json').then((m) => m.default as Record<string, string[]>),
  ])
  const out: IconEntry[] = []
  for (const [key, raw] of Object.entries(mod)) {
    const svg = typeof raw === 'string' ? raw.trim() : ''
    if (!svg.startsWith('<svg')) continue
    const name = key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z])([A-Z][a-z])/g, '$1-$2').toLowerCase()
    out.push({
      id: `system:${name}`,
      name: name.replace(/-/g, ' '),
      pack: 'system',
      search: `${name} ${(tags[name] ?? []).join(' ')}`.toLowerCase(),
      body: svg,
    })
  }
  return out
}

async function loadBrands(): Promise<IconEntry[]> {
  const mod = (await import('simple-icons')) as unknown as Record<string, { title: string; slug: string; hex: string; path: string }>
  const out: IconEntry[] = []
  for (const icon of Object.values(mod)) {
    if (!icon || typeof icon !== 'object' || !('slug' in icon)) continue
    out.push({
      id: `brand:${icon.slug}`,
      name: icon.title,
      pack: 'brand',
      search: `${icon.title} ${icon.slug}`.toLowerCase(),
      hex: icon.hex,
      body: icon.path,
    })
  }
  return out
}

/** Find an icon by `system:x`, `brand:x`, or a bare name (brand first, then system). */
export async function findIcon(ref: string): Promise<IconEntry | undefined> {
  const all = await loadCatalog()
  const key = ref.toLowerCase()
  if (key.includes(':')) return all.find((i) => i.id === key)
  return all.find((i) => i.id === `brand:${key}`) ?? all.find((i) => i.id === `system:${key}`)
}

/** `color`: 'brand' keeps the logo color; anything else is used as a CSS color. */
export function iconSvg(icon: IconEntry, color: string, size = 96): string {
  if (icon.pack === 'brand') {
    const fill = color === 'brand' ? `#${icon.hex}` : color
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}"><path fill="${fill}" d="${icon.body}"/></svg>`
  }
  const stroke = color === 'brand' ? INK : color
  return icon.body
    .replace(/\s(width|height)="24"/g, ` $1="${size}"`)
    .replace(/currentColor/g, stroke)
    .replace(/\sclass="[^"]*"/, '')
}

function toDataURL(svg: string): DataURL {
  const bytes = new TextEncoder().encode(svg)
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return `data:image/svg+xml;base64,${btoa(bin)}` as DataURL
}

/** Register the icon as an Excalidraw file and return its id. */
export function ensureIconFile(icon: IconEntry, color: string): FileId {
  const id = `icon-${icon.id.replace(':', '-')}-${color.replace('#', '')}` as FileId
  const api = getApi()
  if (!api.getFiles()[id]) {
    const file: BinaryFileData = {
      id,
      mimeType: 'image/svg+xml',
      dataURL: toDataURL(iconSvg(icon, color)),
      created: Date.now(),
    }
    api.addFiles([file])
  }
  return id
}

/** Insert an icon (optionally with a caption) at the center of the viewport and select it. */
export function insertIcon(icon: IconEntry, opts: { color: string; label: boolean; size?: number }) {
  const api = getApi()
  const appState = api.getAppState()
  const size = opts.size ?? 64
  // Aim for the middle of the visible canvas (the sidebar covers the right edge when open).
  const sidebar = appState.openSidebar ? (document.querySelector('.excalidraw .sidebar')?.clientWidth ?? 0) : 0
  const center = viewportCoordsToSceneCoords(
    { clientX: appState.offsetLeft + (appState.width - sidebar) / 2, clientY: appState.offsetTop + appState.height / 2 },
    appState,
  )
  const fileId = ensureIconFile(icon, opts.color)
  const groupId = newId('g')
  const imageId = newId('icon')
  const textId = newId('t')
  const x = center.x - size / 2
  const y = center.y - size / 2

  const created = convertToExcalidrawElements(
    [
      { type: 'image', id: imageId, x, y, width: size, height: size, fileId, groupIds: opts.label ? [groupId] : [] },
      ...(opts.label
        ? [
            {
              type: 'text' as const,
              id: textId,
              x,
              y: y + size + 8,
              text: icon.name,
              fontSize: 16,
              textAlign: 'center' as const,
              strokeColor: INK,
              groupIds: [groupId],
            },
          ]
        : []),
    ],
    { regenerateIds: false },
  ).map((el) => (el.type === 'text' ? { ...el, x: center.x - el.width / 2 } : el)) as ExcalidrawElement[]

  // Drop it into whichever frame sits under the viewport center.
  const frame = api
    .getSceneElements()
    .filter((e) => e.type === 'frame')
    .reverse()
    .find((f) => center.x >= f.x && center.x <= f.x + f.width && center.y >= f.y && center.y <= f.y + f.height)
  const placed = created.map((el) => (frame ? { ...el, frameId: frame.id } : el))

  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...placed],
    appState: {
      selectedElementIds: Object.fromEntries(placed.map((e) => [e.id, true as const])),
      selectedGroupIds: opts.label ? { [groupId]: true } : {},
    },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  })
  rememberRecent(icon.id)
}

const RECENT_KEY = 'explainboard:recent-icons'
export function getRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
  } catch {
    return []
  }
}
function rememberRecent(id: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...getRecent().filter((r) => r !== id)].slice(0, 24)))
  } catch {
    /* ignore */
  }
}
