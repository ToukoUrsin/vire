import { useLayoutEffect, useRef, useState } from 'react'

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

/** linear scale d0..d1 -> r0..r1 */
export function lin(d0: number, d1: number, r0: number, r1: number) {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0)
  return (v: number) => r0 + (v - d0) * k
}

/** SVG path through points; a null starts a new segment (gap in the data) */
export function pathOf(points: ([number, number] | null)[]): string {
  let d = ''
  let pen = false
  for (const p of points) {
    if (!p) {
      pen = false
      continue
    }
    d += `${pen ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`
    pen = true
  }
  return d
}

/** round tick values covering min..max */
export function ticks(min: number, max: number, count = 4): number[] {
  const span = max - min || 1
  const raw = span / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(6))
  return out
}

/** measured pixel width of a container, so SVG text is never scaled */
export function useWidth<T extends HTMLElement>(initial = 800) {
  const ref = useRef<T>(null)
  const [w, setW] = useState(initial)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const set = () => {
      const w = Math.floor(el.getBoundingClientRect().width)
      if (w >= 200) setW(w)
    }
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/** strength thresholds that match the status logic: steady above -0.75 SD, low below -1.5 SD */
export const BAND_LO = 50 - 15 * 0.75
export const BAND_HI = 50 + 15 * 0.75
export const LOW_LINE = 50 - 15 * 1.5

/**
 * Voice level arrives in two conventions: the phone sends dBFS (-90 = silence, about -20 = speech),
 * the simulated cohort stores linear RMS (0..1). Both become linear amplitude here.
 */
export const voiceLin = (rms: number | null | undefined) => (rms == null || rms === 0 ? 0 : rms < 0 ? Math.pow(10, rms / 20) : rms)
/** the same level in dBFS, for reading out */
export const voiceDb = (rms: number | null | undefined) => {
  const v = voiceLin(rms)
  return v <= 0 ? -90 : Math.max(-90, 20 * Math.log10(v))
}
