// What every dose shares: its name and one-line description, the stage shell, the minute's clock,
// and the small canvas helpers the live lines are drawn with.
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { DoseKind } from '@shared/types'
import { IconClose } from '../icons'

export { clamp, median, wrap180 } from './num'

export interface DoseProps {
  /**
   * The dose ran (to the end, or the person tapped "I'm done"): go on to the mini ping.
   * `line` is the closing sentence the person just read, for the result screen to say again.
   */
  onFinish(metrics: Record<string, number>, line: string): void
  /** leave without recording anything */
  onLeave(): void
}

/** every dose is one minute, so the quiet one is a fair comparison */
export const DOSE_SECONDS = 60
/** the shortest an end line stays up before the mini ping takes over */
export const END_HOLD_MS = 2000
const END_HOLD_MAX_MS = 6000
/** an unhurried read: about three words a second */
const MS_A_WORD = 300

/** how long an end line stays up: long enough to read it once, slowly */
export function endHoldMs(line: string): number {
  const words = line.trim().split(/\s+/).length
  return Math.min(END_HOLD_MAX_MS, Math.max(END_HOLD_MS, words * MS_A_WORD))
}

export const DOSE_INFO: Record<DoseKind, { title: string; short: string; time: string; line: string; needs: string }> = {
  breathe: {
    title: 'Slow breathing',
    short: 'Breathe',
    time: '1 minute',
    line: 'Three paces, and your heart shows which suits you.',
    needs: 'Sit comfortably and hold the phone where it can see your face.',
  },
  smile: {
    title: 'Smile along',
    short: 'Smile along',
    time: '1 minute',
    line: 'Four laughs. The last is the one your face answered most.',
    needs: 'Hold the phone where it can see your face. Just listen.',
  },
  forest: {
    title: 'The forest',
    short: 'Forest',
    time: '1 minute',
    line: 'Three birds call from where you haven’t looked yet.',
    needs: 'Best with earbuds. Hold the phone up in front of you.',
  },
  walk: {
    title: 'A walk with a beat',
    short: 'Walk',
    time: '1 minute',
    line: 'A beat at your own pace that moves ahead while you keep up.',
    needs: 'Earbuds in, phone in your hand or pocket.',
  },
  reach: {
    title: 'Reach out',
    short: 'Reach',
    time: '1 minute',
    line: 'Ten seconds of your voice for someone you like.',
    needs: 'Hello is enough. Nothing is uploaded.',
  },
  wait: {
    title: 'Just wait',
    short: 'Just wait',
    time: '1 minute',
    line: 'One quiet minute. Nothing asked, nothing measured.',
    needs: 'Set the phone down and let the minute pass.',
  },
}

export function DoseShell({
  title,
  count,
  ended,
  onDone,
  onLeave,
  children,
}: {
  title: string
  /** what is left, bottom left ("0:42", "2 of 3 found") */
  count: string
  ended: boolean
  onDone(): void
  onLeave(): void
  children: ReactNode
}) {
  return (
    <div className="va-stage va-dose" data-ended={ended || undefined}>
      <div className="va-stage-top">
        <p className="va-dose-title">{title}</p>
        <button className="va-icon-btn va-on-stage" onClick={onLeave} aria-label="Stop and go back">
          <IconClose />
        </button>
      </div>
      {children}
      <div className="va-dose-foot">
        <span className="va-dose-count">{ended ? '' : count}</span>
        <button className="va-btn va-btn-stage" onClick={onDone} disabled={ended}>
          I’m done
        </button>
      </div>
    </div>
  )
}

/** the dose's one sentence and the smaller one under it; `end` marks the closing line */
export function DoseWords({ line, sub, end }: { line: string; sub?: string | null; end?: boolean }) {
  return (
    <div className="va-stage-words va-dose-words" data-end={end || undefined} aria-live="polite">
      <p className="va-stage-line" key={end ? 'end' : 'run'}>
        {line}
      </p>
      {sub && !end && (
        <p className="va-stage-sub" key={sub}>
          {sub}
        </p>
      )}
    </div>
  )
}

export const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
/** seconds left of a dose that lasts `totalMs`, as "0:42" */
export const leftOf = (totalMs: number, elapsedMs: number) => mmss(Math.max(0, Math.ceil((totalMs - elapsedMs) / 1000)))

export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Run a dose script once per mount. The short delay keeps StrictMode's mount-unmount-mount from starting sound twice. */
export function useRun(fn: () => (() => void) | void) {
  const f = useRef(fn)
  f.current = fn
  useEffect(() => {
    let cleanup: (() => void) | void
    const id = window.setTimeout(() => {
      cleanup = f.current()
    }, 30)
    return () => {
      clearTimeout(id)
      if (cleanup) cleanup()
    }
  }, [])
}

/** the view with `patch` laid over it, or the same object when nothing changed (so a 25 Hz clock does not re-render) */
export function patched<T extends object>(view: T, patch: Partial<T>): T {
  for (const key in patch) {
    if (patch[key] !== view[key]) return { ...view, ...patch }
  }
  return view
}

/** timeouts and intervals that all stop together when the dose is left */
export function createTimers() {
  const ids = new Set<number>()
  let stopped = false
  return {
    after(ms: number, fn: () => void) {
      const id = window.setTimeout(() => {
        ids.delete(id)
        if (!stopped) fn()
      }, ms)
      ids.add(id)
    },
    every(ms: number, fn: () => void) {
      const id = window.setInterval(() => {
        if (!stopped) fn()
      }, ms)
      ids.add(id)
    },
    stop() {
      stopped = true
      ids.forEach((id) => {
        clearTimeout(id)
        clearInterval(id)
      })
      ids.clear()
    },
  }
}
export type Timers = ReturnType<typeof createTimers>

/** The dose's own clock: ms since it began, not counting time on hold (a face out of view). */
export function createClock() {
  const began = performance.now()
  let heldMs = 0
  let heldAt: number | null = null
  return {
    began,
    ms(now = performance.now()) {
      return now - began - heldMs - (heldAt == null ? 0 : now - heldAt)
    },
    hold(on: boolean) {
      const now = performance.now()
      if (on && heldAt == null) heldAt = now
      if (!on && heldAt != null) {
        heldMs += now - heldAt
        heldAt = null
      }
    },
    holding: () => heldAt != null,
  }
}

// ---- drawing the live lines

export interface Plot {
  cx: CanvasRenderingContext2D
  w: number
  h: number
}

/** size the canvas to its box at the screen's pixel density, clear it, and hand back CSS-pixel drawing */
export function openPlot(cv: HTMLCanvasElement | null): Plot | null {
  const cx = cv?.getContext('2d')
  if (!cv || !cx) return null
  const w = cv.clientWidth
  const h = cv.clientHeight
  if (!w || !h) return null
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr)
    cv.height = Math.round(h * dpr)
  }
  cx.setTransform(dpr, 0, 0, dpr, 0, 0)
  cx.clearRect(0, 0, w, h)
  return { cx, w, h }
}

/** a design token's value, read where the canvas sits (canvas cannot use var()) */
export function token(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim()
}

/** a filled column from x0 to x1 */
export function band(p: Plot, x0: number, x1: number, color: string, alpha: number) {
  p.cx.globalAlpha = alpha
  p.cx.fillStyle = color
  p.cx.fillRect(x0, 0, Math.max(0, x1 - x0), p.h)
  p.cx.globalAlpha = 1
}

/** one rounded stroke through the points; a null breaks the line where nothing was read */
export function trace(p: Plot, pts: ([number, number] | null)[], color: string, width = 2) {
  const { cx } = p
  cx.strokeStyle = color
  cx.lineWidth = width
  cx.lineJoin = 'round'
  cx.lineCap = 'round'
  cx.beginPath()
  let pen = false
  for (const pt of pts) {
    if (!pt) {
      pen = false
      continue
    }
    if (pen) cx.lineTo(pt[0], pt[1])
    else cx.moveTo(pt[0], pt[1])
    pen = true
  }
  cx.stroke()
}

/** a level across the plot: solid, or dashed for a threshold */
export function level(p: Plot, y: number, color: string, alpha: number, dashed = false) {
  const { cx } = p
  cx.globalAlpha = alpha
  cx.strokeStyle = color
  cx.lineWidth = 1
  cx.setLineDash(dashed ? [3, 4] : [])
  cx.beginPath()
  cx.moveTo(0, Math.round(y) + 0.5)
  cx.lineTo(p.w, Math.round(y) + 0.5)
  cx.stroke()
  cx.setLineDash([])
  cx.globalAlpha = 1
}

/** a small word on the plot, centred on x */
export function label(p: Plot, text: string, x: number, y: number, color: string, alpha: number) {
  const { cx } = p
  cx.globalAlpha = alpha
  cx.fillStyle = color
  cx.font = `11px ${getComputedStyle(cx.canvas).fontFamily}`
  cx.textAlign = 'center'
  cx.textBaseline = 'top'
  cx.fillText(text, x, y)
  cx.globalAlpha = 1
}

export function dot(p: Plot, x: number, y: number, r: number, color: string) {
  p.cx.fillStyle = color
  p.cx.beginPath()
  p.cx.arc(x, y, r, 0, 2 * Math.PI)
  p.cx.fill()
}
