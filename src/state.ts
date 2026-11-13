/** Tiny shared state: the Excalidraw API handle plus a live snapshot of the scene. */
import { useSyncExternalStore } from 'react'
import type { AppState, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'

export function createStore<T>(initial: T) {
  let value = initial
  const subs = new Set<() => void>()
  return {
    get: () => value,
    set(next: T | ((prev: T) => T)) {
      value = typeof next === 'function' ? (next as (prev: T) => T)(value) : next
      subs.forEach((f) => f())
    },
    subscribe(f: () => void) {
      subs.add(f)
      return () => {
        subs.delete(f)
      }
    },
  }
}

export type Store<T> = ReturnType<typeof createStore<T>>

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get)
}

export const apiStore = createStore<ExcalidrawImperativeAPI | null>(null)

export function getApi(): ExcalidrawImperativeAPI {
  const api = apiStore.get()
  if (!api) throw new Error('Canvas is not ready yet')
  return api
}

/** Latest elements + app state, refreshed at most once per animation frame. */
export const sceneStore = createStore<{
  elements: readonly ExcalidrawElement[]
  appState: AppState | null
}>({ elements: [], appState: null })

let pending: { elements: readonly ExcalidrawElement[]; appState: AppState } | null = null
export function pushScene(elements: readonly ExcalidrawElement[], appState: AppState) {
  if (!pending) {
    requestAnimationFrame(() => {
      if (pending) sceneStore.set(pending)
      pending = null
    })
  }
  pending = { elements, appState }
}

export const uiStore = createStore({ diagramOpen: false, versionsOpen: false })

export function newId(prefix = 'eb') {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
}
