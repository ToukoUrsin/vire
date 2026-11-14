// The simulated practice history of each patient in a clinic re-training run: what each one did at home (slow breathing,
// a body scan or a walk) and how much stiller the head sat after it than before (`settle`, percent). Made by a script,
// seeded, never a person. Each simulated patient has a hidden usual score per practice that differs from patient to
// patient (most have one practice that suits them, some have none that stands out), and every practice scatters around
// it by about 20 points. Which practice came next was picked by the app's own learner (shared/earlearn.ts), as at home.
// Some patients have only a few practices, so "too early" shows honestly.
//   used by sandbox/cohort_minutes.ts, which writes each patient's minutes and practices into one file
import { learn } from '../shared/earlearn'
import type { Scored } from '../shared/earlearn'
import type { SessionKind } from '../shared/earsession'
import { SESSION_KINDS } from '../shared/earsession'

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const gauss = (rng: () => number) => Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))) * Math.cos(2 * Math.PI * rng())

export const PRACTICES_MIN = 2
export const PRACTICES_MAX = 30
/** how far one practice's score falls from that patient's usual, points */
export const PRACTICE_SD = 20

export interface SimulatedPatientPractices {
  /** the hidden usual score per practice (kept for tests; the sandbox gets only the practices) */
  truth: Record<SessionKind, number>
  practices: Scored[]
}

export function cohortPractices(seed: number, n: number): SimulatedPatientPractices {
  const rng = mulberry32(((seed >>> 0) ^ Math.imul(n, 0x9e3779b1)) >>> 0)
  rng()
  // a quarter have no practice that stands out; the rest have one, a different one from patient to patient
  const plain = rng() < 0.25
  const fav = SESSION_KINDS[Math.floor(rng() * SESSION_KINDS.length)]!
  const truth = Object.fromEntries(SESSION_KINDS.map((k) => [k, plain ? 4 + 10 * rng() : k === fav ? 14 + 22 * rng() : -6 + 16 * rng()])) as Record<SessionKind, number>
  // 2 to 30 practices; about one patient in nine has only two (too early to say), one in four five or fewer
  const count = PRACTICES_MIN + Math.floor((PRACTICES_MAX - PRACTICES_MIN + 1) * rng() ** 1.6)
  const day = Date.parse('2026-11-14T08:00:00Z')
  const practices: Scored[] = []
  for (let i = 0; i < count; i++) {
    const kind = learn(practices).next
    const settle = Math.round(Math.max(-90, Math.min(95, truth[kind] + PRACTICE_SD * gauss(rng))) * 10) / 10
    const at = new Date(day - (count - i) * 86_400_000 + Math.floor(rng() * 12) * 3_600_000).toISOString()
    practices.push({ kind, settle, at })
  }
  return { truth, practices }
}
