// "Watch a run" (#/watch): one stored Today session as the page plays it back, for anyone without AirPods. Built
// on the server from the stored session with the same readers the phone and the clinic use (server/earreplay.ts);
// only what drawing needs, never a device's name. `real` is true only because the worker said so.
import type { EarStep } from './ear'
import type { Learned } from './earlearn'
import type { EarSessionRec, PaceCheck, PacedBreath, SessionKind, SessionPhase } from './earsession'
import type { SessionRead } from './earsessionread'

export const REPLAY_REAL = 'A real run: the founder’s own AirPods'
export const REPLAY_SCRIPTED = 'A scripted run: a stand-in plays the AirPods. Not a person.'
/** a stored session the worker picked without saying it was a person's own */
export const REPLAY_RECORDED = 'A recorded run, not marked as a person’s own.'

/** what the clinic's big screen shows for this practice (the shape of GET /api/ear/sessions/latest) */
export interface ReplaySeen {
  id: string
  arrivedAt: number
  shell: EarSessionRec['device']['shell']
  read: SessionRead & { id: string }
  learned: Learned
  practices: number
  pieces: { set: number; live: number }
}

export interface ReplayBundle {
  v: 1
  real: boolean
  /** scripted: the run in server/replay-scripted.json, made with the stand-in AirPods */
  scripted: boolean
  label: string
  /** the stored session's id, and when it was recorded (ISO) */
  id: string
  at: string
  kind: SessionKind
  /** ms from the start of the session, as stored */
  phases: SessionPhase[]
  steps: EarStep[]
  /** every breath the sound asked for, with its pace */
  breaths: PacedBreath[]
  /** each time the phone checked whether the breath went with the sound */
  checks: Pick<PaceCheck, 't' | 'from' | 'to' | 'follows' | 'by'>[]
  /** heart rate [t, bpm], at most 10 a second, and what measured it (as readSession says) */
  heart: { from: SessionRead['heartFrom']; rows: [number, number][] }
  /** head movement [t, degrees a second], 5 a second, from the check before to the end of the check after */
  move: [number, number][]
  /** which sound played when: pieces made on Modal (set, live) and the phone's own tone */
  sound: EarSessionRec['sound']
  read: SessionRead & { id: string }
  seen: ReplaySeen
}
