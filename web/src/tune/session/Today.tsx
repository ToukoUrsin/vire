// /#/today: the day's loop in the AirPods, camera off, about five minutes.
//   1. Check-in: the day's minute (the same asks as a teaching minute). Read against the person's own usual.
//   2. Practice: sound in the ears. For breathing, a sea ahead rises and falls and leads the breath from the
//      person's own pace towards six a minute, while the AirPods say whether the breath goes with it; the head's
//      own turning keeps the sound in place. Heart rate comes from the AirPods (the iPhone runs a workout
//      session for it). A body scan and a walk are the other two practices.
//   3. After: the same still stretch as just before the practice, and two smiles. What changed is said plainly.
//   4. Learn: which practice has helped this person most so far, with the counts, and what comes tomorrow.
// Only numbers leave the phone: AirPods angles, heart-rate samples, what was asked when.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { EarRecording, EarStored } from '@shared/ear'
import { fullMinutes } from '@shared/ear'
import { learn, learnLength, learnWhen } from '@shared/earlearn'
import type { Learned } from '@shared/earlearn'
import { SESSION_KINDS } from '@shared/earsession'
import type { BreathRead, EarSessionRec, PaceCheck, PacedBreath, SessionKind, SessionPhase } from '@shared/earsession'
import { readSession } from '@shared/earsessionread'
import type { SessionRead } from '@shared/earsessionread'
import { walkRead } from '@shared/earwalk'
import type { EarStep } from '@shared/ear'
import { createSense } from '../../sense'
import { connectEars, earsInfo, onEars, onNative, postNative } from '../../sense/native'
import type { EarsInfo } from '../../sense/native'
import type { Sense } from '../../sense/types'
import { api, apiUrl } from '../../shared/api'
import { EarRecorder, TEACH_STEPS, earKey, keepMinute, listMinutes, loadEarModel, syncMinutes } from '../ear'
import { UsualFromMinutes } from '../usual/Usual'
import { heardInMinute } from '../usual/heard'
import type { Heard } from '../usual/heard'
import { breathRate, followsPace, stillness } from './breath'
import { IN_SHARE, breathsAt, decide, newPacer, startPace } from './pace'
import DayCard from '../passive/DayCard'
import { usePassive } from '../passive/usePassive'
import type { PassiveOffer } from '../passive/usePassive'
import { loadManifest, nextSegment, warm } from './sound'
import type { SoundInfo, SoundManifest, SoundStage } from './sound'
import { Swell } from './swell'
import { breathRow, heartRow, stillRow, verdict } from './result'
import '../ears-lab.css'
import './today.css'

let todaySense: Sense | null = null
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const inApp = () => !!(window as unknown as { webkit?: { messageHandlers?: { vire?: unknown } } }).webkit?.messageHandlers?.vire
const r3 = (v: number) => Math.round(v * 1000) / 1000
/** what this device is, for "nothing leaves this ...": the iPhone app or a phone's browser, a Mac, or anything else */
const here = () => (inApp() || /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent) ? 'phone' : /Macintosh|Mac OS X/.test(navigator.userAgent) ? 'Mac' : 'computer')
/** tests run the loop faster; nothing else sets this */
const speed = () => {
  try {
    return Math.max(1, Number(localStorage.getItem('vire.ears.speed')) || 1)
  } catch {
    return 1
  }
}
/**
 * The phone must not lock itself in the middle of five hands-off minutes. The screen is held, and taken again when
 * the page comes back: a phone lets it go whenever the page is covered (Health's sheet on the first run). `onHeld`
 * hears whether the phone gave it, so the screen can say when it did not.
 */
async function keepScreenOn(onHeld: (held: boolean) => void): Promise<() => void> {
  const wl = (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock
  let lock: { release(): Promise<void> } | null = null
  let over = false
  const take = async () => {
    if (over || document.visibilityState === 'hidden') return
    try {
      lock = (await wl?.request('screen')) ?? null
    } catch {
      lock = null
    }
    if (!over) onHeld(!!lock)
  }
  const back = () => void take()
  document.addEventListener('visibilitychange', back)
  await take()
  return () => {
    over = true
    document.removeEventListener('visibilitychange', back)
    void lock?.release().catch(() => {})
  }
}

const STILL_MS = 22_000
const PRACTICE_MS = 150_000
const SIT_MS = 10_000
/** no AirPods data for this long in a run: the run stops and says so */
const PODS_GONE_MS = 15_000
const NAME: Record<SessionKind, string> = { breathe: 'Slow breathing', scan: 'Body scan', walk: 'A short walk' }
const SHORT: Record<SessionKind, string> = { breathe: 'slow breathing', scan: 'the body scan', walk: 'the walk' }
const ABOUT: Record<SessionKind, string> = {
  breathe: 'A sea in your ears rises and falls. Breathe in as it rises, out as it falls. It slows down as you do.',
  scan: 'A sea in your ears, and one part of the body at a time. Nothing to do but notice.',
  walk: 'Stand up and walk for two and a half minutes, any pace. Your AirPods feel the steps.',
}
const SCAN = ['Your feet', 'Your legs', 'Your belly', 'Your chest', 'Your shoulders', 'Your jaw and face', 'The whole body']
const AFTER: { ask: EarStep['ask']; ms: number; say: string; hint: string }[] = [
  { ask: 'rest', ms: STILL_MS, say: 'Sit still', hint: 'Breathe as you like. This is the same check as before.' },
  { ask: 'smile', ms: 3000, say: 'Smile', hint: 'A real one if you can.' },
  { ask: 'relax', ms: 3000, say: 'Let it go', hint: 'Face at rest.' },
  { ask: 'smile', ms: 3000, say: 'Smile', hint: 'Once more.' },
  { ask: 'relax', ms: 3000, say: 'Let it go', hint: 'That was it.' },
]
const REST_MS = TEACH_STEPS.reduce((a, s) => a + s.ms, 0) + STILL_MS + AFTER.reduce((a, s) => a + s.ms, 0)
/** how long the practice runs for this person: breathing goes by how long they took to reach six a minute before */
const practiceMs = (kind: SessionKind, mine: Mine | null) => (kind === 'breathe' ? learnLength(mine?.sessions ?? []).nextS * 1000 : PRACTICE_MS)
const mmss = (sec: number) => (sec >= 60 ? `${Math.floor(sec / 60)} min${sec % 60 ? ` ${sec % 60} s` : ''}` : `${sec} s`)

interface Mine {
  sessions: (SessionRead & { id: string })[]
  learned: Learned
}
interface Result {
  read: SessionRead
  learned: Learned
  /** every practice of this device, this one included */
  all: SessionRead[]
  minutes: EarRecording[]
  heard: Heard[]
  id: string | null
  daily: EarStored | null
  rows: number
  /** pieces of sound made on a Modal GPU that played: picked from the set, and made while the practice went on */
  pieces: { set: number; live: number }
  sent: boolean
}
interface Live {
  hr: number | null
  pace: number | null
  phase: 'in' | 'out' | null
  secs: number
  with: boolean | null
  steps: number | null
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const localDay = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}
/** which day of the plan today is: one more than the days that already have a practice, unless today has one */
function dayOf(mine: Mine | null): { day: number; doneToday: boolean } {
  const days = [...new Set((mine?.sessions ?? []).map((s) => localDay(s.at)))]
  const doneToday = days.includes(localDay(new Date().toISOString()))
  return { day: days.length + (doneToday ? 0 : 1), doneToday }
}

function learnedLine(l: Learned): { head: string; line: string } {
  const counts = l.kinds
    .filter((k) => k.n > 0)
    .map((k) => `${SHORT[k.kind]} ${plural(k.n, 'time')}, ${k.mean! >= 0 ? `${Math.round(k.mean!)}% stiller` : `${Math.abs(Math.round(k.mean!))}% more movement`} after on average`)
    .join('; ')
  if (l.said === 'learned' && l.best) return { head: `Vire learned: for you, ${SHORT[l.best]} helps most.`, line: `${counts}.` }
  if (l.said === 'leaning' && l.best) return { head: `So far ${SHORT[l.best]} has helped you most.`, line: `${counts}. Still comparing.` }
  return { head: 'Too early to say what helps you most.', line: l.total ? `${counts}.` : 'No practice could be scored yet.' }
}

/** how long: from how long this person took to reach six breaths a minute, in their own practices */
function howLong(res: Result): { nextS: number; line: string } {
  const l = learnLength(res.all)
  const r = res.read
  const next = `Your next slow breathing runs ${mmss(l.nextS)}`
  const low = `y${next.slice(1)}`
  if (r.kind !== 'breathe') return { nextS: l.nextS, line: l.of ? `How long: ${low}, from your ${plural(l.of, 'breathing practice')} so far.` : `How long: ${low}, the usual length until you have done one.` }
  if (r.paceSlowest !== null && r.paceSlowest <= 6 && r.slowestAtS !== null)
    return { nextS: l.nextS, line: `How long: today the sound was at 6 breaths a minute after ${mmss(r.slowestAtS)}. ${next}: ${l.n > 1 ? `the middle of your ${l.n} practices` : 'that'} and a minute at 6.` }
  return { nextS: l.nextS, line: `How long: today the sound got down to ${r.paceSlowest ?? '?'} breaths a minute, not to 6. ${next}${l.n ? '' : ', a little longer'}.` }
}

/** when: which time of day has helped, only from this person's own practices */
function whenLine(res: Result): { best: string | null; line: string } {
  const w = learnWhen(res.all)
  const said = (p: { part: string; n: number; mean: number }) => `${p.part}s ${p.mean >= 0 ? `${Math.round(p.mean)}% stiller` : `${Math.abs(Math.round(p.mean))}% more movement`} (${plural(p.n, 'practice')})`
  if (w.best) return { best: w.best, line: `When: so far ${w.best}s have helped you most: ${w.parts.map(said).join(', ')}.` }
  if (!w.total) return { best: null, line: 'When: no scored practice yet, so nothing to say about the time of day.' }
  return { best: null, line: `When: ${w.parts.map(said).join(', ')}. Too few to say which time of day suits you.` }
}

export default function Today() {
  if (!todaySense) todaySense = createSense()
  const sense = todaySense
  const swell = useRef(new Swell())
  const run = useRef(0)
  const S = useRef({ on: false, t0: 0, epoch0: 0, head: [] as number[][], gyro: 0, airHr: [] as number[][], hs: [] as NonNullable<EarSessionRec['heartSamples']>, heartState: 'off', route: '', times: [] as number[], lastHead: 0 })
  const rec = useRef(new EarRecorder())
  const [info, setInfo] = useState<EarsInfo>(earsInfo())
  const [hz, setHz] = useState(0)
  const [stage, setStage] = useState<'idle' | 'ready' | 'checkin' | 'still' | 'practice' | 'after' | 'sending' | 'done'>('idle')
  const [say, setSay] = useState<{ title: string; hint: string; left: number } | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [live, setLive] = useState<Live>({ hr: null, pace: null, phase: null, secs: 0, with: null, steps: null })
  const [heart, setHeart] = useState('off')
  /** whether the phone lets Vire keep the screen on; null before the first run */
  const [held, setHeld] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mine, setMine] = useState<Mine | null>(null)
  const [pick, setPick] = useState<SessionKind | null>(null)
  const [doing, setDoing] = useState<SessionKind>('breathe')
  const [planMs, setPlanMs] = useState(REST_MS + PRACTICE_MS)
  // what the AirPods feel while Vire is open, minute by minute: the day, the drift against the person's own days,
  // and a practice offered at the moment a rule is met
  const [model] = useState(() => loadEarModel())
  const passive = usePassive(sense, model, { paused: stage !== 'idle' && stage !== 'done' })
  const offered = useRef<PassiveOffer | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  useEffect(() => onEars(setInfo), [])
  useEffect(() => {
    if (!inApp() && info.state === 'on') postNative({ cmd: 'start' })
  }, [info.state])
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await fetch(apiUrl('ear/mine/sessions'), { headers: { authorization: `Bearer ${earKey()}` } })
        if (res.ok && alive) setMine((await res.json()) as Mine)
      } catch {
        /* offline: the plan starts at day one on screen */
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const s = S.current
    const offs = [
      sense.on('head', (h) => {
        if (h.source !== 'airpods') return
        s.lastHead = performance.now()
        s.times.push(s.lastHead)
        rec.current.head(h)
        swell.current.head(h.yaw, h.pitch)
        if (!s.on) return
        if (h.rx !== undefined) s.gyro++
        s.head.push([Math.round(h.t - s.t0), r3(h.pitch), r3(h.yaw), r3(h.roll), r3(h.ax), r3(h.ay), r3(h.az), r3(h.rx ?? 0), r3(h.ry ?? 0), r3(h.rz ?? 0)])
      }),
      sense.on('pulse', (p) => {
        if (p.source !== 'airpods' || !p.bpm) return
        setLive((l) => ({ ...l, hr: Math.round(p.bpm!) }))
        if (s.on) s.airHr.push([Math.max(0, Math.round(p.t - s.t0)), Math.round(p.bpm * 10) / 10])
      }),
      onNative((m) => {
        if (m.k === 'status') {
          s.heartState = m.hr
          if (m.route) s.route = m.route
          setHeart(m.hr)
        } else if (m.k === 'hrs' && s.on) s.hs.push({ t: Math.round(m.t - s.epoch0), bpm: m.bpm, src: String(m.src ?? ''), model: String(m.model ?? ''), n: m.n })
      }),
    ]
    if (inApp()) postNative({ cmd: 'start' })
    const tick = setInterval(() => {
      const now = performance.now()
      s.times = s.times.filter((t) => now - t < 2000)
      setHz(Math.round(s.times.length / 2))
    }, 500)
    return () => {
      offs.forEach((off) => off())
      clearInterval(tick)
      run.current++
      s.on = false
      sense.setHeartSession(false)
      swell.current.stop()
    }
  }, [sense])

  const connect = useCallback(async () => {
    setError(null)
    if (inApp()) return postNative({ cmd: 'start' })
    // a phone's browser cannot reach AirPods at all: say so at once, and where Today does run
    const elsewhere = 'Today runs in the Vire iPhone app, or in Chrome on a Mac with the Vire Ears helper. Watch a run shows it in 40 seconds.'
    if (here() === 'phone') return setError(`AirPods cannot connect in this phone's browser. ${elsewhere}`)
    if (!(await connectEars())) setError(`No AirPods found on this ${here()}. ${elsewhere}`)
  }, [])

  const start = useCallback(
    async (kind: SessionKind) => {
      const token = ++run.current
      const sp = speed()
      const s = S.current
      const sw = swell.current
      setError(null)
      setResult(null)
      setDoing(kind)
      const practiceLen = practiceMs(kind, mine)
      setPlanMs(REST_MS + practiceLen)
      // the screen hold and the sound may only start inside this tap: both are asked for before anything is awaited
      const holding = keepScreenOn(setHeld)
      await sw.start()
      const awake = await holding
      postNative({ cmd: 'start' })
      sense.setHeartSession(true)
      // The iPhone asks for Health the first time, and the sheet covers Vire: the minute starts only once that is
      // answered and the heart session runs (or was refused). A Mac has no heart session: it goes on after a moment.
      setStage('ready')
      for (const r0 = performance.now(); ; ) {
        const el = performance.now() - r0
        const st = s.heartState
        const seen = document.visibilityState !== 'hidden'
        if (seen && (st === 'on' || st === 'denied')) break
        if (seen && st !== 'starting' && el > 1500 / sp) break
        if (el > 90_000) break
        await wait(150)
        if (token !== run.current) {
          awake()
          return
        }
      }
      const t0 = performance.now()
      Object.assign(s, { on: true, t0, epoch0: Date.now(), head: [], gyro: 0, airHr: [], hs: [], lastHead: t0 })
      const at = new Date().toISOString()
      const steps: EarStep[] = []
      const phases: SessionPhase[] = []
      const breaths: PacedBreath[] = []
      const adapt: PaceCheck[] = []
      const sound: EarSessionRec['sound'] = []
      const now = () => performance.now() - t0
      let stopped: string | null = null

      // The sound: pieces made on a Modal GPU. The nearest piece of the set (by practice, pace and calm) plays at
      // once; while the practice goes on, Modal is asked for a new piece at the pace and stillness the AirPods
      // just read, and it takes over when it arrives (about half a minute later). Until a piece is there, and
      // whenever none can be had, the phone's own sea plays.
      let manifest: SoundManifest | null = null
      const gotManifest = loadManifest().then((m) => (manifest = m)).catch(() => null)
      void warm()
      const playing: { sea: string; left: string } = { sea: '', left: '' }
      let swapping = true
      let asking = false
      let liveAsked = 0
      const calmOf = (mv: number | null) => Math.max(0.3, Math.min(0.95, 1 - (mv ?? 1.5) / 4))
      const nearest = (k: SessionKind, stage: SoundStage, pace: number, calm: number): SoundInfo | null => {
        const beds = (manifest?.beds ?? []).filter((b) => b.input?.kind === k)
        const far = (b: (typeof beds)[number]) => (b.input!.stage === stage ? 0 : 4) + Math.abs(b.input!.pace - pace) + Math.abs(b.input!.calm - calm) * 3
        return beds.sort((a, b) => far(a) - far(b))[0] ?? null
      }
      const put = (stem: 'sea' | 'left', id: string, buffer: AudioBuffer, made: 'live' | 'set') => {
        if (token !== run.current || !s.on || !swapping || playing[stem] === id) return
        sw.setStem(stem, buffer, id)
        playing[stem] = id
        sound.push({ id, t: Math.round(now()), made })
      }
      const piece = async (stem: 'sea' | 'left', k: SessionKind, stage: SoundStage, pace: number, calm: number, live: boolean) => {
        const ctx = sw.context
        if (!ctx) return
        await gotManifest
        const bed = nearest(k, stage, pace, calm)
        if (bed && bed.id !== playing[stem]) {
          try {
            const res = await fetch(bed.url)
            if (res.ok) put(stem, bed.id, await ctx.decodeAudioData(await res.arrayBuffer()), 'set')
          } catch {
            /* the phone's own sea goes on */
          }
        }
        if (!live || asking || liveAsked >= 5 || !manifest?.live) return
        asking = true
        liveAsked++
        try {
          const got = await nextSegment({ kind: k, stage, pace, calm, waitMs: 30_000 }, ctx)
          if (got.info.made === 'live') put(stem, got.info.id, got.buffer, 'live')
        } catch {
          /* no new piece this time */
        } finally {
          asking = false
        }
      }
      const stop = (why: string | null) => {
        s.on = false
        sense.setHeartSession(false)
        sw.stop()
        awake()
        setSay(null)
        setStage('idle')
        if (why) setError(why)
      }
      /** wait, counting down on screen; false when the loop was left or the page went away */
      const hold = async (ms: number, title: string, hint: string, tick?: () => void): Promise<boolean> => {
        const a = performance.now()
        const len = ms / sp
        while (performance.now() - a < len) {
          setSay({ title, hint, left: Math.ceil(((len - (performance.now() - a)) * sp) / 1000) })
          setElapsed(now() * sp)
          tick?.()
          await wait(100)
          if (token !== run.current) return false
          // On the iPhone the AirPods stop when Vire is hidden. On a Mac the helper keeps sending behind another
          // window, so the run goes on there.
          if (document.visibilityState === 'hidden' && inApp()) {
            stopped = 'The screen went off or Vire was hidden, and the AirPods stop then. Keep Vire open and start again.'
            return false
          }
          // nothing from the AirPods for a quarter of a minute: they are out of the ears or on another device, and
          // a result made of that would be made of nothing
          if (performance.now() - s.lastHead > Math.max(4000, PODS_GONE_MS / sp)) {
            stopped = 'Your AirPods stopped sending: they are out of your ears, or they moved to another device. Put them in and start again.'
            return false
          }
        }
        return true
      }
      const asked = async (list: { ask: EarStep['ask']; ms: number; say: string; hint: string }[], record: boolean): Promise<boolean> => {
        for (const st of list) {
          const a = performance.now()
          if (st.ask === 'smile') sw.chime(true)
          if (!(await hold(st.ms, st.say, st.hint))) return false
          const b = performance.now()
          steps.push({ ask: st.ask, t0: Math.round(a - t0), t1: Math.round(b - t0) })
          if (record) rec.current.step(st.ask, a, b)
        }
        return true
      }
      const done = async (): Promise<void> => {
        if (token !== run.current) return void (s.on = false)
        stop(stopped)
      }

      // ---- 1. check-in: the day's minute ----
      setStage('checkin')
      rec.current.begin(t0)
      if (!(await asked(TEACH_STEPS, true))) return done()
      phases.push({ name: 'checkin', t0: 0, t1: Math.round(now()) })
      const shell = inApp() ? ('ios' as const) : ('mac' as const)
      const daily: EarRecording = { ...rec.current.end({ userId: null, shell, ua: navigator.userAgent }), face: [], voice: [], kind: 'daily' }
      if (s.route) daily.device.route = s.route
      // sent while the practice goes on: whatever happens next, the minute is safe
      const sentDaily: Promise<EarStored | null> = api<EarStored>('ear/recordings', { recording: daily, key: earKey() })
        .then(async (stored) => {
          await keepMinute(daily, stored.id).catch(() => {})
          return stored
        })
        .catch(() => null)

      // ---- 2a. the still stretch before the practice ----
      setStage('still')
      sw.centre()
      sw.level(0.55, 4)
      sw.chime()
      sound.push({ id: 'sea-own', t: Math.round(now()), made: 'tone' })
      void piece('sea', kind, 'settle', 10, 0.55, false)
      if (kind !== 'walk') void piece('left', kind === 'breathe' ? 'scan' : 'walk', 'settle', 10, 0.55, false)
      const b0 = now()
      {
        const a = performance.now()
        let k = 0
        if (!(await hold(STILL_MS, 'Sit still', 'Breathe as you like. The sound is coming in.', () => (k++ % 40 === 0 ? sw.breath(1.8, 2.2, 0.25) : undefined)))) return done()
        steps.push({ ask: 'rest', t0: Math.round(a - t0), t1: Math.round(performance.now() - t0) })
      }
      const b1 = now()
      phases.push({ name: 'before', t0: Math.round(b0), t1: Math.round(b1) })
      const own: BreathRead = breathRate(s.head, b0, b1)
      const moveBefore = stillness(s.head, b0 + (b1 - b0) * 0.2, b1)

      // ---- 2b. the practice ----
      setStage('practice')
      sw.chime()
      const p0 = now()
      const len = practiceLen / sp
      if (kind === 'breathe') {
        let pacer = newPacer(startPace(own))
        void piece('sea', 'breathe', 'settle', pacer.pace, calmOf(moveBefore), true)
        let atPace = 0
        let paceFrom = now()
        while (now() - p0 < len) {
          const dur = 60_000 / pacer.pace
          const inMs = dur * IN_SHARE
          const a = now()
          sw.breath(inMs / sp / 1000, (dur - inMs) / sp / 1000)
          setLive((l) => ({ ...l, pace: pacer.pace, phase: 'in', secs: inMs / sp / 1000 }))
          if (!(await hold(inMs, 'Breathe in', 'As the sea rises.'))) return done()
          const mid = now()
          setLive((l) => ({ ...l, phase: 'out', secs: (dur - inMs) / sp / 1000 }))
          if (!(await hold(dur - inMs, 'Breathe out', 'As it falls.'))) return done()
          const end = now()
          if (end - mid >= 1 && mid - a >= 1) breaths.push({ t0: Math.floor(a), tMid: Math.round(mid), t1: Math.ceil(end), perMin: pacer.pace })
          atPace++
          if (atPace >= breathsAt(pacer.pace)) {
            const f = followsPace(s.head, paceFrom, now(), pacer.pace)
            const r = breathRate(s.head, paceFrom, now())
            const mv = stillness(s.head, paceFrom, now())
            const readable = f.follows || (r.perMin !== null && r.conf >= 0.35)
            const still = mv !== null && mv <= Math.max(1.5, (moveBefore ?? 1.5) * 1.3)
            const d = decide(pacer, { follows: f.follows, readable, still })
            adapt.push({ t: Math.round(now()), from: pacer.pace, to: d.next.pace, follows: f.follows, coherence: r3(f.coherence), readable, moveDegS: mv === null ? null : r3(mv), by: d.by })
            setLive((l) => ({ ...l, with: d.by === 'held' ? false : d.by === 'breath' ? true : null }))
            if (d.next.pace !== pacer.pace) void piece('sea', 'breathe', d.next.pace <= 7 ? 'deep' : 'settle', d.next.pace, calmOf(mv), true)
            if (d.next.pace !== pacer.pace || d.by !== 'held') {
              atPace = 0
              paceFrom = now()
            } else atPace = Math.max(0, atPace - 1)
            pacer = d.next
          }
        }
      } else if (kind === 'scan') {
        void piece('sea', 'scan', 'deep', 6, calmOf(moveBefore), true)
        const each = len / SCAN.length
        for (let i = 0; i < SCAN.length; i++) {
          sw.chime()
          let k = 0
          if (!(await hold(each * sp, SCAN[i], 'Notice it. Let it be heavy.', () => (k++ % 100 === 0 ? sw.breath(4, 6, 0.5) : undefined)))) return done()
        }
      } else {
        void piece('sea', 'walk', 'deep', 6, 0.6, true)
        let k = 0
        const feel = () => {
          if (k++ % 20) return
          sw.breath(1, 1, 0.3)
          const w = walkRead(s.head, now() - 6000, now())
          setLive((l) => ({ ...l, steps: w.walkedS >= 2 ? w.stepsPerMin : null }))
        }
        if (!(await hold(len * sp - SIT_MS, 'Stand up and walk', 'Any pace. Your AirPods feel the steps.', feel))) return done()
        sw.chime()
        if (!(await hold(SIT_MS, 'Sit down again', 'The re-check comes next.'))) return done()
      }
      phases.push({ name: 'session', t0: Math.round(p0), t1: Math.round(now()) })
      swapping = false
      setLive((l) => ({ ...l, phase: null, pace: null, steps: null }))

      // ---- 3. after: the same still stretch, and two smiles ----
      setStage('after')
      sw.chime()
      sw.level(0.3, 3)
      const a0 = now()
      {
        let k = 0
        const first = AFTER[0]
        const a = performance.now()
        if (!(await hold(first.ms, first.say, first.hint, () => (k++ % 40 === 0 ? sw.breath(1.8, 2.2, 0.25) : undefined)))) return done()
        steps.push({ ask: 'rest', t0: Math.round(a - t0), t1: Math.round(performance.now() - t0) })
      }
      sw.level(0, 2)
      if (!(await asked(AFTER.slice(1), false))) return done()
      phases.push({ name: 'after', t0: Math.round(a0), t1: Math.round(now()) })

      // ---- 4. what it did, and what was learned ----
      s.on = false
      sense.setHeartSession(false)
      sw.chime(true)
      const pieces = { set: sound.filter((x) => x.made === 'set').length, live: sound.filter((x) => x.made === 'live').length }
      sw.stop()
      awake()
      setSay(null)
      setStage('sending')
      const head = s.head
      const span = head.length > 1 ? (head[head.length - 1][0] - head[0][0]) / 1000 : 0
      const session: EarSessionRec = {
        v: 1,
        at,
        kind,
        device: { shell, gyro: s.gyro > head.length / 2, hz: span > 0 ? Math.round(((head.length - 1) / span) * 10) / 10 : 0, ua: navigator.userAgent, ...(s.route ? { route: s.route } : {}) },
        head,
        pulse: [],
        airHr: s.airHr,
        heartSamples: s.hs,
        heartState: s.heartState,
        phases,
        breaths,
        steps,
        sound,
        day: dayOf(mine).day,
        tzMin: -new Date().getTimezoneOffset(),
        ...(offered.current ? { offered: { rule: offered.current.rule, why: offered.current.why, byDefault: offered.current.byDefault } } : {}),
        own,
        adapt,
      }
      const read = readSession(session)
      let id: string | null = null
      let all: SessionRead[] = [...(mine?.sessions ?? []), read]
      let learned: Learned = learn(all.map((x) => ({ kind: x.kind, settle: x.happened === false ? null : x.settle, at: x.at })))
      let sent = false
      // the practice exists only on this page until the server has it: try a few times before giving up
      for (let attempt = 0; attempt < 4 && !sent; attempt++) {
        try {
          if (attempt) await wait(2500 * attempt)
          const kept = await api<Mine & { id: string }>('ear/sessions', { key: earKey(), session })
          id = kept.id
          learned = kept.learned
          all = kept.sessions
          setMine({ sessions: kept.sessions, learned: kept.learned })
          sent = true
        } catch (e) {
          if (attempt === 3) setError(`The practice was not sent: ${(e as Error)?.message ?? e}`)
        }
      }
      const stored = await Promise.race([sentDaily, wait(6000).then(() => null)])
      let minutes: EarRecording[] = [daily]
      try {
        await syncMinutes(4000)
        minutes = fullMinutes([...(await listMinutes()).filter((r) => r.at !== daily.at), daily], daily)
      } catch {
        /* the usual is shown from this minute alone */
      }
      let heard: Heard[] = []
      try {
        heard = heardInMinute(loadEarModel(), daily)
      } catch {
        /* no model on this device, or it could not read the minute */
      }
      setResult({ read, learned, all, minutes, heard, id, daily: stored, rows: head.length, pieces, sent })
      setStage('done')
    },
    [sense, mine],
  )

  const quit = useCallback(() => {
    run.current++
    S.current.on = false
    sense.setHeartSession(false)
    swell.current.stop()
    setSay(null)
    setStage('idle')
  }, [sense])

  const streaming = hz >= 10
  const linked = info.state === 'on' || inApp()
  const { day, doneToday } = dayOf(mine)
  const next = pick ?? mine?.learned.next ?? 'breathe'
  const running = stage === 'checkin' || stage === 'still' || stage === 'practice' || stage === 'after'
  const r = result?.read
  const v = r ? verdict(r) : null
  const hr = r ? heartRow(r) : null
  const ll = result ? learnedLine(result.learned) : null
  const where = stage === 'checkin' ? 'Check-in' : stage === 'still' || stage === 'practice' ? NAME[doing] : stage === 'after' ? 'Re-check' : `Day ${day}`
  return (
    <main className="el td" data-stage={stage}>
      <header className="el-top">
        <a className="el-mark" href="#/">Vire</a>
        <span className="el-where">{where}</span>
      </header>
      <section className="td-main">
        {stage === 'idle' && (
          <>
            <p className="td-day" data-day={day}>
              Day {day} of your plan{doneToday ? ', done today' : ''}
            </p>
            <h1>Today, about five minutes.</h1>
            <p className="el-lede">AirPods in, camera off. Your AirPods follow every step.</p>
            <ol className="td-steps">
              <li>
                <b>Check-in</b>
                <span>a minute of asked smiles, nods and head shakes, set against your usual. Then 22 seconds sitting still: head movement and heart rate</span>
              </li>
              <li data-next={next}>
                <b>{NAME[next]}</b>
                <span data-plan={Math.round(practiceMs(next, mine) / 1000)}>
                  {ABOUT[next]} {next === 'walk' ? '' : `About ${mmss(Math.round(practiceMs(next, mine) / 1000))}${next === 'breathe' && learnLength(mine?.sessions ?? []).of ? ', set from your own practices' : ''}.`}
                </span>
              </li>
              <li>
                <b>Re-check</b>
                <span>the same 22 seconds sitting still: calmer after than before? Then two smiles, shown but not counted</span>
              </li>
            </ol>
            <div className="el-btns">
              {!linked && !streaming ? (
                <button type="button" className="lab-btn primary" onClick={connect} disabled={info.state === 'connecting'}>
                  Connect AirPods
                </button>
              ) : (
                <button
                  type="button"
                  className="lab-btn primary"
                  onClick={() => {
                    offered.current = null
                    void start(next)
                  }}
                  disabled={!streaming}
                  data-start
                >
                  {doneToday ? 'Start again' : 'Start'}
                </button>
              )}
              {!linked && !streaming && (
                <a className="lab-btn td-watch" href="#/watch" data-watch>
                  No AirPods here? Watch a run
                </a>
              )}
            </div>
            {/* what a tap on Connect found, said next to the button: under the day card it sits below the fold on a phone */}
            {error && (
              <p className="el-err" role="alert" data-err="top">
                {error}
              </p>
            )}
            <p className="el-fine" data-air={streaming ? hz : 0}>
              {streaming ? `AirPods: ${hz} samples a second.` : inApp() ? 'Waiting for your AirPods. Put both in.' : info.state === 'connecting' ? 'Looking for your AirPods.' : ''}{' '}
              {pick ? `You picked ${SHORT[next]}.` : mine && mine.learned.total > 0 ? `${NAME[next]} is today's practice: ${mine.learned.why}.` : 'The first practice is slow breathing.'} Or pick:{' '}
              {SESSION_KINDS.filter((k) => k !== next).map((k, i) => (
                <span key={k}>
                  {i > 0 && ', '}
                  <button type="button" className="el-link" onClick={() => setPick(k)} data-pick={k}>
                    {SHORT[k]}
                  </button>
                </span>
              ))}
              .
            </p>
            <DayCard
              state={passive}
              onPractice={(o) => {
                offered.current = o
                void start(o.kind)
              }}
            />
          </>
        )}
        {running && say && (
          <>
            <p className="el-off" data-camera="off" data-screen={held === false ? 'free' : 'held'}>
              Camera off. AirPods only.{held === false ? ' This phone may lock itself: touch the screen now and then.' : ''}
            </p>
            {stage === 'practice' && doing === 'breathe' ? (
              <div className="td-orb" data-phase={live.phase ?? 'out'} style={{ transitionDuration: `${Math.max(0.05, live.secs)}s` }} aria-hidden="true" />
            ) : (
              <p className="el-count">{say.left}</p>
            )}
            <h1 className="el-say">{say.title}</h1>
            <p className="el-lede">{say.hint}</p>
            <ul className="td-live" aria-live="off">
              <li data-heart={heart}>
                <b>Heart</b>
                <span>{live.hr ? `${live.hr} a minute, from your AirPods` : heart === 'denied' ? 'Health is switched off for Vire' : 'waiting for your AirPods'}</span>
              </li>
              {stage === 'practice' && doing === 'breathe' && live.pace && (
                <li data-pace={live.pace}>
                  <b>Pace</b>
                  <span>
                    {live.pace} breaths a minute{live.with === true ? ', your breath is with it' : live.with === false ? ', waiting for your breath' : ''}
                  </span>
                </li>
              )}
              {stage === 'practice' && doing === 'walk' && (
                <li>
                  <b>Steps</b>
                  <span>{live.steps ? `${live.steps} a minute` : 'none felt yet'}</span>
                </li>
              )}
              <li>
                <b>AirPods</b>
                <span>{streaming ? `${hz} samples a second` : 'silent: put both in'}</span>
              </li>
            </ul>
            <div className="el-bar" aria-hidden="true">
              <i style={{ width: `${Math.min(100, (elapsed / planMs) * 100)}%` }} />
            </div>
            <div className="el-btns">
              <button type="button" className="lab-btn" onClick={quit}>
                Stop
              </button>
            </div>
          </>
        )}
        {stage === 'ready' && (
          <>
            <h1>Getting your AirPods ready.</h1>
            <p className="el-lede">{inApp() ? 'If Health asks, tap Allow: that is how your AirPods give their heart rate.' : 'One moment.'}</p>
            <div className="el-btns">
              <button type="button" className="lab-btn" onClick={quit}>
                Stop
              </button>
            </div>
          </>
        )}
        {stage === 'sending' && <h1>Reading what changed.</h1>}
        {stage === 'done' && result && r && v && ll && (
          <>
            <p className="td-day">Day {r.day ?? day} done</p>
            <h1 data-verdict={r.settle ?? ''}>{v.head}</h1>
            <p className="el-lede">{v.line}</p>
            <ul className="el-rows td-rows" data-result={r.kind}>
              <li data-ok={r.heartChange !== null && r.heartChange <= -1} data-row="heart">
                <b>Heart rate</b>
                {hr ? (
                  <span>
                    {hr.main}
                    <i>{hr.note}</i>
                  </span>
                ) : (
                  <span>not read: {heart === 'denied' ? 'Health is switched off for Vire' : 'the AirPods gave no heart rate in this run'}</span>
                )}
                <em>{hr?.change ?? ''}</em>
              </li>
              <li data-ok={r.settle !== null && r.settle >= 5} data-row="still">
                <b>Stillness</b>
                <span>{stillRow(r).main}</span>
                <em>{stillRow(r).change}</em>
              </li>
              {r.kind === 'breathe' && (
                <li data-ok={r.followed > 0} data-row="breath">
                  <b>Breathing</b>
                  <span>{breathRow(r).main}</span>
                  <em>{breathRow(r).own}</em>
                </li>
              )}
              {r.kind === 'walk' && r.walk && (
                <li data-ok={r.happened} data-row="walk">
                  <b>The walk</b>
                  <span>
                    {r.walk.walkedS >= 20 ? `your AirPods felt steps for ${r.walk.walkedS} of ${r.walk.ofS} seconds${r.walk.stepsPerMin ? `, about ${r.walk.stepsPerMin} a minute` : ''}` : 'your AirPods felt no walking in this run'}
                  </span>
                  <em>{r.happened ? 'it happened' : 'not counted'}</em>
                </li>
              )}
              <li data-ok={r.smileChange !== null && r.smileChange >= 0} data-row="smile">
                <b>Smile</b>
                <span>{r.before.smileDeg !== null && r.after.smileDeg !== null ? `the AirPods shifted ${r.before.smileDeg}° in your smiles before, ${r.after.smileDeg}° after` : 'not read'}</span>
                <em />
              </li>
              {result.heard.map((h) => (
                <li key={h.event} data-ok={h.heard * 2 > h.asked} data-row={`heard-${h.event}`}>
                  <b>{h.event === 'smile' ? 'Smiles' : h.event === 'nod' ? 'Nods' : 'Head shakes'} in the check-in</b>
                  <span>
                    your model heard {h.heard} of the {h.asked} asked for
                  </span>
                  <em>AirPods alone</em>
                </li>
              ))}
            </ul>
            <div className="td-learn" data-said={result.learned.said} data-total={result.learned.total}>
              <h2>{ll.head}</h2>
              <p>{ll.line}</p>
              <p data-tomorrow={result.learned.next}>
                Tomorrow: {SHORT[result.learned.next]} ({result.learned.why}).
              </p>
              {r.offered && <p data-offered={r.offered.rule}>Why now: {r.offered.why}{r.offered.byDefault ? ' (a starting threshold, until your own days give one)' : ''}</p>}
              <p data-length={howLong(result).nextS}>{howLong(result).line}</p>
              <p data-when={whenLine(result).best ?? ''}>{whenLine(result).line}</p>
            </div>
            <UsualFromMinutes minutes={result.minutes} inline />
            <p className="el-fine">
              {result.rows} AirPods samples at {r.hz} a second, no camera frames. Sound:{' '}
              {result.pieces.set + result.pieces.live === 0
                ? 'made on this phone'
                : `${plural(result.pieces.set + result.pieces.live, 'piece')} made on a Modal GPU${result.pieces.live ? `, ${result.pieces.live} of them while you practised, from what your AirPods read` : ''}`}
              , placed around you and held there as your head turned.{' '}
              {result.sent ? `Sent as ${result.id}.` : 'Not sent.'}
            </p>
            <div className="el-btns">
              <button type="button" className="lab-btn primary" onClick={() => setStage('idle')} data-done>
                Done
              </button>
            </div>
          </>
        )}
        {error && stage !== 'idle' && (
          <p className="el-err" role="alert">
            {error}
          </p>
        )}
      </section>
      <p className="el-foot">Only AirPods angles and heart rate are kept. No picture and no sound leave this {here()}. A practice and a signal, not a diagnosis or a treatment.</p>
    </main>
  )
}
