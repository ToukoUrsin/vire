// The teaching minute: what the AirPods felt (the student) next to what the camera and the microphone saw
// (the teachers), on one clock. No picture and no sound is in here: only angles, rates, a smile level and loudness.
// The browser trains on it at once; the server keeps it so a person's own model can be searched for in a sandbox.

/** what the person was asked to do */
export type EarAsk = 'rest' | 'smile' | 'relax' | 'nod' | 'shake' | 'laugh' | 'talk'

/** what the AirPods can be taught to tell apart */
export type EarEvent = 'smile' | 'nod' | 'shake' | 'laugh' | 'talk'
export const EAR_EVENTS: readonly EarEvent[] = ['smile', 'nod', 'shake', 'laugh', 'talk']

export interface EarStep {
  ask: EarAsk
  /** ms from the start of the recording */
  t0: number
  t1: number
}

/** every time below is ms from the start of the recording */
export interface EarRecording {
  v: 1
  /** ISO time the minute started */
  at: string
  /** who: the app's user id, or null for a visitor */
  userId: string | null
  device: {
    /** where the AirPods were read: the Mac helper, the iPhone app, or a script (tests, demo signals) */
    shell: 'mac' | 'ios' | 'sim'
    /** rotation rate came with the samples */
    gyro: boolean
    /** AirPods samples a second, as measured over the recording */
    hz: number
    ua: string
    /** AirPods samples a second in the two seconds before the camera came on (absent on older minutes) */
    idleHz?: number
    /** where the iPhone said its sound was going when the minute ended (absent outside the iPhone app) */
    route?: string
  }
  /** AirPods: [t, pitchDeg, yawDeg, rollDeg, ax, ay, az, rxDegS, ryDegS, rzDegS] (acceleration in g) */
  head: number[][]
  /** camera: [t, present 0|1, smile, cheek, jawOpen, brow, pitchDeg, yawDeg, rollDeg], raw model scale */
  face: number[][]
  /** microphone at 25 a second: [t, loudness dBFS, voiced 0|1] */
  voice: number[][]
  steps: EarStep[]
  /**
   * 'daily': the day's minute, done with the camera off. The same asks, the AirPods alone: nothing in it can
   * teach (no camera said what happened), so no model learns from it. It is read against the person's usual.
   */
  kind?: 'daily'
}

/** a minute the camera was on for: the only kind a model may learn from */
export const teaches = (r: EarRecording): boolean => r.kind !== 'daily'

/** AirPods send about 50 samples a second (25 through the Mac helper). Under this, most of the motion is missing. */
export const THIN_HZ = 15
/** a person's minute in which the AirPods sent far too few samples (the 14.11.2026 19:11 minute had 6 a second) */
export const thin = (r: EarRecording): boolean => r.device.shell !== 'sim' && r.head.length > 0 && r.device.hz < THIN_HZ
/** the minutes to learn from, or to set today against: a full minute never leans on thin ones, a thin one takes what there is */
export const fullMinutes = (minutes: EarRecording[], newest: EarRecording): EarRecording[] => (thin(newest) ? minutes : minutes.filter((m) => !thin(m)))

/** How well one thing can be told from the AirPods alone, on parts of the minute the model never saw. */
export interface EarScore {
  /** area under the curve, 0.5 = a coin, 1 = never wrong */
  auc: number
  /** the best the same procedure scores when the labels are slid along the motion: what luck reaches here */
  chance: number
  /** windows it was checked on, and how many separate times the thing happened */
  windows: number
  times: number
  /** true when the AirPods alone are good enough to follow this without the camera */
  ok: boolean
  /** what the model never saw when it was checked: a whole minute, or a whole round of one minute */
  held?: 'minute' | 'round'
}

export interface EarUpload {
  recording: EarRecording
  /** what the browser's own quick model scored, if it trained one */
  quick?: Partial<Record<EarEvent, EarScore>>
  /**
   * This device's own key (32 to 64 hex characters, made on the device). With it the device can read its own
   * minutes back, so a person's model can learn from every minute they have done. Nobody else can.
   */
  key?: string
}

export interface EarStored {
  id: string
  at: string
  userId: string | null
  shell: string
  seconds: number
  headRows: number
  hz: number
  /** the day's minute, camera off (see EarRecording.kind) */
  daily?: true
}

// ---- the person's own ear model (v2) ----

/**
 * One detector per thing the AirPods learned, each with the check it passed or failed.
 * `det` is how that detector computes its answer; only `web/src/tune/ear` reads it.
 */
export interface EarModel2 {
  v: 2
  at: string
  /** trained in the browser right after the minute, or searched for in the person's own sandbox */
  by: 'device' | 'sandbox'
  /** the recording it came from: 'sim' is a script and must never be shown as something learned from a person */
  shell: 'mac' | 'ios' | 'sim'
  hz: number
  gyro: boolean
  /** `by` is set on a row only when it was made another way than the model as a whole (see `adoptSearch`) */
  events: Partial<Record<EarEvent, { score: EarScore; det: unknown; by?: 'device' | 'sandbox' }>>
  /** how many candidate models were tried to get here */
  tried: number
  /** how many of the person's teaching minutes it learned from (absent = 1) */
  minutes?: number
  /** truly held out performance as each earlier minute teaches the next one */
  curve?: Array<{ minutes: number; auc: Partial<Record<EarEvent, number>> }>
  /** what was held back for the check: a whole minute where any row could be checked that way, else a whole round */
  held?: 'minute' | 'round'
}

/** what the ear model says right now, from AirPods motion alone */
export interface EarNow {
  t: number
  /** 0..1 for each thing the model can follow on its own (`score.ok`); others are absent */
  p: Partial<Record<EarEvent, number>>
  /** the ones it says are happening now */
  on: EarEvent[]
}

/** one candidate of a search, for the board on the big screen */
export interface EarTried {
  /** a short plain name, e.g. "0.6 s windows, rotation only, linear" */
  name: string
  /** mean area under the curve over the events it could be checked on */
  auc: number
  ms: number
}

/** `GET /api/ear/jobs/:id`: the search for one person's model, in a sandbox of its own */
export interface EarJob {
  id: string
  state: 'queued' | 'running' | 'done' | 'failed'
  /** candidates tried so far, best first, at most 12 */
  board: EarTried[]
  tried: number
  /** seconds the sandbox has been alive */
  seconds: number
  model: EarModel2 | null
  error?: string
  /** how many of the person's minutes the search learns from */
  minutes?: number
  /** when the person's device took the model the search found (ms since 1970), absent until then */
  landedAt?: number
  /** when the minute that started this search arrived (ms since 1970) */
  at?: number
  /**
   * every minute of this person as the AirPods alone felt it, oldest first, this search's minute last: the
   * numbers behind "today against the usual". Worked out by the server from the stored minutes.
   */
  days?: import('./earday').EarDay[]
  /** the minute came from a script (the simulator), not from a person: every screen must say so, from the start */
  demo?: boolean
  /**
   * when this person's newest camera-off daily minute arrived (ms since 1970). It started no search: `days` then
   * ends with that minute, read by the AirPods alone against the minutes before it.
   */
  dailyAt?: number
}
