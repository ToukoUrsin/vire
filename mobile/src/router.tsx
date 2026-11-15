// A hash router that moves like an iPhone: a deeper screen pushes in from the right, back pops it,
// tabs cross-fade, a flow (train, a practice) rises from the bottom. The browser's own history is the stack.
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'

export interface Loc {
  path: string
  idx: number
}
export type Move = 'none' | 'push' | 'pop' | 'fade' | 'rise' | 'drop'
export interface RouteMeta {
  /** one of the five tab roots */
  tab?: string
  root?: boolean
  /** a flow that covers the tab bar and rises from the bottom */
  flow?: boolean
}

const HOME = '/today'
const idxOf = (): number | null => (history.state as { idx?: number } | null)?.idx ?? null
const pathOf = (): string => {
  const raw = location.hash.replace(/^#/, '')
  return raw.startsWith('/') ? raw : HOME
}

if (idxOf() == null) history.replaceState({ idx: 0 }, '')
let cur: Loc = { path: pathOf(), idx: idxOf() ?? 0 }
let hint: Move | null = null
const subs = new Set<() => void>()
function emit(): void {
  const next = { path: pathOf(), idx: idxOf() ?? 0 }
  if (next.path === cur.path && next.idx === cur.idx) return
  cur = next
  subs.forEach((f) => f())
}
// a plain link (#/x) arrives with no state of ours: it is one step deeper
function arrived(): void {
  if (idxOf() == null) history.replaceState({ idx: cur.idx + 1 }, '')
  emit()
}
window.addEventListener('popstate', arrived)
window.addEventListener('hashchange', arrived)

export function go(path: string, opts: { replace?: boolean; move?: Move } = {}): void {
  if (path === cur.path) return
  hint = opts.move ?? null
  if (opts.replace) history.replaceState({ idx: cur.idx }, '', `#${path}`)
  else history.pushState({ idx: cur.idx + 1 }, '', `#${path}`)
  emit()
}

/** one step back; opened straight on a deep link there is nothing behind it, so go to its parent instead */
export function back(fallback: string = HOME): void {
  if (cur.idx > 0) history.back()
  else go(fallback, { replace: true, move: 'pop' })
}

export function useLoc(): Loc {
  return useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => cur,
  )
}

interface Layer {
  key: string
  path: string
  cls: string
  move: Move
}
const RouteCtx = createContext<{ path: string; move: Move }>({ path: HOME, move: 'none' })
export const useRoute = () => useContext(RouteCtx)

const IN: Record<Move, string> = { none: '', push: 'is-push-in', pop: 'is-pop-in', fade: 'is-fade-in', rise: 'is-rise-in', drop: '' }
const OUT: Record<Move, string> = { none: '', push: 'is-push-out', pop: 'is-pop-out', fade: 'is-fade-out', rise: '', drop: 'is-rise-out' }

export function Stack({ render, meta }: { render: (path: string) => ReactNode; meta: (path: string) => RouteMeta }) {
  const loc = useLoc()
  const prev = useRef<Loc>(loc)
  const [layers, setLayers] = useState<Layer[]>(() => [{ key: `${loc.path}@${loc.idx}`, path: loc.path, cls: '', move: 'none' }])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useLayoutEffect(() => {
    const from = prev.current
    if (from.path === loc.path && from.idx === loc.idx) return
    prev.current = loc
    const a = meta(from.path)
    const b = meta(loc.path)
    let move: Move
    if (hint) move = hint
    else if (a.root && b.root) move = 'fade'
    else if (loc.idx > from.idx) move = b.flow ? 'rise' : 'push'
    else if (loc.idx < from.idx) move = a.flow ? 'drop' : 'pop'
    else move = 'fade'
    hint = null
    setLayers((ls) => {
      const last = ls[ls.length - 1]
      return [
        { ...last, cls: OUT[move] },
        { key: `${loc.path}@${loc.idx}`, path: loc.path, cls: IN[move], move },
      ]
    })
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setLayers((ls) => [{ ...ls[ls.length - 1], cls: '' }]), 520)
  }, [loc, meta])
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  return (
    <div className="stack">
      {layers.map((l, i) => (
        <div key={l.key} className={`layer ${l.cls}`} aria-hidden={i < layers.length - 1 || undefined} inert={i < layers.length - 1 || undefined}>
          <RouteCtx.Provider value={{ path: l.path, move: l.move }}>{render(l.path)}</RouteCtx.Provider>
        </div>
      ))}
    </div>
  )
}

/** where each screen was scrolled to, so coming back lands where you left */
const scrolls = new Map<string, number>()
export function useScrollMemory(ref: { current: HTMLElement | null }): void {
  const { path, move } = useRoute()
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (move === 'pop' || move === 'drop' || move === 'fade' || move === 'none') el.scrollTop = scrolls.get(path) ?? 0
    const on = () => scrolls.set(path, el.scrollTop)
    el.addEventListener('scroll', on, { passive: true })
    return () => el.removeEventListener('scroll', on)
  }, [path, move, ref])
}
