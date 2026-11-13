/**
 * Board persistence, local-first: the board lives in this browser (IndexedDB) and survives refreshes, crashes,
 * closed tabs and several tabs open at once.
 *
 * How it works, after the way Excalidraw, tldraw and Figma's offline mode keep local work:
 *  - Change detection by version. Excalidraw calls onChange on every render; a save is only scheduled when the
 *    elements' versions (getSceneVersion) or the view settings actually changed. (Before, a plain 400 ms debounce
 *    was reset by that constant stream of onChange calls, so the board was almost never written.)
 *  - Debounced with a ceiling: written 300 ms after the last change, and at least every 1.5 s while you keep drawing.
 *  - Flushed when the page goes away: on pagehide and when the tab is hidden the board is written at once, and a
 *    synchronous copy goes to localStorage too, because an IndexedDB write started while a page unloads may not
 *    finish. On load the newer of the two wins.
 *  - Merged, never overwritten. Every element carries a version; a write reads what is stored and keeps, element by
 *    element, the newer one (deletions are kept as tombstones for a week so they win too). Two tabs can't erase
 *    each other's work, and a stale tab can't roll the board back.
 *  - Live across tabs. After a write the other tabs hear about it (BroadcastChannel) and merge it into their canvas
 *    (reconcileElements, without touching their undo history); a tab coming back into view does the same.
 *  - Nothing is written before the stored board has been loaded and shown, so an empty first render can't replace it.
 *  - Pictures are stored once each (file:<id>), not rewritten with every save.
 *  - Earlier versions: a snapshot at most every 10 minutes of work, the last 20 kept, to restore from the menu.
 *  - The browser is asked to keep the storage (navigator.storage.persist), so it isn't evicted under pressure.
 * Every storage call is best-effort: in a private window the board simply isn't kept.
 */
import { CaptureUpdateAction, getSceneVersion, reconcileElements, restoreElements } from '@excalidraw/excalidraw'
import type { AppState, BinaryFileData, BinaryFiles, ExcalidrawImperativeAPI, LibraryItems } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement, OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { createStore } from './state'

const DB_NAME = 'explainboard'
const STORE = 'kv'
const BOARD = 'board'
const BACKUP = 'explainboard:board'          // localStorage, written synchronously when the page goes away
const SCHEMA = 2
const DEBOUNCE = 300, MAX_WAIT = 1500
const TOMBSTONE_MS = 7 * 24 * 3600 * 1000
const SNAP_EVERY = 10 * 60 * 1000, SNAP_KEEP = 20

/* ───────── IndexedDB ───────── */
let dbPromise: Promise<IDBDatabase> | null = null
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}
const done = (r: IDBRequest | IDBTransaction) => new Promise<void>((res, rej) => {
  if ('oncomplete' in r) { r.oncomplete = () => res(); r.onerror = () => rej(r.error); r.onabort = () => rej(r.error) }
  else { (r as IDBRequest).onsuccess = () => res(); (r as IDBRequest).onerror = () => rej((r as IDBRequest).error) }
})
const result = <T>(r: IDBRequest) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result as T); r.onerror = () => rej(r.error) })

export async function idbGet<T>(key: string): Promise<T | undefined> {
  try { return await result<T | undefined>((await db()).transaction(STORE).objectStore(STORE).get(key)) } catch { return undefined }
}
export async function idbSet(key: string, value: unknown) {
  try { const tx = (await db()).transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(value, key); await done(tx) } catch { /* not kept */ }
}

/* ───────── what is stored ───────── */
type ViewState = Partial<Pick<AppState, 'viewBackgroundColor' | 'theme' | 'scrollX' | 'scrollY' | 'zoom' | 'gridModeEnabled' | 'currentItemFontFamily' | 'currentItemRoughness'>>
interface Board { schema: number; savedAt: number; lastSnap: number; elements: ExcalidrawElement[]; appState: ViewState }
interface Snapshot { savedAt: number; elements: ExcalidrawElement[]; appState: ViewState }
interface LegacyScene { elements: ExcalidrawElement[]; files: BinaryFiles; appState: ViewState }

const view = (a: AppState): ViewState => ({
  viewBackgroundColor: a.viewBackgroundColor, theme: a.theme, scrollX: a.scrollX, scrollY: a.scrollY, zoom: a.zoom,
  gridModeEnabled: a.gridModeEnabled, currentItemFontFamily: a.currentItemFontFamily, currentItemRoughness: a.currentItemRoughness,
})
const viewKey = (v: ViewState) => JSON.stringify([v.viewBackgroundColor, v.theme, v.gridModeEnabled, v.currentItemFontFamily, v.currentItemRoughness, Math.round(v.scrollX ?? 0), Math.round(v.scrollY ?? 0), v.zoom?.value])

/** element by element, the newer wins (Excalidraw's rule: higher version, then lower versionNonce); old tombstones go */
function merge(stored: readonly ExcalidrawElement[], ours: readonly ExcalidrawElement[]): ExcalidrawElement[] {
  const by = new Map<string, ExcalidrawElement>()
  for (const e of [...stored, ...ours]) {
    const o = by.get(e.id)
    if (!o || e.version > o.version || (e.version === o.version && e.versionNonce < o.versionNonce)) by.set(e.id, e)
  }
  const cutoff = Date.now() - TOMBSTONE_MS
  return [...by.values()]
    .filter((e) => !e.isDeleted || (e.updated ?? 0) > cutoff)
    .sort((a, b) => ((a.index ?? '') < (b.index ?? '') ? -1 : (a.index ?? '') > (b.index ?? '') ? 1 : 0))
}

/* ───────── status, for the little "Saved" note ───────── */
export const saveStatus = createStore<{ state: 'idle' | 'pending' | 'saving' | 'saved' | 'error'; at: number }>({ state: 'idle', at: 0 })

/* ───────── loading ───────── */
let ready = false                  // nothing is written until the stored board is on the canvas
let loadedVersion = -1
let lastVersion = -1, lastView = ''
const savedFiles = new Set<string>()

export async function loadScene() {
  try { void navigator.storage?.persist?.() } catch { /* not offered */ }
  let board = await idbGet<Board>(BOARD)
  if (!board) {                                 // a board saved by the first version of Explainboard
    const old = await idbGet<LegacyScene>('scene')
    if (old?.elements) {
      board = { schema: SCHEMA, savedAt: 0, lastSnap: 0, elements: old.elements, appState: old.appState ?? {} }
      for (const [id, f] of Object.entries(old.files ?? {})) await idbSet('file:' + id, f)
    }
  }
  // the copy taken as the page went away may be newer than the last IndexedDB write
  try {
    const raw = localStorage.getItem(BACKUP)
    const backup = raw ? (JSON.parse(raw) as Board) : null
    if (backup && backup.schema === SCHEMA && (!board || backup.savedAt > board.savedAt))
      board = { ...backup, lastSnap: board?.lastSnap ?? 0, elements: merge(board?.elements ?? [], backup.elements) }
  } catch { /* a broken backup is ignored */ }

  if (!board || !board.elements.some((e) => !e.isDeleted)) {
    ready = true
    return { appState: { viewBackgroundColor: '#F4ECDD', ...(board?.appState ?? {}) }, scrollToContent: !board }
  }
  const live = board.elements.filter((e) => !e.isDeleted)
  const files: BinaryFiles = {}
  for (const id of new Set(live.map((e) => (e.type === 'image' ? e.fileId : null)).filter(Boolean) as string[])) {
    const f = await idbGet<BinaryFileData>('file:' + id)
    if (f) { files[id] = f; savedFiles.add(id) }
  }
  loadedVersion = getSceneVersion(live)
  lastVersion = loadedVersion; lastView = viewKey(board.appState)
  // if the canvas never reports the loaded board (it should, at once), start saving anyway after a while
  setTimeout(() => { ready = true }, 4000)
  return { elements: live, files, appState: board.appState }
}

/* ───────── saving ───────── */
let pending: { elements: readonly ExcalidrawElement[]; appState: AppState; files: BinaryFiles } | null = null
let timer: number | undefined, firstPendingAt = 0, writing: Promise<void> | null = null

/** call on every onChange: it only schedules a write when something that is kept has changed */
export function saveScene(elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) {
  const version = getSceneVersion(elements), vk = viewKey(view(appState))
  if (!ready) {
    if (version === loadedVersion) ready = true   // the stored board is on the canvas: from now on, keep it
    else return
  }
  if (version === lastVersion && vk === lastView && !Object.keys(files).some((id) => !savedFiles.has(id))) return
  lastVersion = version; lastView = vk
  pending = { elements, appState, files }
  saveStatus.set({ state: 'pending', at: Date.now() })
  const now = Date.now()
  if (!firstPendingAt) firstPendingAt = now
  window.clearTimeout(timer)
  timer = window.setTimeout(() => void write(), Math.max(0, Math.min(DEBOUNCE, firstPendingAt + MAX_WAIT - now)))
}

async function write() {
  window.clearTimeout(timer)
  if (!pending) return writing ?? undefined
  if (writing) { await writing; return write() }
  const { elements, appState, files } = pending
  pending = null; firstPendingAt = 0
  saveStatus.set({ state: 'saving', at: Date.now() })
  writing = (async () => {
    try {
      const d = await db()
      const tx = d.transaction(STORE, 'readwrite'), st = tx.objectStore(STORE)
      const stored = await result<Board | undefined>(st.get(BOARD))
      const merged = merge(stored?.elements ?? [], elements)
      const now = Date.now()
      const board: Board = { schema: SCHEMA, savedAt: now, lastSnap: stored?.lastSnap ?? 0, elements: merged, appState: view(appState) }
      const live = merged.filter((e) => !e.isDeleted)
      if (live.length && now - board.lastSnap > SNAP_EVERY) {
        board.lastSnap = now
        st.put({ savedAt: now, elements: live, appState: board.appState } satisfies Snapshot, 'snap:' + new Date(now).toISOString())
      }
      st.put(board, BOARD)
      const used = new Set(live.map((e) => (e.type === 'image' ? e.fileId : null)).filter(Boolean) as string[])
      for (const [id, f] of Object.entries(files)) if (used.has(id) && !savedFiles.has(id)) { st.put(f, 'file:' + id); savedFiles.add(id) }
      await done(tx)
      try { localStorage.removeItem(BACKUP) } catch { /* fine */ }
      channel?.postMessage({ from: TAB, savedAt: now })
      saveStatus.set({ state: 'saved', at: now })
      void pruneSnapshots()
    } catch {
      saveStatus.set({ state: 'error', at: Date.now() })
    } finally {
      writing = null
    }
  })()
  return writing
}

/** the page is going away: write now, and keep a synchronous copy in case the write can't finish */
function flush() {
  if (!pending) return
  const { elements, appState } = pending
  try {
    const raw = JSON.stringify({ schema: SCHEMA, savedAt: Date.now(), lastSnap: 0, elements: [...elements], appState: view(appState) } satisfies Board)
    if (raw.length < 4_000_000) localStorage.setItem(BACKUP, raw)
  } catch { /* storage full or unavailable */ }
  void write()
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flush)
  window.addEventListener('beforeunload', flush)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); else void pull() })
}

/* ───────── other tabs ───────── */
const TAB = Math.random().toString(36).slice(2)
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('explainboard') : null
let apiRef: ExcalidrawImperativeAPI | null = null
export function attachApi(api: ExcalidrawImperativeAPI | null) { apiRef = api }
channel?.addEventListener('message', (ev) => { if (ev.data?.from !== TAB) void pull() })

/** bring in what other tabs saved, merged with what is on this canvas (never into the undo history) */
async function pull() {
  const api = apiRef
  if (!api || !ready) return
  const board = await idbGet<Board>(BOARD)
  if (!board) return
  const local = api.getSceneElementsIncludingDeleted() as readonly OrderedExcalidrawElement[]
  if (getSceneVersion(board.elements.filter((e) => !e.isDeleted)) === getSceneVersion(local.filter((e) => !e.isDeleted)) && board.elements.length === local.length) return
  const remote = restoreElements(board.elements, null) as never
  const elements = reconcileElements(local, remote, api.getAppState())
  const have = api.getFiles(), missing = elements.filter((e) => !e.isDeleted && e.type === 'image' && e.fileId && !have[e.fileId])
  const files: BinaryFileData[] = []
  for (const e of missing) { const f = await idbGet<BinaryFileData>('file:' + (e as { fileId: string }).fileId); if (f) { files.push(f); savedFiles.add(f.id) } }
  if (files.length) api.addFiles(files)
  lastVersion = getSceneVersion(elements)            // what came in is already stored: no need to write it back
  api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER })
}

/* ───────── earlier versions ───────── */
export async function listSnapshots(): Promise<{ key: string; savedAt: number; count: number }[]> {
  try {
    const st = (await db()).transaction(STORE).objectStore(STORE)
    const keys = (await result<IDBValidKey[]>(st.getAllKeys())).filter((k): k is string => typeof k === 'string' && k.startsWith('snap:')).sort().reverse()
    const out = []
    for (const key of keys) { const s = await idbGet<Snapshot>(key); if (s) out.push({ key, savedAt: s.savedAt, count: s.elements.length }) }
    return out
  } catch { return [] }
}
async function pruneSnapshots() {
  const snaps = await listSnapshots()
  if (snaps.length <= SNAP_KEEP) return
  try { const tx = (await db()).transaction(STORE, 'readwrite'); for (const s of snaps.slice(SNAP_KEEP)) tx.objectStore(STORE).delete(s.key); await done(tx) } catch { /* later */ }
}
/** put an earlier version back on the canvas; it is an ordinary change, so undo takes it back again */
export async function restoreSnapshot(key: string) {
  const api = apiRef, snap = await idbGet<Snapshot>(key)
  if (!api || !snap) return false
  const now = api.getSceneElementsIncludingDeleted()
  const keep = new Set(snap.elements.map((e) => e.id))
  // what was drawn since is deleted (with a newer version, so the deletion wins everywhere); the snapshot's
  // elements come back with newer versions too
  const bump = <T extends ExcalidrawElement>(e: T, del: boolean) => ({ ...e, isDeleted: del, version: Math.max(e.version, now.find((x) => x.id === e.id)?.version ?? 0) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() })
  const elements = [...now.filter((e) => !keep.has(e.id) && !e.isDeleted).map((e) => bump(e, true)), ...snap.elements.map((e) => bump(e, false))]
  api.updateScene({ elements: restoreElements(elements as never, null), captureUpdate: CaptureUpdateAction.IMMEDIATELY })
  return true
}

/* ───────── the shape library ───────── */
export const libraryAdapter = {
  async load() {
    return { libraryItems: (await idbGet<LibraryItems>('library')) ?? [] }
  },
  async save({ libraryItems }: { libraryItems: LibraryItems }) {
    await idbSet('library', libraryItems)
  },
}
