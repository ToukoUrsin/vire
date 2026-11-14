// Small number helpers the doses share. No DOM, so the dose logic that uses them runs under `bun test`.

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

/** an angle brought into -180..180 */
export const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180

export function median(xs: number[]): number {
  if (!xs.length) return 0
  const a = [...xs].sort((x, y) => x - y)
  const m = a.length >> 1
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2
}

export function mean(xs: number[]): number {
  if (!xs.length) return 0
  let sum = 0
  for (const x of xs) sum += x
  return sum / xs.length
}

/** 0..1 with a soft start and stop */
export function smooth(u: number): number {
  const x = clamp(u, 0, 1)
  return x * x * (3 - 2 * x)
}

export const round1 = (x: number) => Math.round(x * 10) / 10

/** "1 second", "11 seconds" */
export const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`
