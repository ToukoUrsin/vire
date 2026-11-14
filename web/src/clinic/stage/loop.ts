// One requestAnimationFrame loop for everything on the stage that moves, and a canvas hook that keeps its
// backing store at the element's size. Painters never touch React state.
import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

type Fn = (now: number, dt: number) => void
const fns = new Set<Fn>()
let raf = 0
let last = 0
/** smoothed frames per second of the stage loop, for the ?debug=1 readout */
export const loopStats = { fps: 60, worst: 0, /** ms of painting per frame (the stage's own painters) */ cost: 0 }
if (typeof window !== 'undefined') (window as unknown as { __stageLoop?: typeof loopStats }).__stageLoop = loopStats

function tick(now: number) {
  raf = requestAnimationFrame(tick)
  const raw = last ? now - last : 16.7
  const dt = Math.min(100, raw)
  last = now
  loopStats.fps += (1000 / Math.max(1, raw) - loopStats.fps) * 0.05
  loopStats.worst = Math.max(loopStats.worst * 0.995, raw)
  const t0 = performance.now()
  for (const f of fns) {
    try {
      f(now, dt)
    } catch (e) {
      // one broken painter must not freeze the rest of the screen
      fns.delete(f)
      console.error('stage painter stopped', e)
    }
  }
  loopStats.cost += (performance.now() - t0 - loopStats.cost) * 0.05
}

export function onFrame(fn: Fn): () => void {
  fns.add(fn)
  if (fns.size === 1) {
    last = 0
    raf = requestAnimationFrame(tick)
  }
  return () => {
    fns.delete(fn)
    if (!fns.size) cancelAnimationFrame(raf)
  }
}

export interface Surface {
  ctx: CanvasRenderingContext2D
  /** size in CSS pixels */
  w: number
  h: number
  dpr: number
  /** the canvas element's computed font size in px: canvas text scales with the layout */
  em: number
}

/**
 * A canvas painted every animation frame. `paint` draws in CSS pixels (the context is already scaled).
 * The latest `paint` closure is always the one called, so it may read fresh props without re-subscribing.
 */
export function useCanvas(paint: (s: Surface, now: number, dt: number) => void): RefObject<HTMLCanvasElement | null> {
  const ref = useRef<HTMLCanvasElement>(null)
  const fn = useRef(paint)
  fn.current = paint
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const s: Surface = { ctx, w: 1, h: 1, dpr: 1, em: 16 }
    const fit = () => {
      const r = cv.getBoundingClientRect()
      s.dpr = Math.min(2, window.devicePixelRatio || 1)
      s.w = Math.max(1, r.width)
      s.h = Math.max(1, r.height)
      s.em = parseFloat(getComputedStyle(cv).fontSize) || 16
      const pw = Math.round(s.w * s.dpr)
      const ph = Math.round(s.h * s.dpr)
      if (cv.width !== pw) cv.width = pw
      if (cv.height !== ph) cv.height = ph
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(cv)
    const off = onFrame((now, dt) => {
      if (s.w < 4 || s.h < 4) return
      ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0)
      fn.current(s, now, dt)
    })
    return () => {
      off()
      ro.disconnect()
    }
  }, [])
  return ref
}

/** a running mean over +-halfMs: a camera pulse arrives in small steps, and a heart rate does not move in steps */
export function eased(t: number[], v: number[], halfMs: number): number[] {
  const out = new Array<number>(v.length)
  let a = 0
  let b = 0
  let sum = 0
  for (let i = 0; i < v.length; i++) {
    while (b < v.length && t[b] <= t[i] + halfMs) sum += v[b++]
    while (t[a] < t[i] - halfMs) sum -= v[a++]
    out[i] = sum / (b - a)
  }
  return out
}

/** the stage palette, read once from the theme tokens */
export interface Palette {
  ink: string
  ink2: string
  stage: string
  smile: string
  voice: string
  heart: string
  move: string
  ember: string
}
let pal: Palette | null = null
export function palette(): Palette {
  if (pal) return pal
  const css = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  pal = {
    ink: v('--stage-ink', '#f3ece0'),
    ink2: v('--stage-ink-2', '#a79f90'),
    stage: v('--stage', '#14110d'),
    smile: v('--ch-smile', '#e9a23b'),
    voice: v('--ch-voice', '#2a9d8f'),
    heart: v('--ch-heart', '#d1495b'),
    move: v('--ch-move', '#5b6abf'),
    ember: v('--ember', '#e4572e'),
  }
  return pal
}

/** `#rrggbb` -> `rgba(r,g,b,a)` */
export function rgba(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
