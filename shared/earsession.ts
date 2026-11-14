// A session in the AirPods: Vire's answer to the day's minute. The person sits (or walks) for two to three
// minutes while sound plays in the AirPods; the AirPods are read the whole time, and a short check before and
// after says what changed. Times are ms from the start of the session. Only numbers: no picture, no sound.
import type { EarStep } from './ear'

/** what the session asks for: slow paced breathing, a body scan, or a walk */
export type SessionKind = 'breathe' | 'scan' | 'walk'
export const SESSION_KINDS: readonly SessionKind[] = ['breathe', 'scan', 'walk']

/**
 * `checkin` is the day's minute (the same asks as a teaching minute, camera off). `before` is a still stretch
 * just before the practice and `after` starts with the same still stretch, so the two are like for like;
 * `after` ends with two asked smiles.
 */
export interface SessionPhase {
  name: 'checkin' | 'before' | 'session' | 'after'
  t0: number
  t1: number
}

/** one breath the sound asked for: in from t0 to tMid, out from tMid to t1 */
export interface PacedBreath {
  t0: number
  tMid: number
  t1: number
  /** the pace this breath was part of, breaths a minute */
  perMin: number
}

export interface EarSessionRec {
  v: 1
  /** ISO time the session started */
  at: string
  kind: SessionKind
  device: { shell: 'mac' | 'ios' | 'sim'; gyro: boolean; hz: number; ua: string; route?: string }
  /** AirPods: [t, pitchDeg, yawDeg, rollDeg, ax, ay, az, rxDegS, ryDegS, rzDegS], as in a teaching minute */
  head: number[][]
  /** the camera's pulse while it was on: [t, bpm, quality 0..1, wave]; empty when the camera stayed off */
  pulse: number[][]
  /** heart rate from the iPhone's workout session (AirPods Pro 3 measure it only while one runs): [t, bpm] */
  airHr: number[][]
  /** the same heart rate as Health stored it, each sample with what measured it (newer iPhone builds only) */
  heartSamples?: { t: number; bpm: number; src: string; model: string; n: number }[]
  /** what the iPhone said about its heart session at the end: off, starting, on or denied */
  heartState?: string
  phases: SessionPhase[]
  /** every breath the sound asked for (breathing sessions; empty otherwise) */
  breaths: PacedBreath[]
  /** asked in the check-in and in the checks before and after: rest, smile, relax, nod, shake */
  steps: EarStep[]
  /** which day of the plan this was on this device (1 = the first) */
  day?: number
  /** the phone's clock against UTC when it started, minutes east: what time of day it was for the person */
  tzMin?: number
  /** set when Vire offered this practice from what the AirPods felt that day: which rule, and its sentence with the numbers */
  offered?: { rule: string; why: string; byDefault: boolean }
  /** the person's own breathing pace read in the still stretch before the practice, when it could be read */
  own?: BreathRead
  /** each time the phone decided about the pace: what the AirPods said then, and what the sound did */
  adapt?: PaceCheck[]
  /** which sound played when, and how each piece was made: on a Modal GPU as it went, from the set made earlier on Modal, or the phone's own tone */
  sound: { id: string; t: number; made: 'live' | 'set' | 'tone' }[]
}

/** one decision about the pace, made on the phone from the AirPods alone while the sound played */
export interface PaceCheck {
  t: number
  /** the pace that was playing, and the pace the sound went to */
  from: number
  to: number
  /** did the head's slow motion sit at the asked pace */
  follows: boolean
  coherence: number
  /** could any steady breath be read in that stretch */
  readable: boolean
  /** head movement in that stretch, degrees a second */
  moveDegS: number | null
  /** what decided it: the breath followed, the head was still (breath not readable), or neither */
  by: 'breath' | 'stillness' | 'held'
}

/** what the AirPods read in one stretch of a session */
export interface BreathRead {
  /** breaths a minute, or null when no steady breath could be read */
  perMin: number | null
  /** 0..1: how much of the slow motion sat at that one pace */
  conf: number
}

/** did the head's slow motion move with the asked pace */
export interface PaceFollow {
  follows: boolean
  /** 0..1: share of the slow motion that sat at the asked pace */
  coherence: number
  /** size of the motion at that pace, degrees peak to trough */
  amplitudeDeg: number
}
