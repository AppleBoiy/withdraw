/** Board persistence in IndexedDB (scene, images, library). Every call is best-effort. */
import type { AppState, BinaryFiles, LibraryItems } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'

const DB_NAME = 'explainboard'
const STORE = 'kv'

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

export async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    const d = await db()
    return await new Promise<T | undefined>((resolve, reject) => {
      const req = d.transaction(STORE).objectStore(STORE).get(key)
      req.onsuccess = () => resolve(req.result as T | undefined)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return undefined
  }
}

export async function idbSet(key: string, value: unknown) {
  try {
    const d = await db()
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    /* storage unavailable (private window etc.) — board just won't persist */
  }
}

interface SavedScene {
  elements: ExcalidrawElement[]
  files: BinaryFiles
  appState: Partial<AppState>
}

export async function loadScene() {
  const saved = await idbGet<SavedScene>('scene')
  if (!saved) return { appState: { viewBackgroundColor: '#F4ECDD' }, scrollToContent: true }
  return { elements: saved.elements, files: saved.files, appState: saved.appState }
}

let timer: number | undefined
export function saveScene(elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) {
  window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    const live = elements.filter((e) => !e.isDeleted)
    const used = new Set(live.map((e) => (e.type === 'image' ? e.fileId : null)).filter(Boolean))
    const keptFiles: BinaryFiles = {}
    for (const [id, f] of Object.entries(files)) if (used.has(id as never)) keptFiles[id] = f
    void idbSet('scene', {
      elements: live,
      files: keptFiles,
      appState: {
        viewBackgroundColor: appState.viewBackgroundColor,
        theme: appState.theme,
        scrollX: appState.scrollX,
        scrollY: appState.scrollY,
        zoom: appState.zoom,
        gridModeEnabled: appState.gridModeEnabled,
        currentItemFontFamily: appState.currentItemFontFamily,
        currentItemRoughness: appState.currentItemRoughness,
      },
    } satisfies SavedScene)
  }, 400)
}

export const libraryAdapter = {
  async load() {
    return { libraryItems: (await idbGet<LibraryItems>('library')) ?? [] }
  },
  async save({ libraryItems }: { libraryItems: LibraryItems }) {
    await idbSet('library', libraryItems)
  },
}
