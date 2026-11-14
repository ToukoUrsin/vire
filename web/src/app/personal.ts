// The personal face model at work: one reader per sensing session. It gives the mirror its muscles
// and keeps, for the ping, what the face and the ear model did while the laughter played.
import { MUSCLES } from '@shared/types'
import type { PingFeatures, TuneFace } from '@shared/types'
import type { Sense } from '../sense/types'
import { createReader, loadModel } from '../tune'
import type { PersonalModel, Reader } from '../tune'

const STIM_KEY = 'vire.stim.answers'
interface StimAnswer { n: number; clear: number; fast: number }
type StimStats = Record<string, StimAnswer>
export const LAUGH_STIMS = ['laugh-1', 'laugh-2', 'laugh-3'] as const
const LAUGH_NAMES: Record<string, string> = { 'laugh-1': 'Warm-up laugh', 'laugh-2': 'Bright laugh', 'laugh-3': 'Long laugh' }
function stimStats(): StimStats {
  try {
    return JSON.parse(localStorage.getItem(STIM_KEY) ?? '{}') as StimStats
  } catch {
    return {}
  }
}
export function chooseStim(): string {
  try {
    if (localStorage.getItem('vire.lovedLaugh') === '1' && Math.random() < 0.25) return 'personal'
  } catch { /* private mode */ }
  const s = stimStats()
  const unseen = LAUGH_STIMS.filter((id) => !s[id]?.n)
  if (unseen.length) return unseen[Math.floor(Math.random() * unseen.length)]!
  const scored = LAUGH_STIMS.map((id) => {
    const x = s[id]!
    return { id, v: (x.clear * 0.7 + x.fast * 0.3) / Math.max(1, x.n) }
  })
  const best = [...scored].sort((a, b) => b.v - a.v)[0]!
  return Math.random() < 0.2 ? LAUGH_STIMS[Math.floor(Math.random() * LAUGH_STIMS.length)]! : best.id
}

export function stimLine(id: string | undefined): string {
  if (id?.startsWith('daily-')) return 'Today’s laugh: a new one, made this morning.'
  const s = id ? stimStats()[id] : undefined
  const name = id?.startsWith('laugh-') ? (LAUGH_NAMES[id] ? `the ${LAUGH_NAMES[id]!.toLowerCase()}` : 'a new laugh') : 'your saved laugh'
  // this runs after today's ping was counted: one hearing is still a new laugh
  const n = s?.n ?? 0
  if (n <= 1) return `Today’s laugh: ${name}, a new one to see how you answer it.`
  const all = stimStats()
  const score = (x: { n: number; clear: number; fast: number } | undefined) => (x?.n ? (x.clear * 0.7 + x.fast * 0.3) / x.n : -1)
  const best = LAUGH_STIMS.every((other) => other === id || score(all[other]) <= score(s))
  return best ? `Today’s laugh: ${name}, the one your face has answered most so far.` : `Today’s laugh: ${name}, played again to see how you answer it.`
}
export function recordStim(id: string | undefined, features: PingFeatures) {
  if (!id || !LAUGH_STIMS.includes(id as (typeof LAUGH_STIMS)[number])) return
  const s = stimStats()
  const x = s[id] ?? { n: 0, clear: 0, fast: 0 }
  x.n++
  x.clear += features.smile.peak
  x.fast += features.smile.latencyMs == null ? 0 : Math.max(0, 1 - features.smile.latencyMs / 4000)
  s[id] = x
  try {
    localStorage.setItem(STIM_KEY, JSON.stringify(s))
  } catch {
    /* private mode */
  }
}

/** what a laugh clip is called on screen, the name the ping's line uses for it */
export function stimName(id: string): string {
  return id.startsWith('laugh-') ? (LAUGH_NAMES[id] ?? 'a new laugh') : 'your saved laugh'
}

/** one more answer to a clip, heard outside a ping (the smile dose): the same record, the same two sums */
export function recordStimAnswer(id: string, peak: number, latencyMs: number | null) {
  if (!LAUGH_STIMS.includes(id as (typeof LAUGH_STIMS)[number])) return
  const s = stimStats()
  const x = s[id] ?? { n: 0, clear: 0, fast: 0 }
  x.n++
  x.clear += peak
  x.fast += latencyMs == null ? 0 : Math.max(0, 1 - latencyMs / 4000)
  s[id] = x
  try {
    localStorage.setItem(STIM_KEY, JSON.stringify(s))
  } catch {
    /* private mode */
  }
}

/** the clip this person's face has answered best so far, scored the way chooseStim scores it; null with no record */
export function bestStim(): string | null {
  const s = stimStats()
  let best: string | null = null
  let bestV = -Infinity
  for (const id of LAUGH_STIMS) {
    const x = s[id]
    if (!x?.n) continue
    const v = (x.clear * 0.7 + x.fast * 0.3) / x.n
    if (v > bestV) {
      best = id
      bestV = v
    }
  }
  return best
}

export interface PersonalRead {
  /** MUSCLES order, 0..1; null while no face is in view */
  muscles: number[] | null
  face: { label: TuneFace; p: number } | null
  /** the ear model's smile; null when there is none */
  earSmile: number | null
}

let model: PersonalModel | null = null
let reader: Reader | null = null
let offs: (() => void)[] = []
let names: string[] = []
let faults = 0
const read: PersonalRead = { muscles: null, face: null, earSmile: null }

interface Collect {
  muscles: number[][]
  faces: Map<TuneFace, number>
  frames: number
  ear: { t: number; v: number }[]
  earRest: number
}
let col: Collect | null = null
/** the ear model's level over the last few seconds, so its resting value is known when the laughter starts */
const earRecent: number[] = []

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0)
const median = (xs: number[]) => {
  if (!xs.length) return 0
  const a = [...xs].sort((x, y) => x - y)
  const m = a.length >> 1
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}

/** the scripted tune step (demo signals) drives the mirror's muscles directly while it runs */
let scripted: number[] | null = null
export function scriptMuscles(m: number[] | null) {
  scripted = m
}

export const currentModel = () => model
export const personalRead = (): PersonalRead => (scripted ? { muscles: scripted, face: null, earSmile: read.earSmile } : read)

/** Call after every sense.start(): loads the saved model, scales the sense to the person's own range, starts reading. */
export function attachModel(sense: Sense) {
  detachModel()
  model = loadModel()
  try {
    sense.setCalibration(model ? model.calibration : null)
  } catch {
    /* an older sensing core: raw scale */
  }
  try {
    reader = createReader(model)
  } catch (e) {
    console.warn('[app] the personal model could not be read', e)
    reader = null
  }
  names = []
  faults = 0
  offs.push(
    sense.on('face', (f) => {
      if (!reader || faults > 20) return
      if (!f.present) {
        read.muscles = null
        read.face = null
        return
      }
      if (!names.length) names = sense.blendNames()
      try {
        const r = reader.face(f, names)
        read.muscles = r.muscles.map(clamp01)
        read.face = r.face
      } catch (e) {
        if (faults++ === 0) console.warn('[app] face reader failed', e)
        return
      }
      if (col && read.muscles) {
        col.frames++
        for (let i = 0; i < MUSCLES.length; i++) col.muscles[i].push(read.muscles[i] ?? 0)
        if (model && read.face) col.faces.set(read.face.label, (col.faces.get(read.face.label) ?? 0) + 1)
      }
    }),
    sense.on('head', (h) => {
      if (!reader || faults > 20) return
      let v: number | null = null
      try {
        v = reader.head(h)
      } catch (e) {
        if (faults++ === 0) console.warn('[app] ear reader failed', e)
      }
      read.earSmile = v == null || !Number.isFinite(v) ? null : clamp01(v)
      if (read.earSmile == null) return
      if (col) col.ear.push({ t: h.t, v: read.earSmile })
      else {
        earRecent.push(read.earSmile)
        if (earRecent.length > 90) earRecent.shift()
      }
    }),
  )
}

export function detachModel() {
  offs.forEach((off) => off())
  offs = []
  reader = null
  col = null
  earRecent.length = 0
  read.muscles = null
  read.face = null
  read.earSmile = null
}

/** the laugh phase starts: keep every reading until endLaugh() */
export function beginLaugh() {
  col = { muscles: MUSCLES.map(() => []), faces: new Map(), frames: 0, ear: [], earRest: median(earRecent) }
}

/** the laugh phase is over: each muscle's peak, the share of frames read as each face, and the ear model's smile-seconds */
export function endLaugh(): Pick<PingFeatures, 'muscles' | 'faces' | 'earSmileAuc'> {
  const c = col
  col = null
  if (!c) return {}
  const out: Pick<PingFeatures, 'muscles' | 'faces' | 'earSmileAuc'> = {}
  if (c.frames >= 5) {
    // the peak, without the one-frame spikes: the 95th percentile of the phase
    out.muscles = c.muscles.map((xs) => {
      const a = [...xs].sort((x, y) => x - y)
      return Math.round(a[Math.min(a.length - 1, Math.floor(a.length * 0.95))] * 1000) / 1000
    })
    if (model && c.faces.size) {
      const faces: Partial<Record<TuneFace, number>> = {}
      for (const [label, n] of c.faces) faces[label] = Math.round((n / c.frames) * 1000) / 1000
      out.faces = faces
    }
  }
  if (c.ear.length >= 10) {
    let auc = 0
    for (let i = 1; i < c.ear.length; i++) {
      const dt = (c.ear[i].t - c.ear[i - 1].t) / 1000
      if (dt <= 0 || dt > 0.5) continue
      auc += ((Math.max(0, c.ear[i].v - c.earRest) + Math.max(0, c.ear[i - 1].v - c.earRest)) / 2) * dt
    }
    out.earSmileAuc = Math.round(auc * 1000) / 1000
  } else {
    out.earSmileAuc = null
  }
  return out
}
