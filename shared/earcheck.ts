// "Watch a real check" (#/heard): one person's own check-in, camera off, read by the model their setup found.
// The screen asked for nods and head shakes at known moments, so the check scores itself without a camera: was each
// asked one heard, and was anything heard that was not asked. The bundle is made offline from a stored recording
// and its model (scripts/realcheck.ts) and kept on the server, not in the repo: it is a real person's head movement.

export type CheckAsk = 'rest' | 'smile' | 'relax' | 'nod' | 'shake'
export type CheckEvent = 'nod' | 'shake'

export interface CheckScore {
  /** how many times the screen asked for it */
  asked: number
  /** of those, how many the model heard (switched on between the ask and a second after it ended) */
  heard: number
  /** times it switched on with nothing of the kind asked */
  unasked: number
  /** how well its number separates the asked seconds from the rest: 1.00 never wrong, 0.50 luck */
  auc: number
}

export interface CheckBundle {
  v: 1
  /** when the check was recorded, and when the model was taught (ISO) */
  recordedAt: string
  taughtAt: string
  /** what recorded the check, and what recorded the setup minutes */
  shell: string
  taughtShell: string
  hz: number
  /** how long the check ran, ms */
  ms: number
  /** what the screen asked, in order */
  steps: { t0: number; t1: number; ask: CheckAsk }[]
  /** the head, 25 a second: [t ms, pitch°, yaw°], each with its own slow drift taken away */
  head: [number, number, number][]
  /** the model, 12 a second: [t ms, nod 0..1, head shake 0..1, nod heard 0|1, head shake heard 0|1] */
  read: [number, number, number, number, number][]
  score: Record<CheckEvent, CheckScore>
  /** the setup behind the model: minutes taught from, models tried, and the held-out score of each event */
  model: { minutes: number; tried: number; held: { nod: number; shake: number; smile: number } }
}

export const CHECK_ASK: Record<CheckAsk, string> = { rest: 'Rest', smile: 'Smile', relax: 'Let it go', nod: 'Nod', shake: 'Shake your head' }

/** what a stored bundle must look like before the server keeps it or a page draws it */
export function isCheckBundle(x: unknown): x is CheckBundle {
  const b = x as CheckBundle | null
  if (!b || typeof b !== 'object' || b.v !== 1) return false
  if (typeof b.recordedAt !== 'string' || typeof b.taughtAt !== 'string' || !Number.isFinite(b.ms) || b.ms <= 0 || b.ms > 10 * 60_000) return false
  if (!Array.isArray(b.steps) || !Array.isArray(b.head) || !Array.isArray(b.read)) return false
  if (b.steps.length < 1 || b.steps.length > 200 || b.head.length < 10 || b.head.length > 20_000 || b.read.length < 10 || b.read.length > 20_000) return false
  if (!b.steps.every((s) => s && Number.isFinite(s.t0) && Number.isFinite(s.t1) && s.t1 > s.t0 && typeof s.ask === 'string' && s.ask in CHECK_ASK)) return false
  if (!b.head.every((r) => Array.isArray(r) && r.length === 3 && r.every(Number.isFinite))) return false
  if (!b.read.every((r) => Array.isArray(r) && r.length === 5 && r.every(Number.isFinite))) return false
  for (const e of ['nod', 'shake'] as const) {
    const s = b.score?.[e]
    if (!s || ![s.asked, s.heard, s.unasked, s.auc].every(Number.isFinite)) return false
  }
  const m = b.model
  return !!m && Number.isFinite(m.minutes) && Number.isFinite(m.tried) && !!m.held && [m.held.nod, m.held.shake, m.held.smile].every(Number.isFinite)
}

/** how many asked ones of an event have been heard by time t (the page counts up as it plays) */
export function heardBy(b: CheckBundle, e: CheckEvent, t: number): { asked: number; heard: number } {
  const col = e === 'nod' ? 3 : 4
  const asks = b.steps.filter((s) => s.ask === e && s.t0 <= t)
  const heard = asks.filter((s) => b.read.some((r) => r[0] >= s.t0 && r[0] < s.t1 + 1000 && r[0] <= t && r[col] === 1)).length
  return { asked: asks.length, heard }
}
