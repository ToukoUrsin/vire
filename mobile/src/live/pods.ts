// The AirPods, as the whole app sees them: are they in, how many samples a second, the newest head frame and heart rate.
// Inside the iPhone app they come through the app itself; in Chrome on a Mac through the Vire Ears helper.
import { useSyncExternalStore } from 'react'
import type { EarModel2 } from '@shared/ear'
import { createSense } from '@web/sense'
import type { HeadFrame, Sense } from '@web/sense/types'
import { connectEars, onEars, onNative, postNative } from '@web/sense/native'
import { loadEarModel, saveEarModel } from '@web/tune/ear'

export const sense: Sense = createSense()
export const inApp = (): boolean => !!(window as unknown as { webkit?: { messageHandlers?: { vire?: unknown } } }).webkit?.messageHandlers?.vire

/** a phone or tablet browser, outside the Vire iPhone app: the Mac helper cannot be here, so there is nothing to connect */
export const onPhone = (): boolean => !inApp() && (navigator.maxTouchPoints > 0 || !!window.matchMedia?.('(pointer: coarse)').matches)

export interface Pods {
  /** inside the iPhone app */
  app: boolean
  /** the Mac helper answered */
  helper: boolean
  /** frames are arriving */
  on: boolean
  hz: number
  /** beats a minute from the AirPods, and how old that reading is in seconds */
  bpm: number | null
  bpmAge: number | null
  permission: string | null
  route: string | null
  error: string | null
}

let state: Pods = { app: inApp(), helper: false, on: false, hz: 0, bpm: null, bpmAge: null, permission: null, route: null, error: null }
const subs = new Set<() => void>()
const set = (p: Partial<Pods>) => {
  const next = { ...state, ...p }
  if ((Object.keys(next) as Array<keyof Pods>).every((k) => next[k] === state[k])) return
  state = next
  subs.forEach((f) => f())
}

let times: number[] = []
let lastHead: HeadFrame | null = null
let bpmAt = 0
const headSubs = new Set<(h: HeadFrame) => void>()

sense.on('head', (h) => {
  if (h.source !== 'airpods') return
  lastHead = h
  times.push(performance.now())
  for (const f of headSubs) f(h)
})
sense.on('pulse', (p) => {
  if (p.source !== 'airpods' || p.bpm == null) return
  bpmAt = performance.now()
  set({ bpm: Math.round(p.bpm), bpmAge: 0 })
})
onNative((m) => {
  if (m.k === 'status') set({ permission: m.permission ?? state.permission, route: m.route ?? state.route, error: m.error ?? null })
})
onEars((i) => {
  set({ helper: i.state === 'on', permission: i.permission ?? state.permission, error: i.error })
  if (i.state === 'on') postNative({ cmd: 'start' })
})
setInterval(() => {
  const now = performance.now()
  times = times.filter((t) => now - t < 2000)
  const hz = Math.round(times.length / 2)
  set({ hz, on: hz > 0, bpmAge: state.bpm == null ? null : Math.round((now - bpmAt) / 1000) })
}, 500)

/** ask for the AirPods. In the iPhone app that is all it takes; on a Mac it looks for the helper first. */
export async function wakePods(): Promise<boolean> {
  if (inApp()) {
    postNative({ cmd: 'start' })
    return true
  }
  const ok = await connectEars()
  if (ok) postNative({ cmd: 'start' })
  return ok
}
// inside the app there is nothing to press: start listening at once
if (inApp()) postNative({ cmd: 'start' })

export const usePods = (): Pods =>
  useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => state,
  )
export const onHead = (f: (h: HeadFrame) => void): (() => void) => {
  headSubs.add(f)
  return () => headSubs.delete(f)
}
export const newestHead = (): HeadFrame | null => (lastHead && performance.now() - (times[times.length - 1] ?? 0) < 1000 ? lastHead : null)

// ---- this person's own model, kept on this device ----
let model: EarModel2 | null = loadEarModel()
const modelSubs = new Set<() => void>()
export function useModel(): EarModel2 | null {
  return useSyncExternalStore(
    (f) => {
      modelSubs.add(f)
      return () => modelSubs.delete(f)
    },
    () => model,
  )
}
export function keepModel(m: EarModel2 | null, store = true): void {
  if (store && m && m.shell !== 'sim') saveEarModel(m)
  model = m
  modelSubs.forEach((f) => f())
}
export const currentModel = (): EarModel2 | null => model

/** keep the screen on while something is measuring */
export async function keepAwake(): Promise<() => void> {
  const wl = (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock
  try {
    const lock = await wl?.request('screen')
    return () => void lock?.release().catch(() => {})
  } catch {
    return () => {}
  }
}
