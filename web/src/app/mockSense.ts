// Scripted stand-in for the sensing core: plausible streams with no camera or mic.
// Used with ?mock=1, or when the real createSense() is not there yet.
import type { HeartFeatures, MoveFeatures, PhaseKey, PingFeatures, PingTraces, TuneFace, VoiceFeatures } from '@shared/types'
import type {
  FaceFrame,
  HeadFrame,
  PulseSample,
  Sense,
  SenseCapabilities,
  SenseEvents,
  VoiceFrame,
} from '../sense/types'
import { smileFeatures } from '../sense/features'

/**
 * The app can steer the scripted person: where they turn their head, whether they are walking, which face they make.
 * The last five are for checking the hard cases by hand or from a test (`window.__vireMock.dark = true`).
 */
export const mockControl: {
  seekYaw: number | null
  walking: boolean
  breathStart: number | null
  /** the face the scripted person is making (the scripted tune step) */
  face: TuneFace | null
  /** scripted AirPods: head and heart come "from the AirPods" */
  airpods: boolean
  /** the face leaves the picture */
  faceLost: boolean
  /** too dark for a camera pulse */
  dark: boolean
  /** the person says nothing */
  silent: boolean
  /** a loud hall: the room itself sounds like speech */
  noisy: boolean
  /** a dose scripts the heart itself: beats a minute at performance.now() `t` */
  heart: ((t: number) => number) | null
} = {
  seekYaw: null,
  walking: false,
  breathStart: null,
  face: null,
  airpods: false,
  faceLost: false,
  dark: false,
  silent: false,
  noisy: false,
  heart: null,
}

/** smile, cheek, brow (lowered), jaw, blink for each scripted face */
const FACES: Record<TuneFace, [number, number, number, number, number]> = {
  rest: [0.05, 0.04, 0.05, 0.02, 0.05],
  smile: [0.82, 0.6, 0.03, 0.12, 0.2],
  sad: [0.01, 0.02, 0.32, 0.02, 0.12],
  angry: [0.02, 0.1, 0.78, 0.03, 0.25],
  surprised: [0.06, 0.02, 0, 0.55, 0],
}

type Listeners = { [K in keyof SenseEvents]: Set<(e: SenseEvents[K]) => void> }

interface Script {
  smileGain: number
  smileDelay: number
  nodAmp: number
  f0: number
  f0Range: number
  swing: number
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a)
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
const smooth = (u: number) => {
  const x = clamp(u, 0, 1)
  return x * x * (3 - 2 * x)
}

export function createMockSense(): Sense {
  if (/[?&]airpods=1/.test(location.search + location.hash)) mockControl.airpods = true
  ;(window as unknown as { __vireMock?: typeof mockControl }).__vireMock = mockControl
  let caps: SenseCapabilities = { native: false, airpodsMotion: mockControl.airpods, airpodsHr: mockControl.airpods, camera: true, mic: true }
  // the scripted face eases from one expression to the next
  const made = [...FACES.rest]
  const ls: Listeners = { face: new Set(), head: new Set(), pulse: new Set(), voice: new Set(), caps: new Set() }
  let timer: number | null = null
  let face: FaceFrame | null = null
  let head: HeadFrame | null = null
  let pulse: PulseSample | null = null
  let voice: VoiceFrame | null = null

  let script: Script = newScript()
  let marks: { key: PhaseKey; t: number }[] = []
  let recording = false
  let recStart = 0
  const rec = { face: [] as FaceFrame[], head: [] as HeadFrame[], pulse: [] as PulseSample[], voice: [] as VoiceFrame[] }
  /** the scripted camera pulse wave, for `pulseWave` */
  const waveLog = { t: [] as number[], v: [] as number[] }

  // running state
  let beatPhase = 0
  let lastT = 0
  let yaw = 0
  let manualYaw: number | null = null
  let wanderSeed = Math.random() * 100
  let f0Walk = 0

  function newScript(): Script {
    return {
      smileGain: rnd(0.38, 0.78),
      smileDelay: rnd(780, 1050),
      nodAmp: rnd(9, 17),
      f0: Math.random() < 0.5 ? rnd(110, 135) : rnd(185, 225),
      f0Range: rnd(1.6, 3.6),
      swing: rnd(5, 11),
    }
  }

  const phaseAt = (t: number): { key: PhaseKey; since: number } | null => {
    for (let i = marks.length - 1; i >= 0; i--) {
      // a phase marked a second time (the app closes the laugh window before the spoken question) is still the first one
      if (marks.findIndex((m) => m.key === marks[i].key) !== i) continue
      if (t >= marks[i].t) return { key: marks[i].key, since: t - marks[i].t }
    }
    return null
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft') manualYaw = clamp((manualYaw ?? yaw) + 6, -85, 85)
    else if (e.key === 'ArrowRight') manualYaw = clamp((manualYaw ?? yaw) - 6, -85, 85)
  }

  function tick() {
    const t = performance.now()
    const dt = lastT ? Math.min(0.1, (t - lastT) / 1000) : 0.033
    lastT = t
    const ph = recording ? phaseAt(t) : null
    const s = t / 1000

    // ---- smile: rises ~900 ms after the laughter starts (laughter starts 1000 ms into the phase)
    let smile = 0.06 + 0.012 * Math.sin(s * 0.9) + 0.008 * Math.sin(s * 2.3)
    if (ph?.key === 'laugh') {
      const u = ph.since - 1000 - script.smileDelay
      const rise = smooth(u / 650)
      const fall = 1 - smooth((u - 5200) / 2600)
      const wob = 1 + 0.12 * Math.sin(s * 5.1) + 0.06 * Math.sin(s * 11.3)
      smile += script.smileGain * rise * fall * wob
    }
    smile = clamp(smile, 0, 1)
    let cheek = clamp(0.04 + (smile - 0.06) * 0.62, 0, 1)
    let brow = 0.05
    const want = FACES[mockControl.face ?? 'rest']
    for (let i = 0; i < made.length; i++) made[i] += (want[i] - made[i]) * Math.min(1, dt * 6)
    if (mockControl.face) {
      const wob = 1 + 0.04 * Math.sin(s * 6.3)
      smile = clamp(made[0] * wob, 0, 1)
      cheek = clamp(made[1] * wob, 0, 1)
      brow = clamp(made[2] * wob, 0, 1)
    }

    // ---- head: a nod (two dips) about a second into the nod phase; otherwise small drift
    let pitch = 1.2 * Math.sin(s * 0.5) + 0.5 * Math.sin(s * 1.3)
    if (ph?.key === 'nod') {
      const u = ph.since - 1100
      if (u > 0 && u < 1300) pitch -= script.nodAmp * Math.sin((Math.PI * u) / 650) ** 2 * (u < 650 ? 1 : 0.6)
    }
    if (manualYaw != null) yaw += (manualYaw - yaw) * Math.min(1, dt * 7)
    else if (mockControl.seekYaw != null) yaw += (mockControl.seekYaw + 3 * Math.sin(s * 1.9) - yaw) * Math.min(1, dt * 2.6)
    else yaw += (2.5 * Math.sin(s * 0.33 + wanderSeed) - yaw) * Math.min(1, dt * 2)
    const roll = 0.8 * Math.sin(s * 0.41)

    // a walking person bobs: vertical acceleration at step rate, as AirPods would report it
    const walking = mockControl.walking
    const stepHz = 98 / 60
    const az = walking ? 0.26 * Math.max(0, Math.sin(2 * Math.PI * stepHz * s)) ** 3 + 0.015 * Math.sin(s * 31) : 0
    const ax = walking ? 0.05 * Math.sin(Math.PI * stepHz * s) : 0

    // ---- pulse: ~68 bpm, swinging with the breath (5 s in, 5 s out during the breathe phase)
    let bpm = 68 + 1.4 * Math.sin((2 * Math.PI * s) / 4.2) + 0.6 * Math.sin(s * 0.21)
    if (mockControl.heart) {
      bpm = mockControl.heart(t)
    } else if (ph?.key === 'breathe') {
      const ease = smooth(ph.since / 2500)
      bpm = 68 - (script.swing / 2) * ease * Math.cos((2 * Math.PI * (ph.since - 900)) / 10000)
    } else if (mockControl.breathStart != null) {
      // a breathing pacer is running outside a ping: the scripted heart follows it
      const since = t - mockControl.breathStart
      bpm += smooth(since / 3000) * (67 - bpm - (script.swing / 2) * Math.cos((2 * Math.PI * (since - 900)) / 10000))
    }
    beatPhase += (bpm / 60) * dt
    const bp = beatPhase % 1
    const wave = Math.exp(-((bp - 0.18) ** 2) / 0.006) + 0.32 * Math.exp(-((bp - 0.46) ** 2) / 0.012) - 0.35

    // ---- voice: phrases with pauses during the speak phase
    let voiced = false
    let f0: number | null = null
    let rms = -62 + 2 * Math.sin(s * 3.1)
    if (mockControl.noisy) {
      // a loud hall: other people's voices and music, all the time
      rms = -31 + 4 * Math.sin(s * 2.7) + rnd(-2, 2)
      voiced = Math.sin(s * 3.3) + 0.6 * Math.sin(s * 7.9) > 0.1
      if (voiced) f0 = 170 * 2 ** ((5 * Math.sin(s * 1.7) + 3 * Math.sin(s * 4.1)) / 12)
    } else if (ph?.key === 'speak' && ph.since > 500 && !mockControl.silent) {
      // the app marks the speak phase once its question has been asked
      const u = (ph.since - 500) / 1000
      const cycle = u % 3.1
      voiced = cycle < 2.3 && Math.sin(u * 19) > -0.82
      if (voiced) {
        f0Walk = clamp(f0Walk + rnd(-0.25, 0.25), -1.5, 1.5)
        const st = script.f0Range * (0.8 * Math.sin(u * 2.2) + 0.5 * Math.sin(u * 5.3)) + f0Walk
        f0 = script.f0 * 2 ** (st / 12)
        rms = -24 + 5 * Math.sin(u * 7.7) + rnd(-1.5, 1.5)
      }
    }
    const speaking = voiced && !mockControl.noisy
    const jawOpen = mockControl.face ? made[3] : speaking ? 0.18 + 0.12 * Math.sin(s * 14) : 0.02
    const blink = mockControl.face ? made[4] : s % 4.3 < 0.12 ? 0.9 : 0.05

    const air = mockControl.airpods
    if (air !== caps.airpodsMotion) {
      caps = { ...caps, airpodsMotion: air, airpodsHr: air }
      ls.caps.forEach((cb) => cb(caps))
    }
    const present = !mockControl.faceLost
    face = present
      ? { t, present, smile, cheek, brow, jawOpen, blink, pitch, yaw, roll }
      : { t, present, smile: 0, cheek: 0, brow: 0, jawOpen: 0, blink: 0, pitch: 0, yaw: 0, roll: 0 }
    // without AirPods the head is read from the camera, so it goes when the face goes
    if (present || air || walking) {
      head = { t, pitch, yaw, roll, ax, ay: 0, az, source: walking || air ? 'airpods' : 'camera' }
      if (air) {
        head.rx = 0.6 * Math.sin(s * 2.1)
        head.ry = 0.4 * Math.sin(s * 1.3)
        head.rz = 0.3 * Math.sin(s * 0.9)
      }
    } else head = null
    const dark = mockControl.dark && !air
    pulse = dark
      ? { t, bpm: null, quality: 0.08, wave: 0.05 * Math.sin(s * 9), source: 'camera' }
      : present || air
        ? { t, bpm, quality: air ? 1 : 0.82, wave: air ? 0 : wave, source: air ? 'airpods' : 'camera' }
        : { t, bpm: null, quality: 0, wave: 0, source: 'camera' }
    if (pulse.source === 'camera' && pulse.quality > 0.3) {
      waveLog.t.push(t)
      waveLog.v.push(pulse.wave)
      if (waveLog.t.length > 6000) {
        waveLog.t.splice(0, 600)
        waveLog.v.splice(0, 600)
      }
    }
    voice = { t, rms, voiced, f0 }
    if (recording) {
      rec.face.push(face)
      if (head) rec.head.push(head)
      rec.pulse.push(pulse)
      rec.voice.push(voice)
    }
    ls.face.forEach((cb) => cb(face!))
    if (head) ls.head.forEach((cb) => cb(head!))
    ls.pulse.forEach((cb) => cb(pulse!))
    ls.voice.forEach((cb) => cb(voice!))
  }

  const within = <T extends { t: number }>(xs: T[], key: PhaseKey): T[] => {
    const i = marks.findIndex((m) => m.key === key)
    if (i < 0) return []
    const a = marks[i].t
    const b = i + 1 < marks.length ? marks[i + 1].t : Infinity
    return xs.filter((x) => x.t >= a && x.t < b)
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
  const median = (xs: number[]) => {
    if (!xs.length) return 0
    const a = [...xs].sort((x, y) => x - y)
    const m = a.length >> 1
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
  }
  const sd = (xs: number[]) => {
    if (xs.length < 2) return 0
    const m = mean(xs)
    return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
  }

  function features(laughOnsetT: number | null): PingFeatures {
    const has = (k: PhaseKey) => marks.some((m) => m.key === k)

    // Use the production smile rule here too, so scripted demo signals cannot disagree with the phone's real reader.
    const laughMark = marks.find((m) => m.key === 'laugh')
    const laughEnd = laughMark ? marks.find((m) => m.t > laughMark.t)?.t ?? Infinity : 0
    const settleMark = marks.find((m) => m.key === 'settle')
    const settleEnd = settleMark ? marks.find((m) => m.t > settleMark.t)?.t ?? Infinity : 0
    const lf = rec.face.filter((f) => f.present && laughMark && f.t >= laughMark.t && f.t < laughEnd)
    const sf = rec.face.filter((f) => f.present && settleMark && f.t >= settleMark.t && f.t < settleEnd)
    const smile = smileFeatures({
      t: rec.face.filter((f) => f.present).map((f) => f.t),
      smile: rec.face.filter((f) => f.present).map((f) => f.smile),
      cheek: rec.face.filter((f) => f.present).map((f) => f.cheek),
      settle: sf.length ? [sf[0]!.t, sf.at(-1)!.t + 1] : null,
      laugh: lf.length ? [lf[0]!.t, lf.at(-1)!.t + 1] : null,
      laughOnsetT: laughOnsetT ?? (laughMark ? laughMark.t + 1000 : null),
    })

    // voice
    let voiceF: VoiceFeatures = {
      speechFraction: 0,
      pauseCount: 0,
      meanPauseMs: 0,
      f0MedianHz: null,
      f0SdSemitones: null,
      loudnessSdDb: 0,
      syllableRateHz: null,
    }
    if (has('speak')) {
      const v = within(rec.voice, 'speak')
      const voicedFrames = v.filter((x) => x.voiced)
      const f0s = voicedFrames.map((x) => x.f0).filter((x): x is number => x != null)
      const med = median(f0s)
      const pauses: number[] = []
      let run = 0
      let seen = false
      for (let i = 1; i < v.length; i++) {
        if (v[i].voiced) {
          if (seen && run > 250) pauses.push(run)
          run = 0
          seen = true
        } else run += v[i].t - v[i - 1].t
      }
      voiceF = {
        speechFraction: v.length ? voicedFrames.length / v.length : 0,
        pauseCount: pauses.length,
        meanPauseMs: mean(pauses),
        f0MedianHz: f0s.length ? med : null,
        f0SdSemitones: f0s.length > 5 ? sd(f0s.map((f) => 12 * Math.log2(f / med))) : null,
        loudnessSdDb: sd(voicedFrames.map((x) => x.rms)),
        syllableRateHz: f0s.length ? 3.4 + script.f0Range * 0.25 : null,
      }
    }

    // heart
    const rest = (has('settle') ? within(rec.pulse, 'settle') : rec.pulse).map((p) => p.bpm).filter((b): b is number => b != null)
    const br = within(rec.pulse, 'breathe')
      .map((p) => p.bpm)
      .filter((b): b is number => b != null)
    const brAll = within(rec.pulse, 'breathe')
    const heart: HeartFeatures = {
      restBpm: rest.length ? mean(rest) : null,
      swingBpm: br.length > 20 ? Math.max(...br) - Math.min(...br) : null,
      quality: brAll.length ? mean(brAll.map((p) => p.quality)) : 0,
      source: rec.pulse.some((p) => p.source === 'airpods') ? 'airpods' : 'camera',
    }

    // move
    const moveSource = rec.head.some((h) => h.source === 'airpods') ? 'airpods' : 'camera'
    let move: MoveFeatures = { nodAmplitudeDeg: null, nodPeakVelDegS: null, nodCount: 0, restlessness: 0, source: moveSource }
    const vel = (xs: HeadFrame[]) => {
      const out: number[] = []
      for (let i = 1; i < xs.length; i++) out.push((xs[i].pitch - xs[i - 1].pitch) / Math.max(0.001, (xs[i].t - xs[i - 1].t) / 1000))
      return out
    }
    const still = [...within(rec.head, 'settle'), ...within(rec.head, 'breathe')]
    const restlessness = Math.sqrt(mean(vel(still).map((x) => x * x)))
    if (has('nod')) {
      const n = within(rec.head, 'nod')
      const base = n.length ? mean(n.slice(0, 8).map((h) => h.pitch)) : 0
      const exc = n.map((h) => base - h.pitch)
      const amp = exc.length ? Math.max(...exc) : 0
      let count = 0
      let down = false
      for (const e of exc) {
        if (!down && e > Math.max(4, amp * 0.5)) {
          down = true
          count++
        } else if (down && e < Math.max(2, amp * 0.25)) down = false
      }
      const vs = vel(n).map(Math.abs)
      move = {
        nodAmplitudeDeg: amp > 3 ? amp : null,
        nodPeakVelDegS: amp > 3 && vs.length ? Math.max(...vs) : null,
        nodCount: count,
        restlessness,
        source: moveSource,
      }
    } else move.restlessness = restlessness

    return { smile, voice: voiceF, heart, move }
  }

  function traces(): PingTraces {
    const out: PingTraces = { t: [], smile: [], cheek: [], headPitch: [], bpm: [], rms: [], f0: [], phases: [] }
    const end = rec.face.length ? rec.face[rec.face.length - 1].t : recStart
    let fi = 0
    let pi = 0
    let vi = 0
    for (let t = recStart; t <= end; t += 100) {
      while (fi + 1 < rec.face.length && rec.face[fi + 1].t <= t) fi++
      while (pi + 1 < rec.pulse.length && rec.pulse[pi + 1].t <= t) pi++
      while (vi + 1 < rec.voice.length && rec.voice[vi + 1].t <= t) vi++
      const f = rec.face[fi]
      const p = rec.pulse[pi]
      const v = rec.voice[vi]
      out.t.push(Math.round(t - recStart))
      out.smile.push(f ? +f.smile.toFixed(3) : 0)
      out.cheek.push(f ? +f.cheek.toFixed(3) : 0)
      out.headPitch.push(f ? +f.pitch.toFixed(2) : 0)
      out.bpm.push(p?.bpm != null ? +p.bpm.toFixed(1) : null)
      out.rms.push(v ? +v.rms.toFixed(1) : -90)
      out.f0.push(v?.f0 != null ? +v.f0.toFixed(1) : null)
    }
    out.phases = marks.map((m) => ({ key: m.key, at: Math.round(m.t - recStart) }))
    return out
  }

  const sense: Sense = {
    get caps() {
      return caps
    },
    async start() {
      if (timer != null) return
      await new Promise((r) => setTimeout(r, 350))
      lastT = 0
      timer = window.setInterval(tick, 33)
      window.addEventListener('keydown', onKey)
      ls.caps.forEach((cb) => cb(caps))
    },
    stop() {
      if (timer != null) clearInterval(timer)
      timer = null
      window.removeEventListener('keydown', onKey)
    },
    on(ev, cb) {
      const set = ls[ev] as Set<typeof cb>
      set.add(cb)
      return () => {
        set.delete(cb)
      }
    },
    latest: () => ({ face, head, pulse, voice }),
    beginRecording() {
      script = newScript()
      marks = []
      rec.face = []
      rec.head = []
      rec.pulse = []
      rec.voice = []
      recStart = performance.now()
      recording = true
    },
    mark(phase) {
      marks.push({ key: phase, t: performance.now() })
    },
    peekRecording({ laughOnsetT }) {
      return recording ? { features: features(laughOnsetT), traces: traces() } : null
    },
    endRecording({ laughOnsetT }) {
      recording = false
      const out = { features: features(laughOnsetT), traces: traces() }
      wanderSeed = Math.random() * 100
      return out
    },
    pulseWave(t0, t1) {
      const out = { t: [] as number[], v: [] as number[] }
      for (let i = 0; i < waveLog.t.length; i++) {
        if (waveLog.t[i] < t0 || waveLog.t[i] > t1) continue
        out.t.push(waveLog.t[i])
        out.v.push(waveLog.v[i])
      }
      return out
    },
    setHeartSession() {},
    setDetail() {},
    blendNames: () => [],
    setCalibration() {},
  }
  return sense
}
