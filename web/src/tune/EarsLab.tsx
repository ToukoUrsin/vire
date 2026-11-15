// /#/ears: the teaching minute on its own, for the table and for measuring. Connect the AirPods, do three short
// rounds of smiles and nods in front of the camera, and see what the AirPods alone could tell on a round they never
// saw. Every minute a person does is kept, and the model learns from all of them: from the second minute on it is
// checked on a whole minute it never saw. Before a new minute is learned from, the model made from the earlier
// ones is asked about all of it.
// The recording (numbers only) is sent to the server under this device's own key, so the device can get its
// minutes back and the model can be worked on outside the browser.
// Once a model is here, the day's minute is done with the camera off: the same asks, the AirPods alone. It
// teaches nothing; it is read against the person's own usual, and the model says what it heard in it.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { EarEvent, EarJob, EarModel2, EarNow, EarRecording, EarScore, EarStored } from '@shared/ear'
import { EAR_EVENTS, fullMinutes, teaches, thin } from '@shared/ear'
import { createSense } from '../sense'
import { connectEars, earsInfo, forgetEars, onEars, onNative, postNative } from '../sense/native'
import type { EarsInfo } from '../sense/native'
import type { HeadFrame, Sense } from '../sense/types'
import { api, apiUrl } from '../shared/api'
import { EarRecorder, TEACH_MS, TEACH_STEPS, adoptSearch, createEarReader, earKey, forgetMinutes, heldOutScore, keepMinute, listMinutes, loadEarModel, saveEarModel, scoreModelOn, syncMinutes, trainEarModel } from './ear'
import type { EarReader } from './ear'
import { trainEar } from './model'
import { UsualFromMinutes } from './usual/Usual'
import { heardInMinute } from './usual/heard'
import type { Heard } from './usual/heard'
import './ears-lab.css'

let labSense: Sense | null = null
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** inside the iPhone app the AirPods come through the app itself, not through the Mac helper */
const inApp = () => !!(window as unknown as { webkit?: { messageHandlers?: { vire?: unknown } } }).webkit?.messageHandlers?.vire
/**
 * Keep the screen on. With the camera off nothing else does, and a phone that locks stops the AirPods' samples.
 * Returns how to let it sleep again. Quiet where the browser cannot do it.
 */
async function keepScreenOn(): Promise<() => void> {
  const wl = (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock
  try {
    const lock = await wl?.request('screen')
    return () => void lock?.release().catch(() => {})
  } catch {
    return () => {}
  }
}
/** the longest silence between two AirPods samples in a recording, in ms */
/** teaching minutes that count: a thin one (the AirPods sent too few samples) stops counting once a full one is kept */
function countKept(all: EarRecording[]): number {
  const taught = all.filter(teaches).sort((a, b) => a.at.localeCompare(b.at))
  return taught.length ? fullMinutes(taught, taught[taught.length - 1]).length : 0
}

const longestGap = (head: number[][]) => head.reduce((g, r, i) => (i ? Math.max(g, r[0] - head[i - 1][0]) : g), 0)

/** tests run the minute faster; nothing else sets this */
const speed = () => {
  try {
    return Math.max(1, Number(localStorage.getItem('vire.ears.speed')) || 1)
  } catch {
    return 1
  }
}

interface Quick {
  /** the older smile-only model: share of held-out windows it got right, and what luck reaches on this minute */
  smile: { accuracy: number; chance: number; smiles: number } | null
  nods: { airpods: number; camera: number }
  shakes: { airpods: number; camera: number }
}

/** swings of at least `min` degrees in a signal, after its slow drift is taken out */
function swings(t: number[], v: number[], min: number): number {
  if (v.length < 8) return 0
  const out: number[] = []
  let j = 0
  let sum = 0
  // moving average over about a second, as the drift
  for (let i = 0; i < v.length; i++) {
    sum += v[i]
    while (t[i] - t[j] > 1000) sum -= v[j++]
    out.push(v[i] - sum / (i - j + 1))
  }
  let count = 0
  let lastPeakT = -1e9
  let lo = out[0]
  let hi = out[0]
  let dir = 0
  for (let i = 1; i < out.length; i++) {
    const x = out[i]
    if (dir >= 0 && x > hi) hi = x
    if (dir <= 0 && x < lo) lo = x
    if (dir >= 0 && hi - x > min) {
      if (t[i] - lastPeakT > 250) count++
      lastPeakT = t[i]
      dir = -1
      lo = x
    } else if (dir <= 0 && x - lo > min) {
      dir = 1
      hi = x
    }
  }
  return count
}

function between(rows: number[][], t0: number, t1: number, col: number): { t: number[]; v: number[] } {
  const t: number[] = []
  const v: number[] = []
  for (const r of rows)
    if (r[0] >= t0 && r[0] <= t1) {
      t.push(r[0])
      v.push(r[col])
    }
  return { t, v }
}

function unwrap(v: number[]): number[] {
  const out = v.slice()
  for (let i = 1; i < out.length; i++) {
    let d = v[i] - v[i - 1]
    if (d > 180) d -= 360
    else if (d < -180) d += 360
    out[i] = out[i - 1] + d
  }
  return out
}

function quick(rec: EarRecording): Quick {
  const count = (ask: string, headCol: number, faceCol: number) => {
    let a = 0
    let c = 0
    for (const s of rec.steps.filter((x) => x.ask === ask)) {
      const h = between(rec.head, s.t0, s.t1, headCol)
      const f = between(rec.face.filter((r) => r[1] === 1), s.t0, s.t1, faceCol)
      a += swings(h.t, unwrap(h.v), 3)
      c += swings(f.t, f.v, 3)
    }
    return { airpods: a, camera: c }
  }
  // smile: the camera's smile as a share of this person's own range in this minute
  const seen = rec.face.filter((r) => r[1] === 1)
  const inSteps = (asks: string[]) => seen.filter((r) => rec.steps.some((s) => asks.includes(s.ask) && r[0] >= s.t0 + 600 && r[0] <= s.t1)).map((r) => r[2])
  const rest = inSteps(['rest', 'relax']).sort((a, b) => a - b)
  const top = inSteps(['smile']).sort((a, b) => a - b)
  let smile: Quick['smile'] = null
  if (rest.length > 20 && top.length > 20) {
    const r0 = rest[rest.length >> 1]
    const r1 = top[Math.floor(top.length * 0.9)]
    if (r1 - r0 > 0.05) {
      const head: HeadFrame[] = rec.head.map((h) => ({ t: h[0], pitch: h[1], yaw: h[2], roll: h[3], ax: h[4], ay: h[5], az: h[6], ...(rec.device.gyro ? { rx: h[7], ry: h[8], rz: h[9] } : {}), source: 'airpods' as const }))
      // only the smile part of the minute: laughing and talking move the same muscles and would muddy the teacher
      const end = rec.steps.find((s) => s.ask === 'nod')?.t0 ?? Infinity
      const part = seen.filter((r) => r[0] < end)
      const t = part.map((r) => r[0])
      const own = part.map((r) => (r[2] - r0) / (r1 - r0))
      const res = trainEar(head.filter((h) => h.t < end), t, own)
      if (res.check) smile = { accuracy: res.check.accuracy, chance: res.check.chance, smiles: res.check.smiles }
    }
  }
  return { smile, nods: count('nod', 1, 6), shakes: count('shake', 2, 7) }
}

/** a back-and-forth swing in one angle over the last second or so: [t, pitch, yaw unwrapped] rows */
function swinging(buf: number[][], col: number, other: number, min: number): boolean {
  if (buf.length < 12) return false
  const span = (c: number) => {
    let lo = Infinity
    let hi = -Infinity
    for (const r of buf) {
      if (r[c] < lo) lo = r[c]
      if (r[c] > hi) hi = r[c]
    }
    return hi - lo
  }
  const size = span(col)
  if (size < min || size < span(other)) return false
  const mean = buf.reduce((a, r) => a + r[col], 0) / buf.length
  let flips = 0
  let sign = 0
  for (const r of buf) {
    const d = r[col] - mean
    const now = d > size * 0.15 ? 1 : d < -size * 0.15 ? -1 : 0
    if (now && now !== sign) {
      if (sign) flips++
      sign = now
    }
  }
  return flips >= 2
}

const NAMES: Record<EarEvent, string> = { smile: 'Smile', nod: 'Nod', shake: 'Head shake', laugh: 'Laugh', talk: 'Talking' }
const tenths = (auc: number) => Math.round(auc * 10)

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0)

/** which path made the model, in one sentence */
function madeBy(m: EarModel2, here: string): string {
  if (m.by !== 'sandbox') return `This ${here} tried ${plural(m.tried, 'small model')} itself and kept the best for each row.`
  const score = heldOutScore(m)
  return `Modal tried ${plural(m.tried, 'model')} on ${plural(m.minutes ?? 1, 'minute')}${score == null ? '' : `, held-out score ${score.toFixed(2)}`}.`
}

/** the wider search for this person's model, in a Modal Sandbox: where it is */
interface Search {
  state: EarJob['state']
  tried: number
  minutes: number
  error?: string
}

function Row({ name, score, held, own }: { name: string; score: EarScore; held: 'round' | 'minute' | 'this'; own?: string }) {
  return (
    <li data-ok={score.ok}>
      <b>{name}</b>
      {score.windows > 0 ? (
        <span>
          right {tenths(score.auc)} times in 10 {held === 'this' ? 'over this whole minute' : held === 'minute' ? 'on a whole minute it never saw' : 'on a round it never saw'} <i>(luck reaches {tenths(score.chance)})</i>
        </span>
      ) : (
        <span>not checked: this minute had no rounds to hold back</span>
      )}
      <em>{score.ok ? `AirPods alone${own ? ` (${own})` : ''}` : 'The camera keeps this one'}</em>
    </li>
  )
}

export default function EarsLab() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const last = useRef<{ head: HeadFrame | null; smile: number; face: boolean; times: number[]; route?: string }>({ head: null, smile: 0, face: false, times: [] })
  const recRef = useRef(new EarRecorder())
  const readerRef = useRef<EarReader | null>(null)
  const follow = useRef<{
    on: boolean
    now: EarNow | null
    was: Set<EarEvent>
    counts: Record<EarEvent, number>
    base: { pitch: number; yaw: number; roll: number; t: number } | null
    /** nod and head shake straight from the angles, for when the trained model did not pass its check on them */
    rule: { use: Set<EarEvent>; buf: number[][]; yaw: number; lastYaw: number | null; until: Partial<Record<EarEvent, number>>; on: Set<EarEvent> }
  }>({
    on: false,
    now: null,
    was: new Set(),
    rule: { use: new Set(), buf: [], yaw: 0, lastYaw: null, until: {}, on: new Set() },
    counts: { smile: 0, nod: 0, shake: 0, laugh: 0, talk: 0 },
    base: null,
  })
  const [now, setNow] = useState<{ p: Partial<Record<EarEvent, number>>; on: EarEvent[]; counts: Record<EarEvent, number> } | null>(null)
  const run = useRef(0)
  /** lets the screen sleep again after the camera-off follow view */
  const sleep = useRef<(() => void) | null>(null)
  const [info, setInfo] = useState<EarsInfo>(earsInfo())
  const [hz, setHz] = useState(0)
  const [state, setState] = useState<'idle' | 'starting' | 'minute' | 'sending' | 'done' | 'follow' | 'today'>('idle')
  /** the minute being done now is the day's minute: the camera stays off */
  const [off, setOff] = useState(false)
  /** the day's minute, camera off: every minute of this person for the usual, and what the model heard in this one */
  const [today, setToday] = useState<{ rec: EarRecording; mine: EarRecording[]; heard: Heard[]; stored: EarStored | null } | null>(null)
  const [step, setStep] = useState(-1)
  const [left, setLeft] = useState(0)
  const [error, setError] = useState<string | null>(null)
  /** what the iPhone app says about the AirPods, when this page runs inside it */
  const [phone, setPhone] = useState<{ permission?: string; available?: boolean; route?: string; error?: string } | null>(null)
  const [result, setResult] = useState<{ rec: EarRecording; quick: Quick; stored: EarStored | null; again: Partial<Record<EarEvent, EarScore>> | null; before: number; mine: EarRecording[] } | null>(null)
  /** the model this device runs: the one it made itself right after a minute, then the wider search's when that lands */
  const [model, setModel] = useState<EarModel2 | null>(() => loadEarModel())
  const modelRef = useRef(model)
  const [search, setSearch] = useState<Search | null>(null)
  const watching = useRef(0)
  /** how many of this person's minutes are kept on this device */
  const [kept, setKept] = useState(0)

  if (!labSense) labSense = createSense()
  const sense = labSense

  useEffect(() => onEars(setInfo), [])
  // a browser that used the Mac helper before is connected again by itself: ask it for the AirPods then too
  useEffect(() => {
    if (!inApp() && info.state === 'on') postNative({ cmd: 'start' })
  }, [info.state])
  // this person's earlier minutes: the ones on this device at once, then any the server still has for it
  useEffect(() => {
    let live = true
    void listMinutes().then((m) => live && setKept(countKept(m)))
    void syncMinutes().then(() => listMinutes()).then((m) => live && setKept(countKept(m)))
    return () => {
      live = false
    }
  }, [])
  /** run this model from now on: on screen, and in the follow view if it is open */
  const use = useCallback((m: EarModel2 | null) => {
    modelRef.current = m
    setModel(m)
    const f = follow.current
    if (f.on && m) {
      readerRef.current = createEarReader(m)
      f.rule.use = new Set((['nod', 'shake'] as const).filter((e) => !m.events[e]?.score.ok))
    }
  }, [])
  /** where the wider search is; when it is done its model is taken by itself, and the server is told it landed */
  const take = useCallback(
    (job: EarJob) => {
      setSearch({ state: job.state, tried: job.tried, minutes: job.minutes ?? 1, ...(job.error ? { error: job.error } : {}) })
      if (job.state !== 'done' || !job.model) return
      const merged = adoptSearch(modelRef.current, job.model)
      if (merged) {
        if (merged.shell !== 'sim') saveEarModel(merged)
        use(merged)
      }
      const mine = modelRef.current
      if (!job.landedAt && mine?.by === 'sandbox' && mine.at === job.model.at) void api(`ear/jobs/${job.id}/landed`, {}).catch(() => {})
    },
    [use],
  )
  const watch = useCallback(
    async (id: string) => {
      const token = ++watching.current
      for (let i = 0; i < 240 && token === watching.current; i++) {
        try {
          const job = await api<EarJob>(`ear/jobs/${id}`)
          if (token !== watching.current) return
          take(job)
          if (job.state === 'done' || job.state === 'failed') return
        } catch {
          /* the network blinked: ask again */
        }
        await wait(1000)
      }
    },
    [take],
  )
  // the search for this device's newest minute may have finished while the page was closed: take its model now
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const res = await fetch(apiUrl('ear/mine/job'), { headers: { authorization: `Bearer ${earKey()}` } })
        if (!res.ok || !live) return
        const job = (await res.json()) as EarJob
        if (job.state === 'queued' || job.state === 'running') void watch(job.id)
        else if (job.state === 'done') take(job)
      } catch {
        /* offline: the model already here goes on */
      }
    })()
    return () => {
      live = false
      watching.current++
    }
  }, [take, watch])
  // inside the iPhone app there is nothing to connect to: ask for the AirPods at once and keep the app's own account of them
  useEffect(() => {
    if (!inApp()) return
    const off = onNative((m) => {
      if (m.k === 'status') {
        last.current.route = m.route
        setPhone({ permission: m.permission, available: m.available, route: m.route, error: m.error })
      }
    })
    postNative({ cmd: 'start' })
    return off
  }, [])

  useEffect(() => {
    const l = last.current
    const offs = [
      sense.on('head', (h) => {
        if (h.source !== 'airpods') return
        l.head = h
        l.times.push(performance.now())
        recRef.current.head(h)
        const f = follow.current
        if (f.on && f.rule.use.size) {
          const r = f.rule
          let d = r.lastYaw == null ? 0 : h.yaw - r.lastYaw
          if (d > 180) d -= 360
          else if (d < -180) d += 360
          r.yaw += d
          r.lastYaw = h.yaw
          r.buf.push([h.t, h.pitch, r.yaw])
          while (r.buf.length && h.t - r.buf[0][0] > 1300) r.buf.shift()
          for (const [e, col, other, min] of [['nod', 1, 2, 6], ['shake', 2, 1, 9]] as const) {
            if (!r.use.has(e)) continue
            if (swinging(r.buf, col, other, min)) {
              if (!r.on.has(e)) {
                r.on.add(e)
                f.counts[e]++
              }
              r.until[e] = h.t + 600
            } else if (r.on.has(e) && h.t > (r.until[e] ?? 0)) r.on.delete(e)
          }
        }
        if (f.on && readerRef.current) {
          try {
            const n = readerRef.current.push(h)
            if (n) {
              for (const e of n.on) if (!f.was.has(e)) f.counts[e]++
              f.was = new Set(n.on)
              f.now = n
            }
          } catch (e) {
            console.error('[ears] reader failed', e)
            readerRef.current = null
          }
        }
      }),
      sense.on('face', (f) => {
        l.smile = f.smile
        l.face = f.present
        recRef.current.face(f)
      }),
      sense.on('voice', (v) => recRef.current.voice(v)),
    ]
    const tick = setInterval(() => {
      const now = performance.now()
      l.times = l.times.filter((t) => now - t < 2000)
      setHz(Math.round(l.times.length / 2))
    }, 500)
    const fast = setInterval(() => {
      const f = follow.current
      if (f.on) setNow({ p: f.now?.p ?? {}, on: [...(f.now?.on ?? []), ...f.rule.on], counts: { ...f.counts } })
    }, 150)
    return () => {
      offs.forEach((off) => off())
      clearInterval(tick)
      clearInterval(fast)
      run.current++
      sense.stop()
    }
  }, [sense])

  // the head as the AirPods feel it: a horizon that tips with roll and rides with pitch, a needle for the turn
  useEffect(() => {
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const c = canvasRef.current
      const h = last.current.head
      if (!c) return
      const g = c.getContext('2d')
      if (!g) return
      const w = c.width
      const hh = c.height
      g.clearRect(0, 0, w, hh)
      const ink = getComputedStyle(c).color
      g.strokeStyle = ink
      g.fillStyle = ink
      g.globalAlpha = 0.25
      g.lineWidth = 2
      g.beginPath()
      g.arc(w / 2, hh / 2, hh * 0.42, 0, Math.PI * 2)
      g.stroke()
      if (!h || performance.now() - (last.current.times.at(-1) ?? 0) > 1000) {
        follow.current.base = null
        return
      }
      // the AirPods have no idea where "straight ahead" is: it is taken as where the head has rested lately
      const f = follow.current
      const turn = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180
      const t = performance.now()
      if (!f.base) f.base = { pitch: h.pitch, yaw: h.yaw, roll: h.roll, t }
      const k = Math.min(1, (t - f.base.t) / 12000)
      f.base.pitch += (h.pitch - f.base.pitch) * k
      f.base.roll += (h.roll - f.base.roll) * k
      f.base.yaw = turn(f.base.yaw + turn(h.yaw - f.base.yaw) * k)
      f.base.t = t
      const rad = Math.PI / 180
      const yaw = Math.max(-65, Math.min(65, turn(h.yaw - f.base.yaw))) * rad
      const pitch = Math.max(-40, Math.min(40, h.pitch - f.base.pitch)) * rad
      const roll = Math.max(-40, Math.min(40, h.roll - f.base.roll)) * rad
      const smile = f.on ? Math.max(0, Math.min(1, f.now?.p.smile ?? 0)) : 0
      const laugh = f.on && !!f.now?.on.includes('laugh')
      const R = hh * 0.36
      g.globalAlpha = 1
      g.lineCap = 'round'
      g.save()
      g.translate(w / 2, hh / 2)
      g.rotate(-roll)
      g.lineWidth = w / 64
      g.beginPath()
      g.ellipse(0, 0, R * 0.8, R, 0, 0, Math.PI * 2)
      g.stroke()
      // drawn as a mirror: turn left and the face turns to the left of the screen
      const dx = -Math.sin(yaw) * R * 0.55
      const dy = -Math.sin(pitch) * R * 0.5
      const wide = Math.cos(yaw)
      for (const side of [-1, 1]) {
        // the AirPods themselves, on the far side they slide behind the head
        const ex = side * R * 0.8 - dx * 0.25
        g.globalAlpha = 0.9
        g.lineWidth = w / 40
        g.beginPath()
        g.moveTo(ex, dy * 0.3 - R * 0.02)
        g.lineTo(ex, dy * 0.3 + R * 0.22)
        g.stroke()
        g.globalAlpha = 1
        g.beginPath()
        g.arc(dx + side * R * 0.3 * wide, dy - R * 0.14, w / 60, 0, Math.PI * 2)
        g.fill()
      }
      g.lineWidth = w / 80
      g.beginPath()
      g.moveTo(dx * 1.3, dy)
      g.lineTo(dx * 1.3, dy + R * 0.16)
      g.stroke()
      const mw = R * (0.26 + 0.08 * smile) * wide
      const my = dy + R * 0.44
      const curve = (0.04 + smile * 0.26) * R
      g.lineWidth = w / 64
      g.beginPath()
      g.moveTo(dx - mw, my - curve * 0.35)
      g.quadraticCurveTo(dx, my + curve, dx + mw, my - curve * 0.35)
      if (laugh) g.quadraticCurveTo(dx, my + curve * 2.2, dx - mw, my - curve * 0.35)
      g.stroke()
      g.restore()
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  const connect = useCallback(async () => {
    setError(null)
    if (inApp()) {
      postNative({ cmd: 'start' })
      return
    }
    const ok = await connectEars()
    if (!ok) setError('Vire Ears did not answer on this Mac. In Chrome, allow this page to reach devices on your network if it asks.')
  }, [])

  const minute = useCallback(async () => {
    if (!videoRef.current) return
    const token = ++run.current
    setError(null)
    setResult(null)
    setToday(null)
    setOff(false)
    setSearch(null)
    watching.current++
    setState('starting')
    // what the AirPods send before the camera comes on, kept with the minute: if the minute itself has fewer, it shows
    const idleHz = Math.round(last.current.times.filter((t) => performance.now() - t < 2000).length / 2)
    try {
      // the camera only. With the microphone open an iPhone may put the AirPods in call mode, and they then send
      // a few motion samples a second instead of 50 (the minute of 14.11.2026 19:11 had 6). Nothing the minute
      // teaches (smile, nod, head shake) needs sound.
      await sense.start({ video: videoRef.current, audio: false })
    } catch (e) {
      setState('idle')
      setError((e as Error)?.message ?? 'The camera did not start.')
      return
    }
    // a face in view before the minute starts, for up to ten seconds
    for (let i = 0; i < 100 && !last.current.face && token === run.current; i++) await wait(100)
    if (token !== run.current) return
    const rec = recRef.current
    rec.begin(performance.now())
    setState('minute')
    let laugh: HTMLAudioElement | null = null
    for (let i = 0; i < TEACH_STEPS.length; i++) {
      const s = TEACH_STEPS[i]
      setStep(i)
      const t0 = performance.now()
      if (s.ask === 'laugh') {
        laugh = new Audio(apiUrl('daily/laugh.mp3'))
        void laugh.play().catch(() => {})
      }
      const ms = s.ms / speed()
      while (performance.now() - t0 < ms) {
        setLeft(Math.ceil((ms - (performance.now() - t0)) / 1000))
        await wait(100)
        if (token !== run.current) {
          laugh?.pause()
          return
        }
      }
      if (s.ask === 'laugh') laugh?.pause()
      rec.step(s.ask, t0, performance.now())
    }
    const recording = rec.end({ userId: null, shell: inApp() ? 'ios' : 'mac', ua: navigator.userAgent })
    recording.device.idleHz = idleHz
    if (last.current.route) recording.device.route = last.current.route
    sense.stop()
    // stopping the camera also tells the AirPods to stop: ask for them again, the head keeps turning on screen
    postNative({ cmd: 'start' })
    setStep(-1)
    setState('sending')
    await wait(50)
    // the minute is sent first: whatever the training does, the recording is safe
    let stored: (EarStored & { jobId?: string }) | null = null
    try {
      stored = await api<EarStored & { jobId?: string }>('ear/recordings', { recording, key: earKey() })
    } catch (e) {
      setError(`The minute was not sent: ${(e as Error)?.message ?? e}`)
    }
    // every minute this person has done: the ones kept here, any the server still has, and this one. The model
    // learns from the ones the camera taught; the usual is read from all of them, the camera-off ones too
    let mine: EarRecording[] = [recording]
    let usual: EarRecording[] = [recording]
    try {
      await keepMinute(recording, stored?.id ?? null)
      await syncMinutes(4000)
      const all = await listMinutes()
      if (recording.device.shell !== 'sim') {
        // a minute where the AirPods sent far too few samples is left out once a full one is here
        usual = fullMinutes([...all.filter((r) => r.at !== recording.at), recording], recording)
        mine = usual.filter(teaches)
      }
      setKept(countKept(all))
    } catch (e) {
      console.error('[ears] earlier minutes not read', e)
    }
    let q: Quick = { smile: null, nods: { airpods: 0, camera: 0 }, shakes: { airpods: 0, camera: 0 } }
    let model: EarModel2 = { v: 2, at: recording.at, by: 'device', shell: recording.device.shell, hz: recording.device.hz, gyro: recording.device.gyro, events: {}, tried: 0 }
    // a model from the earlier minutes is on this device: before anything is learned from the new minute, ask
    // that model about all of it. Nothing in this minute went into it.
    let again: Partial<Record<EarEvent, EarScore>> | null = null
    let before = 0
    try {
      const old = loadEarModel()
      if (old && old.shell !== 'sim' && old.at !== recording.at) {
        const got = scoreModelOn(old, recording)
        if (Object.keys(got).length) {
          again = got
          before = old.minutes ?? 1
        }
      }
      q = quick(recording)
      model = trainEarModel(mine)
    } catch (e) {
      console.error('[ears] training failed', e)
      setError(`Training stopped: ${(e as Error)?.message ?? e}`)
    }
    if (recording.device.shell !== 'sim' && Object.keys(model.events).length) saveEarModel(model)
    use(model)
    setResult({ rec: recording, quick: q, stored, again, before, mine: usual })
    setState('done')
    // the same minutes now go through a far wider search in a Modal Sandbox; its model comes back by itself
    if (stored?.jobId) void watch(stored.jobId)
  }, [sense, use, watch])

  /** The day's minute: the same asks with the camera off. Nothing is learned from it; it is read. */
  const daily = useCallback(async () => {
    const token = ++run.current
    setError(null)
    setToday(null)
    follow.current.on = false
    sense.stop()
    postNative({ cmd: 'start' })
    setOff(true)
    const rest = await keepScreenOn()
    const rec = recRef.current
    rec.begin(performance.now())
    setState('minute')
    let hidden = false
    for (let i = 0; i < TEACH_STEPS.length && !hidden; i++) {
      const s = TEACH_STEPS[i]
      setStep(i)
      const t0 = performance.now()
      const ms = s.ms / speed()
      while (performance.now() - t0 < ms) {
        setLeft(Math.ceil((ms - (performance.now() - t0)) / 1000))
        await wait(100)
        if (token !== run.current) {
          rest()
          return
        }
        if (document.visibilityState === 'hidden') hidden = true
      }
      rec.step(s.ask, t0, performance.now())
    }
    rest()
    // no camera and no microphone were on: whatever is in those two lists is not from this minute
    const recording: EarRecording = { ...rec.end({ userId: null, shell: inApp() ? 'ios' : 'mac', ua: navigator.userAgent }), face: [], voice: [], kind: 'daily' }
    if (last.current.route) recording.device.route = last.current.route
    setStep(-1)
    setState('sending')
    await wait(50)
    // a minute with a hole in it is not read: a locked or hidden phone stops the samples, and what is left misleads
    const gap = longestGap(recording.head)
    if (hidden || recording.head.length < 100 || gap > 3000) {
      setError(
        hidden || gap > 3000
          ? `The AirPods went quiet during that minute${gap > 3000 ? ` (${Math.round(gap / 1000)} seconds)` : ''}: the screen went off or the page was hidden. Keep the screen on and do it again.`
          : 'The AirPods were silent for most of that minute. Put both in and do it again.',
      )
      setState(result ? 'done' : 'idle')
      return
    }
    let stored: EarStored | null = null
    try {
      stored = await api<EarStored>('ear/recordings', { recording, key: earKey() })
    } catch (e) {
      setError(`The minute was not sent: ${(e as Error)?.message ?? e}`)
    }
    let mine: EarRecording[] = [recording]
    try {
      await keepMinute(recording, stored?.id ?? null)
      await syncMinutes(4000)
      mine = fullMinutes([...(await listMinutes()).filter((r) => r.at !== recording.at), recording], recording)
    } catch (e) {
      console.error('[ears] earlier minutes not read', e)
    }
    let heard: Heard[] = []
    try {
      heard = heardInMinute(modelRef.current, recording)
    } catch (e) {
      console.error('[ears] the model could not read the minute', e)
    }
    setToday({ rec: recording, mine, heard, stored })
    setState('today')
  }, [sense, result])

  const startFollow = useCallback(() => {
    const m = modelRef.current
    if (!m) return
    const f = follow.current
    readerRef.current = createEarReader(m)
    f.now = null
    f.was = new Set()
    f.counts = { smile: 0, nod: 0, shake: 0, laugh: 0, talk: 0 }
    f.rule = { use: new Set((['nod', 'shake'] as const).filter((e) => !m.events[e]?.score.ok)), buf: [], yaw: 0, lastYaw: null, until: {}, on: new Set() }
    f.on = true
    setNow({ p: {}, on: [], counts: { ...f.counts } })
    sense.stop()
    postNative({ cmd: 'start' })
    setState('follow')
    void keepScreenOn().then((rest) => {
      sleep.current?.()
      sleep.current = follow.current.on ? rest : (rest(), null)
    })
  }, [sense])
  const stopFollow = useCallback(() => {
    follow.current.on = false
    sleep.current?.()
    sleep.current = null
    setState(today ? 'today' : result ? 'done' : 'idle')
  }, [result, today])

  const fresh = useCallback(async () => {
    await forgetMinutes()
    saveEarModel(null)
    watching.current++
    use(null)
    setSearch(null)
    setResult(null)
    setToday(null)
    setKept(0)
  }, [use])

  const s = step >= 0 ? TEACH_STEPS[step] : null
  const here = inApp() || /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent) ? 'phone' : 'Mac'
  const streaming = hz >= 10
  const linked = info.state === 'on' || inApp()
  const onPhone = !!phone?.route && /bluetooth/i.test(phone.route)
  const phoneLine = !phone
    ? 'Asking the iPhone for your AirPods.'
    : phone.permission === 'not asked'
      ? 'The iPhone asks once if Vire may use Motion & Fitness. Tap Allow.'
      : phone.permission === 'denied' || phone.permission === 'restricted'
        ? 'Motion is switched off for Vire. On the iPhone: Settings, Privacy & Security, Motion & Fitness: turn on Fitness Tracking and Vire.'
        : phone.available === false
          ? 'This iPhone cannot read motion from headphones.'
          : !onPhone
            ? `Your AirPods are not on this iPhone${phone.route ? ` (sound goes to ${phone.route})` : ''}. Open Control Centre, tap the AirPlay mark on the music card and pick your AirPods.`
            : 'The AirPods are on this iPhone but silent. Put both in your ears.'
  const done = TEACH_STEPS.slice(0, Math.max(0, step)).reduce((a, x) => a + x.ms, 0)
  const have = !!model && model.shell !== 'sim' && Object.keys(model.events).length > 0
  return (
    <main className="el">
      <header className="el-top">
        <span className="el-mark">Vire</span>
        <span className="el-where">{state === 'today' || ((state === 'minute' || state === 'sending') && off) ? 'Today’s minute, camera off' : 'The teaching minute'}</span>
      </header>

      <section className="el-stage" data-state={state}>
        <div className="el-live">
          <canvas ref={canvasRef} width={640} height={640} className="el-head" aria-label="Your head, as the AirPods feel it" />
          <p className="el-live-line">
            {streaming
              ? `AirPods: ${hz} samples a second`
              : inApp()
                ? phoneLine
                : linked
                ? info.permission === 'denied'
                  ? 'Motion is switched off for Vire Ears. System Settings, Privacy & Security, Motion & Fitness.'
                  : info.permission === 'not asked'
                    ? 'Your Mac asks once if Vire Ears may read motion. Allow it.'
                    : 'Put your AirPods in.'
                : info.state === 'connecting'
                  ? 'Looking for Vire Ears on this Mac.'
                  : 'AirPods not connected.'}
          </p>
          {(info.error || (!streaming && phone?.error)) && <p className="el-err">{info.error || phone?.error}</p>}
        </div>

        <div className="el-main">
          <video ref={videoRef} className="el-video" playsInline muted autoPlay data-on={(state === 'minute' && !off) || state === 'starting'} />
          {state === 'idle' && (
            <>
              <h1>Teach your AirPods.</h1>
              <p className="el-lede">65 seconds of smiles, nods and head shakes in front of the camera, in three short rounds. The camera is the teacher. After that the AirPods follow you on their own.</p>
              <div className="el-btns">
                {!linked && !streaming ? (
                  <button type="button" className="lab-btn primary" onClick={connect} disabled={info.state === 'connecting'}>
                    Connect AirPods
                  </button>
                ) : (
                  <button type="button" className="lab-btn primary" onClick={minute} disabled={!streaming}>
                    Start the minute
                  </button>
                )}
                {/* same tab: the iPhone app has no address bar and drops links that open a new window */}
                <a className="lab-btn" href="app/" data-app-link>
                  Open the phone app
                </a>
                {have && (
                  <a className="lab-btn" href="#/today" data-today-link>
                    Today: five minutes, AirPods only
                  </a>
                )}
                {have && (
                  <button type="button" className="lab-btn" onClick={daily} disabled={!streaming} data-daily>
                    Today's minute, camera off
                  </button>
                )}
                {have && (
                  <button type="button" className="lab-btn" onClick={startFollow} disabled={!streaming}>
                    Camera off. Follow me
                  </button>
                )}
                {info.state === 'on' && (
                  <button type="button" className="lab-btn" onClick={forgetEars}>
                    Disconnect
                  </button>
                )}
              </div>
              {have && model && (
                <p className="el-fine" data-model={model.by}>
                  Your model is on this {here}, learned from {plural(model.minutes ?? 1, 'minute')}. {madeBy(model, here)}
                </p>
              )}
              {kept > 0 && (
                <p className="el-fine" data-kept={kept}>
                  {plural(kept, 'minute')} of yours kept on this {here}. The next one is added to {kept === 1 ? 'it' : 'them'}, and the model learns from all of them.{' '}
                  <button type="button" className="el-link" onClick={fresh}>
                    Someone else? Start fresh
                  </button>
                </p>
              )}
            </>
          )}
          {state === 'starting' && <h1>Look at the camera.</h1>}
          {state === 'minute' && s && (
            <>
              {off && <p className="el-off" data-camera="off">Camera off. AirPods only.</p>}
              <p className="el-count">{left}</p>
              <h1 className="el-say">{s.say}</h1>
              <p className="el-lede">{s.hint}</p>
              <div className="el-bar" aria-hidden="true">
                <i style={{ width: `${Math.min(100, ((done + (s.ms - left * 1000)) / TEACH_MS) * 100)}%` }} />
              </div>
              {!streaming && <p className="el-err">The AirPods stopped. Put them back in; this take will need doing again.</p>}
            </>
          )}
          {state === 'sending' && <h1>{off ? 'Reading your minute.' : kept > 0 ? 'Training on all your minutes.' : 'Training on your minute.'}</h1>}
          {state === 'today' && today && (
            <>
              <h1>Today, from your AirPods alone.</h1>
              <p className="el-lede" data-today={today.mine.length}>
                The camera stayed off. Nothing was learned from this minute: your model read it, and it is set against your own earlier minutes.
              </p>
              {today.heard.length > 0 && model && (
                <ul className="el-rows" data-heard={today.heard.length}>
                  {today.heard.map((h) => (
                    <li key={h.event} data-ok={h.heard * 2 > h.asked}>
                      <b>{NAMES[h.event]}</b>
                      <span>
                        your model heard {h.heard} of the {h.asked} asked for
                        {h.still > 0 && <i> (and said so in {h.wrong} of {h.still} still moments)</i>}
                      </span>
                      <em>AirPods alone</em>
                    </li>
                  ))}
                </ul>
              )}
              <UsualFromMinutes minutes={today.mine} inline />
              <p className="el-fine">
                {today.rec.head.length} AirPods samples at {today.rec.device.hz} a second, no camera frames. {today.stored ? `Sent as ${today.stored.id}.` : 'Not sent.'}
              </p>
              <div className="el-btns">
                <button type="button" className="lab-btn primary" onClick={startFollow} disabled={!streaming}>
                  Camera off. Follow me
                </button>
                <button type="button" className="lab-btn" onClick={() => setState('idle')}>
                  Back
                </button>
              </div>
            </>
          )}
          {state === 'done' && result && model && (
            <>
              <h1>What your AirPods felt.</h1>
              <p className="el-lede" data-learned={model.minutes ?? 1} data-by={model.by}>
                {Object.keys(model.events).length ? (
                  <>
                    Learned from {plural(model.minutes ?? 1, 'minute')}. {madeBy(model, here)}
                    {model.by === 'sandbox' && ` It came to this ${here} by itself.`}
                  </>
                ) : (
                  <>{plural(model.minutes ?? 1, 'minute')} kept. The camera did not see enough in {(model.minutes ?? 1) === 1 ? 'it' : 'them'} to teach from yet.</>
                )}
                {(model.minutes ?? 1) < 2 && ' One more minute and it learns from both.'}
              </p>
              {search && model.by !== 'sandbox' && search.state !== 'done' && (
                <p className="el-search" data-search={search.state}>
                  {search.state === 'failed'
                    ? `The wider search on Modal did not finish${search.error ? `: ${search.error}` : ''}. This ${here}'s own model stays.`
                    : search.state === 'running'
                      ? `Modal is trying many more models on all your minutes: ${search.tried} so far. The better one comes to this ${here} by itself.`
                      : `Next, Modal tries many more models on all your minutes, in a sandbox of its own. The better one comes to this ${here} by itself.`}
                </p>
              )}
              <ul className="el-rows">
                {EAR_EVENTS.map((e) =>
                  model.events[e] ? (
                    <Row key={e} name={NAMES[e]} score={model.events[e]!.score} held={model.events[e]!.score.held ?? model.held ?? 'round'} own={model.by === 'sandbox' && model.events[e]!.by === 'device' ? `this ${here}'s own model` : undefined} />
                  ) : null,
                )}
                {!Object.keys(model.events).length && result.quick.smile && (
                  <li data-ok={result.quick.smile.accuracy >= 0.7 && result.quick.smile.accuracy > result.quick.smile.chance}>
                    <b>Smile</b>
                    <span>
                      right {Math.round(result.quick.smile.accuracy * 100)} times in 100 on smiles it never saw <i>(luck reaches {Math.round(result.quick.smile.chance * 100)})</i>
                    </span>
                    <em>{result.quick.smile.accuracy >= 0.7 && result.quick.smile.accuracy > result.quick.smile.chance ? 'AirPods alone' : 'The camera keeps this one'}</em>
                  </li>
                )}
                {!Object.keys(model.events).length && !result.quick.smile && (
                  <li data-ok="false">
                    <b>Smile</b>
                    <span>not read: the camera did not see enough smiles to teach from</span>
                    <em />
                  </li>
                )}
                {!model.events.nod && (
                  <li data-ok={result.quick.nods.airpods > 0}>
                    <b>Nods</b>
                    <span>
                      the AirPods counted {result.quick.nods.airpods}, the camera {result.quick.nods.camera}
                    </span>
                    <em />
                  </li>
                )}
                {!model.events.shake && (
                  <li data-ok={result.quick.shakes.airpods > 0}>
                    <b>Head shakes</b>
                    <span>
                      the AirPods counted {result.quick.shakes.airpods}, the camera {result.quick.shakes.camera}
                    </span>
                    <em />
                  </li>
                )}
              </ul>
              {model.curve && model.curve.length > 0 && (
                <div className="el-curve" data-curve={model.curve.length}>
                  <p className="el-fine">What each minute added: this {here}'s quick model taught on that many of your minutes, then asked about a whole other minute (1.00 is always right, 0.50 is a coin).</p>
                  <ol>
                    {model.curve.map((c) => {
                      const v = mean(Object.values(c.auc))
                      return (
                        <li key={c.minutes}>
                          <span>{plural(c.minutes, 'minute')}</span>
                          <i aria-hidden="true">
                            <u style={{ width: `${Math.max(2, Math.min(100, (v - 0.5) * 200))}%` }} />
                          </i>
                          <b>{v.toFixed(2)}</b>
                        </li>
                      )
                    })}
                  </ol>
                </div>
              )}
              {/* this minute as the AirPods alone felt it, against the person's own earlier minutes */}
              <UsualFromMinutes minutes={result.mine} inline />
              {result.again && (
                <>
                  <p className="el-lede">Before it learned from this minute: the model from your earlier {result.before === 1 ? 'minute' : `${result.before} minutes`}, asked about this one.</p>
                  <ul className="el-rows" data-again="true">
                    {EAR_EVENTS.map((e) => (result.again![e] ? <Row key={e} name={NAMES[e]} score={result.again![e]!} held="this" /> : null))}
                  </ul>
                </>
              )}
              {thin(result.rec) && (
                <p className="lab-error" role="alert" data-thin={result.rec.device.hz}>
                  The AirPods sent only {Math.round(result.rec.device.hz)} samples a second in this minute{result.rec.device.idleHz ? ` (${result.rec.device.idleHz} just before it)` : ''}. They should send about 50, so this model is weaker than it could be. Do the minute again.
                </p>
              )}
              <p className="el-fine">
                {result.rec.head.length} AirPods samples at {result.rec.device.hz} a second, {result.rec.face.length} camera frames.{' '}
                {result.stored ? `Sent as ${result.stored.id}.` : 'Not sent.'}
              </p>
              <div className="el-btns">
                <button type="button" className="lab-btn primary" onClick={startFollow} disabled={!streaming}>
                  Camera off. Follow me
                </button>
                <button type="button" className="lab-btn" onClick={minute} disabled={!streaming}>
                  Do the minute again
                </button>
                {have && (
                  <button type="button" className="lab-btn" onClick={daily} disabled={!streaming} data-daily>
                    Today's minute, camera off
                  </button>
                )}
                <button type="button" className="lab-btn" onClick={() => setState('idle')}>
                  Back
                </button>
              </div>
            </>
          )}
          {state === 'follow' && model && (
            <>
              <h1>The camera is off.</h1>
              <p className="el-lede">This is your AirPods alone, read by the model your {(model.minutes ?? 1) === 1 ? 'minute' : `${model.minutes} minutes`} trained.</p>
              <ul className="el-now">
                {EAR_EVENTS.filter((e) => model.events[e] || e === 'nod' || e === 'shake').map((e) => {
                  const ok = !!model.events[e]?.score.ok
                  const plain = !ok && (e === 'nod' || e === 'shake')
                  const on = (ok || plain) && !!now?.on.includes(e)
                  return (
                    <li key={e} data-ok={ok || plain} data-on={on}>
                      <b>{NAMES[e]}</b>
                      {plain ? (
                        <>
                          <span className="el-plain">straight from the turn of your head, nothing learned</span>
                          <em>{now?.counts[e] ?? 0}</em>
                        </>
                      ) : ok ? (
                        <>
                          <span className="el-meter" aria-hidden="true">
                            <i style={{ width: `${Math.round((now?.p[e] ?? 0) * 100)}%` }} />
                          </span>
                          <em>{now?.counts[e] ?? 0}</em>
                        </>
                      ) : (
                        <span className="el-kept">the camera keeps this one</span>
                      )}
                    </li>
                  )
                })}
              </ul>
              {!streaming && <p className="el-err">The AirPods stopped. Put them back in.</p>}
              <div className="el-btns">
                <button type="button" className="lab-btn" onClick={stopFollow}>
                  Back to the numbers
                </button>
              </div>
            </>
          )}
          {error && <p className="el-err">{error}</p>}
        </div>
      </section>
      <p className="el-foot">Only angles and a smile level are kept. No picture and no sound leave this {here}. A measured loop, not a diagnosis.</p>
    </main>
  )
}
