// bun test: feature math and DSP against synthetic signals with known answers.
import { describe, expect, test } from 'bun:test'
import { PosStream, bandpassZeroPhase, snrToQuality, spectralPeak } from '../../src/sense/dsp'
import { analyzePulseWindow, beatSeries, computePing, coversBreaths, lockedSwing, emptyRecording, heartFeatures, HEART_MAX_SWING_SE, nodFeatures, restlessness, smileFeatures, voiceFeatures } from '../../src/sense/features'
import type { Recording } from '../../src/sense/features'
import { createVoiceAnalyzer } from '../../src/sense/pitch'
import type { RawVoiceFrame } from '../../src/sense/pitch'
import { CameraPulse, MotionGate } from '../../src/sense/rppg'
import { CAMERA_LIMITS, cameraIssues, skinLuma } from '../../src/sense/conditions'

function rng(seed: number) {
  let a = seed >>> 0
  const u = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const gauss = () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u())
  return { u, gauss }
}

// ---------------------------------------------------------------- smile

describe('smile', () => {
  const settle: [number, number] = [0, 8000]
  const laugh: [number, number] = [14000, 26000]
  const onset = 15000
  /** baseline 0.05; 800 ms after the laughter it ramps to 0.65 in 500 ms, holds 3 s, fades in 1 s */
  const curve = (t: number) => {
    const s = t - (onset + 800)
    if (s < 0) return 0.05
    if (s < 500) return 0.05 + 0.6 * (s / 500)
    if (s < 3500) return 0.65
    if (s < 4500) return 0.65 - 0.6 * ((s - 3500) / 1000)
    return 0.05
  }
  const make = (noise: number, seed = 1) => {
    const r = rng(seed)
    const t: number[] = []
    const smile: number[] = []
    const cheek: number[] = []
    for (let x = 0; x < 26000; x += 33.3 + (r.u() - 0.5) * 6) {
      t.push(x)
      const s = curve(x)
      smile.push(s + noise * r.gauss())
      cheek.push(0.02 + (s - 0.05) * (0.38 / 0.6))
    }
    return { t, smile, cheek }
  }

  test('known curve: latency, peak, area, duration, duchenne', () => {
    const f = smileFeatures({ ...make(0), settle, laugh, laughOnsetT: onset })
    expect(f.baseline).toBeCloseTo(0.05, 3)
    expect(f.peak).toBeCloseTo(0.6, 2)
    // crosses baseline + 0.15 a quarter of the way up the ramp: 800 + 125 ms
    expect(Math.abs((f.latencyMs ?? 0) - 925)).toBeLessThan(40)
    // 0.6 * (0.25 + 3 + 0.5) smile-seconds
    expect(f.auc).toBeGreaterThan(2.15)
    expect(f.auc).toBeLessThan(2.35)
    expect(Math.abs(f.durationMs - 3750)).toBeLessThan(90)
    expect(f.duchenne).toBeCloseTo(0.4, 1)
  })

  test('with blendshape noise it stays close', () => {
    const f = smileFeatures({ ...make(0.015, 7), settle, laugh, laughOnsetT: onset })
    expect(f.peak).toBeGreaterThan(0.56)
    expect(f.peak).toBeLessThan(0.66)
    expect(Math.abs((f.latencyMs ?? 0) - 925)).toBeLessThan(80)
    expect(Math.abs(f.auc - 2.25)).toBeLessThan(0.2)
  })

  test('no smile: latency null, nothing invented', () => {
    const d = make(0)
    const f = smileFeatures({ t: d.t, smile: d.t.map(() => 0.05), cheek: d.cheek.map(() => 0.02), settle, laugh, laughOnsetT: onset })
    expect(f.latencyMs).toBeNull()
    expect(f.peak).toBe(0)
    expect(f.auc).toBe(0)
    expect(f.durationMs).toBe(0)
  })

  test('flat smile with noise has no timed smile', () => {
    const d = make(0.035, 31)
    const f = smileFeatures({ t: d.t, smile: d.smile.map((v) => 0.05 + (v - 0.05) * 0.2), cheek: d.cheek.map(() => 0.02), settle, laugh, laughOnsetT: onset })
    expect(f.latencyMs).toBeNull()
  })

  test('a brow or blink signal does not create a smile time when smile stays flat', () => {
    const d = make(0, 32)
    const f = smileFeatures({ t: d.t, smile: d.t.map(() => 0.05), cheek: d.t.map((t) => (t > onset + 700 && t < onset + 1000 ? 0.8 : 0.02)), settle, laugh, laughOnsetT: onset })
    expect(f.latencyMs).toBeNull()
  })

  test('a real held rise at 0.7 seconds is timed within one frame', () => {
    const d = make(0, 33)
    const rise = d.t.map((t) => t < onset + 700 ? 0.05 : t < onset + 1000 ? 0.65 : 0.65)
    const f = smileFeatures({ t: d.t, smile: rise, cheek: rise.map((v) => (v > 0.1 ? 0.4 : 0.02)), settle, laugh, laughOnsetT: onset })
    expect(Math.abs((f.latencyMs ?? 0) - 700)).toBeLessThan(50)
  })

  test('a rise that starts 0.1 seconds after the laugh was already on its way: no time, and it says so', () => {
    const d = make(0, 34)
    const rise = d.t.map((t) => (t < onset + 100 ? 0.05 : 0.65))
    const f = smileFeatures({ t: d.t, smile: rise, cheek: rise.map((v) => (v > 0.1 ? 0.4 : 0.02)), settle, laugh, laughOnsetT: onset })
    expect(f.latencyMs).toBeNull()
    expect(f.alreadySmiling).toBe(true)
    expect(f.auc).toBeGreaterThan(1)
  })

  test('mini ping (no settle): baseline comes from before the laughter', () => {
    const f = smileFeatures({ ...make(0), settle: null, laugh, laughOnsetT: onset })
    expect(f.baseline).toBeCloseTo(0.05, 3)
    expect(f.peak).toBeCloseTo(0.6, 2)
  })

  test('laugh phase never happened: zeros', () => {
    const f = smileFeatures({ ...make(0), settle, laugh: null, laughOnsetT: null })
    expect(f).toEqual({ latencyMs: null, peak: 0, auc: 0, duchenne: 0, durationMs: 0, baseline: 0.05 })
  })
})

// ---------------------------------------------------------------- nod + restlessness

describe('head', () => {
  /** rest 1.5 s, then `cycles` nods of amplitude A at f Hz, then rest */
  const nods = (fs: number, A: number, f: number, cycles: number, noise: number, seed = 3) => {
    const r = rng(seed)
    const t: number[] = []
    const p: number[] = []
    for (let i = 0; i < 6 * fs; i++) {
      const s = i / fs
      const u = s - 1.5
      const on = u >= 0 && u < cycles / f
      t.push(s * 1000)
      p.push(-4 + (on ? -A * Math.sin(2 * Math.PI * f * u) : 0) + noise * r.gauss())
    }
    return { t, p }
  }

  test('nod sinusoid, camera rate: amplitude, peak velocity, count', () => {
    const { t, p } = nods(30, 8, 1.5, 3, 0.15)
    const f = nodFeatures(t, p)
    expect(f.nodCount).toBe(3)
    expect(Math.abs((f.nodAmplitudeDeg ?? 0) - 16)).toBeLessThan(1.2)
    const want = 2 * Math.PI * 1.5 * 8 // 75.4 deg/s
    expect(Math.abs((f.nodPeakVelDegS ?? 0) - want) / want).toBeLessThan(0.1)
  })

  test('nod sinusoid, AirPods rate (25 Hz), slow and small', () => {
    const { t, p } = nods(25, 4, 0.8, 2, 0.05)
    const f = nodFeatures(t, p)
    expect(f.nodCount).toBe(2)
    expect(Math.abs((f.nodAmplitudeDeg ?? 0) - 8)).toBeLessThan(0.6)
    const want = 2 * Math.PI * 0.8 * 4
    expect(Math.abs((f.nodPeakVelDegS ?? 0) - want) / want).toBeLessThan(0.1)
  })

  test('still head: no nods, small numbers', () => {
    const { t, p } = nods(30, 0, 1, 0, 0.15)
    const f = nodFeatures(t, p)
    expect(f.nodCount).toBe(0)
    expect(f.nodAmplitudeDeg ?? 99).toBeLessThan(1.5)
    expect(f.nodPeakVelDegS ?? 99).toBeLessThan(8)
  })

  test('no data: nulls', () => {
    expect(nodFeatures([], [])).toEqual({ nodAmplitudeDeg: null, nodPeakVelDegS: null, nodCount: 0 })
  })

  test('restlessness = RMS angular velocity', () => {
    const t: number[] = []
    const yaw: number[] = []
    for (let i = 0; i < 30 * 20; i++) {
      t.push((i / 30) * 1000)
      yaw.push(2 * Math.sin(2 * Math.PI * 0.5 * (i / 30)))
    }
    const zero = t.map(() => 0)
    const r = restlessness(t, zero, yaw, zero, [[0, 8000], [10000, 20000]])
    expect(Math.abs(r - (2 * Math.PI * 0.5 * 2) / Math.SQRT2)).toBeLessThan(0.25) // 4.44 deg/s
    expect(restlessness(t, zero, zero, zero, [[0, 8000]])).toBe(0)
  })
})

// ---------------------------------------------------------------- voice

describe('voice', () => {
  const win: [number, number] = [0, 12000]
  const segs = [[1000, 3000], [3600, 6000], [7000, 9500]] // 6.9 s of speech, pauses of 600 and 1000 ms
  const make = () => {
    const t: number[] = []
    const rms: number[] = []
    const voiced: boolean[] = []
    const f0: (number | null)[] = []
    for (let x = 0; x < 12000; x += 20) {
      const on = segs.some(([a, b]) => x >= a && x < b)
      t.push(x)
      voiced.push(on)
      // 4 syllables per second, +-6 dB; pitch wanders +-2 st around 120 Hz at 0.5 Hz
      rms.push(on ? -30 + 6 * Math.sin(2 * Math.PI * 4 * (x / 1000)) : -70)
      f0.push(on ? 120 * 2 ** ((2 * Math.sin(2 * Math.PI * 0.5 * (x / 1000))) / 12) : null)
    }
    return { t, rms, voiced, f0 }
  }

  test('synthetic contour: fraction, pauses, pitch, loudness, syllable rate', () => {
    const d = make()
    const f = voiceFeatures(d.t, d.rms, d.voiced, d.f0, win)
    expect(f.speechFraction).toBeCloseTo(6.9 / 12, 2)
    expect(f.pauseCount).toBe(2)
    expect(Math.abs(f.meanPauseMs - 800)).toBeLessThan(30)
    expect(Math.abs((f.f0MedianHz ?? 0) - 120)).toBeLessThan(3)
    expect(Math.abs((f.f0SdSemitones ?? 0) - 2 / Math.SQRT2)).toBeLessThan(0.15)
    expect(Math.abs(f.loudnessSdDb - 6 / Math.SQRT2)).toBeLessThan(0.3)
    expect(Math.abs((f.syllableRateHz ?? 0) - 4)).toBeLessThan(0.4)
  })

  test('octave slips do not inflate pitch variability', () => {
    const d = make()
    const f0 = d.f0.map((x, i) => (x !== null && i % 17 === 0 ? x * 2 : x))
    const f = voiceFeatures(d.t, d.rms, d.voiced, f0, win)
    expect(Math.abs((f.f0SdSemitones ?? 0) - 2 / Math.SQRT2)).toBeLessThan(0.2)
  })

  test('silence and missing phase: zeros and nulls', () => {
    const d = make()
    const quiet = voiceFeatures(d.t, d.t.map(() => -70), d.t.map(() => false), d.t.map(() => null), win)
    const zero = { speechFraction: 0, pauseCount: 0, meanPauseMs: 0, f0MedianHz: null, f0SdSemitones: null, loudnessSdDb: 0, syllableRateHz: null }
    expect(quiet).toEqual(zero)
    expect(voiceFeatures(d.t, d.rms, d.voiced, d.f0, null)).toEqual(zero)
  })
})

describe('pitch tracker (YIN)', () => {
  const run = (sr: number, gen: (i: number) => number, seconds = 1) => {
    const an = createVoiceAnalyzer(sr)
    const out: RawVoiceFrame[] = []
    const block = new Float32Array(128)
    let n = 0
    for (let b = 0; b < (seconds * sr) / 128; b++) {
      for (let i = 0; i < 128; i++) block[i] = gen(n + i)
      an.push(block, n, (f) => out.push(f))
      n += 128
    }
    return out.slice(5)
  }
  const tone = (sr: number, f: number, amp = 0.1) => (i: number) => {
    const ph = (2 * Math.PI * f * i) / sr
    return amp * (Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.3 * Math.sin(3 * ph))
  }

  for (const sr of [48000, 44100, 16000]) {
    for (const f of [85, 150, 220, 330]) {
      test(`${f} Hz harmonic tone at ${sr} Hz`, () => {
        const frames = run(sr, tone(sr, f))
        expect(frames.length).toBeGreaterThan(40)
        expect(frames.every((x) => x.voiced)).toBe(true)
        const err = Math.max(...frames.map((x) => Math.abs((x.f0 ?? 0) - f) / f))
        expect(err).toBeLessThan(0.02)
      })
    }
  }

  test('~50 frames per second, level in dBFS', () => {
    const frames = run(48000, tone(48000, 150, 0.1), 2)
    expect(frames.length).toBeGreaterThan(88)
    expect(frames.length).toBeLessThan(100)
    // rms of the 3 partials at amp 0.1: 0.1 * sqrt((1 + .25 + .09) / 2) = -21.8 dBFS
    expect(Math.abs(frames[20].rms - -21.8)).toBeLessThan(1)
  })

  test('silence and noise are not voiced', () => {
    expect(run(48000, () => 0).some((x) => x.voiced)).toBe(false)
    const r = rng(5)
    const noise = run(48000, () => 0.05 * r.gauss(), 2)
    expect(noise.filter((x) => x.voiced).length / noise.length).toBeLessThan(0.05)
  })
})

// ---------------------------------------------------------------- pulse

/** skin RGB with a pulse of relative amplitude `amp`, a slow brightness wobble and sensor noise */
function skin(tMs: number, phase: number, amp: number, noise: number, r: ReturnType<typeof rng>): [number, number, number] {
  const p = Math.cos(phase) + 0.3 * Math.cos(2 * phase)
  const light = 1 + 0.01 * Math.sin((2 * Math.PI * 0.23 * tMs) / 1000) + 0.004 * Math.sin((2 * Math.PI * 0.9 * tMs) / 1000)
  return [
    180 * light * (1 + amp * 0.33 * p) * (1 + noise * r.gauss()),
    130 * light * (1 + amp * 0.77 * p) * (1 + noise * r.gauss()),
    110 * light * (1 + amp * 0.53 * p) * (1 + noise * r.gauss()),
  ]
}

/** run frames through the live pipeline; hr(tSec) gives the heart rate in bpm */
function runPulse(seconds: number, hr: (s: number) => number, amp: number, noise: number, seed: number, fps = 30) {
  const r = rng(seed)
  const cp = new CameraPulse()
  let phase = 0
  let t = 1000
  let last = t
  const states: { t: number; bpm: number | null; q: number }[] = []
  while (t < 1000 + seconds * 1000) {
    phase += 2 * Math.PI * (hr((t - 1000) / 1000) / 60) * ((t - last) / 1000)
    last = t
    const [R, G, B] = skin(t, phase, amp, noise, r)
    const st = cp.push(t, R, G, B)
    states.push({ t, bpm: st.bpm, q: st.snrQuality })
    t += 1000 / fps + (r.u() - 0.5) * 8 // camera timing jitter
  }
  return { cp, states }
}

describe('camera pulse', () => {
  test('POS cancels brightness changes and keeps the pulse', () => {
    const fs = 30
    const r = rng(11)
    const pos = new PosStream(fs)
    const out: number[] = []
    for (let i = 0; i < fs * 20; i++) {
      const [R, G, B] = skin((i / fs) * 1000, 2 * Math.PI * 1.2 * (i / fs), 0.004, 0.0003, r)
      const y = pos.push(R, G, B)
      if (y !== null) out.push(y)
    }
    const pk = spectralPeak(out.slice(-300), fs, 0.7, 3)
    expect(pk).not.toBeNull()
    expect(Math.abs(pk!.freq * 60 - 72)).toBeLessThan(1.5)
    expect(snrToQuality(pk!.snrDb)).toBeGreaterThan(0.8)
  })

  for (const bpm of [52, 72, 96, 130]) {
    test(`live pipeline finds ${bpm} bpm`, () => {
      const { states } = runPulse(25, () => bpm, 0.004, 0.0005, bpm)
      const end = states[states.length - 1]
      expect(end.bpm).not.toBeNull()
      expect(Math.abs((end.bpm ?? 0) - bpm)).toBeLessThan(1.5)
      expect(end.q).toBeGreaterThan(0.7)
      // nothing before there is enough signal
      expect(states.filter((s) => s.t < 1000 + 6000).every((s) => s.bpm === null)).toBe(true)
    })
  }

  test('works at 15 fps and at 60 fps cameras', () => {
    for (const fps of [15, 60]) {
      const end = runPulse(25, () => 78, 0.004, 0.0005, fps, fps).states.pop()!
      expect(Math.abs((end.bpm ?? 0) - 78)).toBeLessThan(1.5)
    }
  })

  test('no pulse in the signal: low quality, mostly no bpm (honest)', () => {
    let lowQ = 0
    let total = 0
    let nulls = 0
    for (let seed = 1; seed <= 30; seed++) {
      const { states } = runPulse(30, () => 70, 0, 0.0005, seed)
      for (const s of states.filter((x) => x.t > 12000)) {
        total++
        if (s.q < 0.3) lowQ++
        if (s.bpm === null) nulls++
      }
    }
    expect(lowQ / total).toBeGreaterThan(0.95)
    expect(nulls / total).toBeGreaterThan(0.6)
  })

  test('a gap (face lost) restarts instead of bridging', () => {
    const cp = new CameraPulse()
    const r = rng(2)
    let t = 0
    for (; t < 12000; t += 33.3) cp.push(t, ...skin(t, (2 * Math.PI * 1.1 * t) / 1000, 0.004, 0.0003, r))
    expect(cp.peek().bpm).not.toBeNull()
    t += 2000
    cp.push(t, ...skin(t, 0, 0.004, 0.0003, r))
    expect(cp.peek().bpm).toBeNull()
  })

  test('a short stall (busy device) is bridged, not restarted', () => {
    // validation/README.md: restarting on every 0.4-1 s stall cost coverage on real video with no gain in accuracy
    const cp = new CameraPulse()
    const r = rng(3)
    const f = 1.1
    let t = 0
    for (; t < 12000; t += 33.3) cp.push(t, ...skin(t, (2 * Math.PI * f * t) / 1000, 0.004, 0.0003, r))
    expect(cp.peek().bpm).not.toBeNull()
    t += 700
    cp.push(t, ...skin(t, (2 * Math.PI * f * t) / 1000, 0.004, 0.0003, r))
    expect(cp.peek().bpm).not.toBeNull()
    for (; t < 16000; t += 33.3) cp.push(t, ...skin(t, (2 * Math.PI * f * t) / 1000, 0.004, 0.0003, r))
    expect(Math.abs((cp.peek().bpm ?? 0) - 66)).toBeLessThan(2)
  })

  test('motion gate: open for a still face, shut while the head turns, open again after', () => {
    const g = new MotionGate()
    let t = 0
    for (; t < 2000; t += 33.3) g.update(t, 1, 2, 0, 0.5, 0.5, 0.02, 0.05, 0)
    expect(g.value).toBeGreaterThan(0.95)
    // 60 deg/s head turn
    let yaw = 2
    for (; t < 3500; t += 33.3) g.update(t, 1, (yaw += 2), 0, 0.5, 0.5, 0.02, 0.05, 0)
    expect(g.value).toBeLessThan(0.05)
    for (; t < 7000; t += 33.3) g.update(t, 1, yaw, 0, 0.5, 0.5, 0.02, 0.05, 0)
    expect(g.value).toBeGreaterThan(0.9)
    // a broad smile deforms the cheeks: gate partly closed
    for (; t < 8000; t += 33.3) g.update(t, 1, yaw, 0, 0.5, 0.5, 0.02, 0.9, 0)
    expect(g.value).toBeLessThan(0.5)
  })
})

describe('camera conditions', () => {
  const face = { present: true, yaw: 3 }
  const bright: [number, number, number] = [190, 150, 130]

  test('a near, lit, front-facing face has no issues', () => {
    expect(cameraIssues({ faceW: 220, rgb: bright }, face)).toEqual([])
    expect(skinLuma(bright)).toBeCloseTo(159.7, 1)
  })

  test('each measured limit raises its own issue', () => {
    expect(cameraIssues({ faceW: 0, rgb: null }, null)).toEqual(['no-face'])
    expect(cameraIssues({ faceW: 220, rgb: bright }, { present: false, yaw: 0 })).toEqual(['no-face'])
    expect(cameraIssues({ faceW: CAMERA_LIMITS.minFaceWidthPx - 1, rgb: bright }, face)).toEqual(['too-far'])
    expect(cameraIssues({ faceW: 220, rgb: bright }, { present: true, yaw: -(CAMERA_LIMITS.maxYawDeg + 1) })).toEqual(['turned'])
    expect(cameraIssues({ faceW: 220, rgb: [30, 25, 20] }, face)).toEqual(['too-dark'])
    expect(cameraIssues({ faceW: 220, rgb: [90, 70, 60] }, face)).toEqual(['dim-for-pulse'])
    // skin patch off the frame edge: no brightness reading, so no light warning
    expect(cameraIssues({ faceW: 220, rgb: null }, face)).toEqual([])
  })
})

describe('heart features', () => {
  const BREATHE: [number, number] = [39000, 59000]
  const SETTLE: [number, number] = [1000, 9000]
  /** 66 bpm at rest; during breathe the rate swings +-6 bpm with the 10 s breath */
  const hr = (s: number) => (s >= 38 ? 66 + 6 * Math.sin((2 * Math.PI * (s - 38)) / 10) : 66)

  test('beat-to-beat swing of a known 10 s oscillation', () => {
    const { cp } = runPulse(58.2, hr, 0.004, 0.0004, 21)
    const w = cp.series(0, 60000)
    const pw = analyzePulseWindow(w.t, w.v, BREATHE)
    expect(pw).not.toBeNull()
    expect(Math.abs(pw!.bpm - 66)).toBeLessThan(4)
    const bs = beatSeries(pw!)
    expect(bs).not.toBeNull()
    // true swing 12 bpm; the 0.75 s smoothing takes ~10% off
    expect(bs!.swingBpm).toBeGreaterThan(9.5)
    expect(bs!.swingBpm).toBeLessThan(13)
    expect(Math.abs(bs!.meanBpm - 66)).toBeLessThan(1.5)
    expect(bs!.beats.length).toBeGreaterThan(18)
  })

  test('steady heart: swing near zero', () => {
    const { cp } = runPulse(58.2, () => 66, 0.004, 0.0004, 22)
    const w = cp.series(0, 60000)
    const bs = beatSeries(analyzePulseWindow(w.t, w.v, BREATHE)!)
    expect(bs!.swingBpm).toBeLessThan(2)
  })

  test('heartFeatures from the camera: rest from settle, swing from breathe', () => {
    const { cp, states } = runPulse(58.2, hr, 0.004, 0.0004, 23)
    const w = cp.series(0, 60000)
    const camT = states.map((s) => s.t)
    const f = heartFeatures({ waveT: w.t, waveV: w.v, camT, camGate: camT.map(() => 1), airT: [], airBpm: [], settle: SETTLE, breathe: BREATHE })
    expect(f.source).toBe('camera')
    expect(Math.abs((f.restBpm ?? 0) - 66)).toBeLessThan(2)
    expect(f.swingBpm ?? 0).toBeGreaterThan(9.5)
    expect(f.swingBpm ?? 99).toBeLessThan(13)
    expect(f.quality).toBeGreaterThan(0.5)
  })

  test('moving / talking during breathe (gate low): no swing reported', () => {
    const { cp, states } = runPulse(58.2, hr, 0.004, 0.0004, 24)
    const w = cp.series(0, 60000)
    const camT = states.map((s) => s.t)
    const f = heartFeatures({ waveT: w.t, waveV: w.v, camT, camGate: camT.map(() => 0.2), airT: [], airBpm: [], settle: SETTLE, breathe: BREATHE })
    expect(f.swingBpm).toBeNull()
    expect(f.quality).toBeLessThan(0.3)
  })

  test('noise only: null, never a made-up number', () => {
    let reported = 0
    for (let seed = 40; seed < 60; seed++) {
      const { cp, states } = runPulse(58.2, hr, 0, 0.0005, seed)
      const w = cp.series(0, 60000)
      const camT = states.map((s) => s.t)
      const f = heartFeatures({ waveT: w.t, waveV: w.v, camT, camGate: camT.map(() => 1), airT: [], airBpm: [], settle: SETTLE, breathe: BREATHE })
      if (f.swingBpm !== null) reported++
    }
    expect(reported).toBeLessThanOrEqual(1)
  })

  test('AirPods samples win over the camera', () => {
    const airT: number[] = []
    const airBpm: number[] = []
    for (let s = 0; s < 58; s += 1) {
      airT.push(1000 + s * 1000)
      airBpm.push(Math.round(hr(s) * 10) / 10)
    }
    const f = heartFeatures({ waveT: [], waveV: [], camT: [], camGate: [], airT, airBpm, settle: SETTLE, breathe: BREATHE })
    expect(f.restBpm).toBe(66)
    expect(f.swingBpm ?? 0).toBeGreaterThan(11.7)
    expect(f.swingBpm ?? 99).toBeLessThan(12.3)
    expect(f.quality).toBe(1)
    expect(f.source).toBe('airpods')
  })

  describe('lock-in swing (the breath is paced, so only the part of the rate at its period counts)', () => {
    // one beat-to-beat rate a second for two paced breaths, as bpm
    const series = (truth: (s: number) => number, noise: number, seed: number) => {
      let x = seed
      const rnd = () => {
        x = (x * 1664525 + 1013904223) % 4294967296
        return x / 4294967296 - 0.5
      }
      const t: number[] = []
      const v: number[] = []
      for (let s = 0; s < 20; s += 0.9) {
        t.push(s * 1000)
        v.push(truth(s) + noise * 2 * rnd())
      }
      return { t, v }
    }
    const swing12 = (s: number) => 66 + 6 * Math.sin((2 * Math.PI * s) / 10)
    const range = (v: number[]) => Math.max(...v) - Math.min(...v)

    test('reads a known 12 bpm swing, and says when in the breath the rate peaks', () => {
      const { t, v } = series(swing12, 1, 5)
      const ls = lockedSwing(t, v, 0)!
      expect(Math.abs(ls.swingBpm - 12)).toBeLessThan(1)
      expect(ls.lock).toBeGreaterThan(0.9)
      expect(Math.abs(ls.peakAtS - 2.5)).toBeLessThan(0.5)
      expect(ls.se).toBeLessThan(1)
    })

    test('a steady heart reads near zero, not at the noise floor', () => {
      for (let seed = 1; seed <= 20; seed++) {
        const { t, v } = series(() => 66, 1.5, seed)
        const ls = lockedSwing(t, v, 0)!
        expect(ls.swingBpm).toBeLessThan(1.6)
        expect(range(v)).toBeGreaterThan(2) // what max - min would have called a swing
      }
    })

    test('three misread beats do not make a swing', () => {
      for (let seed = 1; seed <= 20; seed++) {
        const { t, v } = series(() => 52, 0.6, seed)
        // the camera loses the pulse for a beat: the rate drops to 44, as a judge saw on a still face
        for (const i of [4, 11, 17]) v[i] = 44
        const ls = lockedSwing(t, v, 0)!
        expect(ls.swingBpm).toBeLessThan(1.5)
        expect(ls.dropped).toBeGreaterThanOrEqual(3)
        expect(range(v)).toBeGreaterThan(7) // max - min reported 8 to 9 bpm here
      }
    })

    test('misread beats do not hide a real swing either', () => {
      const { t, v } = series(swing12, 0.8, 9)
      for (const i of [3, 12, 19]) v[i] = 44
      const ls = lockedSwing(t, v, 0)!
      expect(Math.abs(ls.swingBpm - 12)).toBeLessThan(1.5)
    })

    test('a slow drift over the two breaths is not a swing', () => {
      const { t, v } = series((s) => 60 + 0.4 * s, 0.6, 3)
      expect(lockedSwing(t, v, 0)!.swingBpm).toBeLessThan(1.5)
      expect(range(v)).toBeGreaterThan(7)
    })

    test('rates that scatter like noise, or too few of them: no number', () => {
      const { t, v } = series(() => 66, 14, 2)
      expect(lockedSwing(t, v, 0)).toBeNull()
      expect(lockedSwing([0, 1000, 2000], [60, 62, 61], 0)).toBeNull()
    })

    test('one paced breath (the mini ping) is enough for the swing', () => {
      const { t, v } = series(swing12, 0.8, 4)
      const n = t.findIndex((x) => x >= 10000)
      const ls = lockedSwing(t.slice(0, n), v.slice(0, n), 0)!
      expect(Math.abs(ls.swingBpm - 12)).toBeLessThan(2)
    })

  describe('lock-in on the beats (the camera sees each beat tens of ms early or late)', () => {
    // beats of a heart whose rate is truth(s), each seen with `jitterMs` of timing error, then the app's own step
    // from beats to beat-to-beat rates (impossible intervals dropped)
    const beatsOf = (truth: (s: number) => number, jitterMs: number, seed: number, seconds = 20) => {
      let x = seed
      const rnd = () => {
        x = (x * 1664525 + 1013904223) % 4294967296
        return x / 4294967296
      }
      const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, rnd()))) * Math.cos(2 * Math.PI * rnd())
      const beats: number[] = []
      let acc = rnd()
      for (let ms = 0; ms < seconds * 1000; ms += 2) {
        acc += (truth(ms / 1000) / 60000) * 2
        if (acc >= 1) {
          acc -= 1
          beats.push(ms + jitterMs * gauss())
        }
      }
      return beats
    }
    const ratesOf = (beats: number[]) => {
      const ibi = beats.slice(1).map((b, i) => b - beats[i]!)
      const sorted = [...ibi].sort((a, b) => a - b)
      const med = sorted[Math.floor(sorted.length / 2)]!
      const t: number[] = []
      const v: number[] = []
      for (let i = 0; i < ibi.length; i++) {
        if (ibi[i]! < 0.65 * med || ibi[i]! > 1.5 * med) continue
        t.push((beats[i]! + beats[i + 1]!) / 2)
        v.push(60000 / ibi[i]!)
      }
      return { t, v }
    }
    const swing12 = (s: number) => 66 + 6 * Math.sin((2 * Math.PI * s) / 10)
    const range = (v: number[]) => Math.max(...v) - Math.min(...v)

    test('reads a 12 bpm swing through 30 ms of beat timing error', () => {
      for (let seed = 1; seed <= 20; seed++) {
        const { t, v } = ratesOf(beatsOf(swing12, 30, seed))
        const ls = lockedSwing(t, v, 0)!
        expect(Math.abs(ls.swingBpm - 12)).toBeLessThan(3)
        expect(ls.se).toBeLessThan(1.5)
        expect(Math.abs(ls.peakAtS - 2.5)).toBeLessThan(1)
      }
    })

    test('a steady heart seen with 30 ms of timing error reads near zero, though its rates scatter by many bpm', () => {
      const got: number[] = []
      for (let seed = 1; seed <= 40; seed++) {
        const { t, v } = ratesOf(beatsOf(() => 66, 30, seed))
        expect(range(v)).toBeGreaterThan(6) // what max - min would have called a swing
        got.push(lockedSwing(t, v, 0)!.swingBpm)
      }
      expect(got.filter((s) => s > 3).length).toBe(0)
      expect(got.reduce((a, b) => a + b, 0) / got.length).toBeLessThan(1)
    })

    test('a missed beat and a spurious one do not make or hide a swing', () => {
      for (let seed = 1; seed <= 20; seed++) {
        const still = beatsOf(() => 60, 15, seed)
        still.splice(7, 1) // missed
        still.splice(14, 0, (still[13]! + still[14]!) / 2) // spurious
        const a = ratesOf(still)
        expect(lockedSwing(a.t, a.v, 0)!.swingBpm).toBeLessThan(2.5)
        const moving = beatsOf(swing12, 15, seed)
        moving.splice(7, 1)
        moving.splice(14, 0, (moving[13]! + moving[14]!) / 2)
        const b = ratesOf(moving)
        expect(Math.abs(lockedSwing(b.t, b.v, 0)!.swingBpm - 12)).toBeLessThan(2.5)
      }
    })

    test('the standard error says how far off it can be', () => {
      let inside = 0
      for (let seed = 1; seed <= 60; seed++) {
        const { t, v } = ratesOf(beatsOf(swing12, 40, seed))
        const ls = lockedSwing(t, v, 0)!
        if (Math.abs(ls.swingBpm - 12) <= 2 * ls.se) inside++
      }
      expect(inside).toBeGreaterThanOrEqual(51) // 85% of 60; two standard errors should hold about 95%
    })

    test('beats scattered by a quarter of a beat are not a heart: no number', () => {
      const { t, v } = ratesOf(beatsOf(() => 66, 230, 3))
      const ls = lockedSwing(t, v, 0)
      expect(ls === null || ls.se > HEART_MAX_SWING_SE).toBe(true)
    })

    test('a pulse followed through only part of the breaths gives no swing', () => {
      const w = { t0: 0, fs: 30, x: new Float64Array(30 * 12), bpm: 66, snrQuality: 1 }
      expect(coversBreaths(w as never, [0, 20000])).toBe(false)
      expect(coversBreaths({ ...w, x: new Float64Array(30 * 19) } as never, [0, 20000])).toBe(true)
    })
  })
  })

  test('nothing at all: source none', () => {
    expect(heartFeatures({ waveT: [], waveV: [], camT: [], camGate: [], airT: [], airBpm: [], settle: SETTLE, breathe: BREATHE })).toEqual({ restBpm: null, swingBpm: null, quality: 0, source: 'none' })
  })

  test('zero-phase band-pass does not shift a beat', () => {
    const fs = 30
    const x = Array.from({ length: 600 }, (_, i) => Math.cos((2 * Math.PI * 1.1 * i) / fs))
    const y = bandpassZeroPhase(x, fs, 0.7, 3)
    let k = 300
    while (!(y[k] > y[k - 1] && y[k] >= y[k + 1])) k++
    let k0 = 300
    while (!(x[k0] > x[k0 - 1] && x[k0] >= x[k0 + 1])) k0++
    expect(k).toBe(k0)
  })
})

// ---------------------------------------------------------------- whole ping

function fullRecording(mini: boolean): Recording {
  const r = rng(99)
  const rec = emptyRecording(1000)
  const at = (s: number) => 1000 + s * 1000
  const P = mini
    ? { laugh: 0, breathe: 8, end: 18 }
    : { settle: 0, nod: 8, laugh: 14, speak: 26, breathe: 38, end: 58 }
  rec.marks = mini
    ? [{ key: 'laugh', t: at(0) }, { key: 'breathe', t: at(8) }]
    : [{ key: 'settle', t: at(0) }, { key: 'nod', t: at(8) }, { key: 'laugh', t: at(14) }, { key: 'speak', t: at(26) }, { key: 'breathe', t: at(38) }]
  rec.t1 = at(P.end)
  const laughOn = P.laugh + 1
  const nodAt = mini ? -100 : 9
  const hrAt = (s: number) => (s >= P.breathe ? 64 + 5 * Math.sin((2 * Math.PI * (s - P.breathe)) / 10) : 64)
  const cp = new CameraPulse()
  let phase = 0
  let last = 0
  for (let s = 0; s < P.end; s += 1 / 30) {
    const t = at(s)
    phase += 2 * Math.PI * (hrAt(s) / 60) * (s - last)
    last = s
    const u = s - (laughOn + 0.6)
    const smile = 0.04 + (u > 0 && u < 5 ? 0.5 * Math.min(1, u / 0.4) * Math.min(1, (5 - u) / 0.8) : 0)
    const nu = s - nodAt
    const pitch = -6 + (nu >= 0 && nu < 2 ? -7 * Math.sin(2 * Math.PI * 1 * nu) : 0) + 0.1 * r.gauss()
    rec.face.t.push(t)
    rec.face.present.push(true)
    rec.face.smile.push(smile)
    rec.face.cheek.push(smile * 0.6)
    rec.face.pitch.push(pitch)
    rec.face.yaw.push(0.1 * r.gauss())
    rec.face.roll.push(0.1 * r.gauss())
    const st = cp.push(t, ...skin(t, phase, 0.004, 0.0004, r))
    rec.camPulse.t.push(t)
    rec.camPulse.bpm.push(st.bpm)
    rec.camPulse.quality.push(st.snrQuality)
    rec.camPulse.gate.push(1)
  }
  rec.wave = cp.series(rec.t0, rec.t1)
  if (!mini) {
    for (let s = 0; s < P.end; s += 0.02) {
      const on = s >= 27 && s < 36 && !(s >= 30 && s < 30.6)
      rec.voice.t.push(at(s))
      rec.voice.voiced.push(on)
      rec.voice.rms.push(on ? -28 + 5 * Math.sin(2 * Math.PI * 4.5 * s) : -68)
      rec.voice.f0.push(on ? 190 * 2 ** ((3 * Math.sin(2 * Math.PI * 0.4 * s)) / 12) : null)
    }
  }
  return rec
}

describe('computePing', () => {
  test('a step read as the next one starts is the reading the whole ping ends with', () => {
    const rec = fullRecording(false)
    const whole = computePing(rec, 1000 + 15000).features
    /** the recording as it stood `ms` after the mark that opened phase n */
    const cut = (n: number, ms = 5): Recording => {
      const t1 = rec.marks[n].t + ms
      const keep = <T extends { t: number[] }>(o: T): T => {
        const idx = o.t.map((t, i) => (t <= t1 ? i : -1)).filter((i) => i >= 0)
        return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, idx.map((i) => (v as unknown[])[i])])) as T
      }
      return { ...rec, t1, marks: rec.marks.slice(0, n + 1), face: keep(rec.face), airHead: keep(rec.airHead), camPulse: keep(rec.camPulse), airPulse: keep(rec.airPulse), wave: keep(rec.wave), voice: keep(rec.voice) }
    }
    // the nod, read as the laugh starts
    expect(computePing(cut(2), null).features.move.nodPeakVelDegS).toBe(whole.move.nodPeakVelDegS)
    // the smile's time, read two seconds into the laugh and again as the next step starts
    const early = computePing({ ...cut(2, 3000) }, 1000 + 15000).features.smile.latencyMs
    expect(early).not.toBeNull()
    expect(early).toBe(whole.smile.latencyMs)
    expect(computePing(cut(3), 1000 + 15000).features.smile.latencyMs).toBe(whole.smile.latencyMs)
    // the voice, read as the breaths start
    expect(computePing(cut(4), 1000 + 15000).features.voice.f0SdSemitones).toBe(whole.voice.f0SdSemitones)
  })

  test('full ping: every group filled, traces at 10 Hz', () => {
    const rec = fullRecording(false)
    const { features: f, traces: tr } = computePing(rec, 1000 + 15000)
    expect(Math.abs((f.smile.latencyMs ?? 0) - 720)).toBeLessThan(60) // 600 ms + 0.15/0.5 of the 400 ms ramp
    expect(f.smile.peak).toBeCloseTo(0.5, 1)
    expect(f.smile.auc).toBeGreaterThan(2)
    expect(f.smile.duchenne).toBeCloseTo(0.32, 1)
    expect(f.move.nodCount).toBe(2)
    expect(Math.abs((f.move.nodAmplitudeDeg ?? 0) - 14)).toBeLessThan(1.2)
    expect(Math.abs((f.move.nodPeakVelDegS ?? 0) - 44)).toBeLessThan(6)
    expect(f.move.source).toBe('camera')
    expect(f.move.restlessness).toBeLessThan(3)
    expect(f.voice.speechFraction).toBeCloseTo(8.4 / 12, 1)
    expect(f.voice.pauseCount).toBe(1)
    expect(Math.abs((f.voice.f0MedianHz ?? 0) - 190)).toBeLessThan(8)
    expect(Math.abs((f.voice.f0SdSemitones ?? 0) - 3 / Math.SQRT2)).toBeLessThan(0.3)
    expect(Math.abs((f.voice.syllableRateHz ?? 0) - 4.5)).toBeLessThan(0.5)
    expect(f.heart.source).toBe('camera')
    expect(Math.abs((f.heart.restBpm ?? 0) - 64)).toBeLessThan(2)
    expect(f.heart.swingBpm ?? 0).toBeGreaterThan(7.5)
    expect(f.heart.swingBpm ?? 99).toBeLessThan(11.5)

    expect(tr.t.length).toBe(580)
    for (const k of ['smile', 'cheek', 'headPitch', 'bpm', 'rms', 'f0'] as const) expect(tr[k].length).toBe(tr.t.length)
    expect(tr.t[1] - tr.t[0]).toBe(100)
    expect(tr.phases).toEqual([
      { key: 'settle', at: 0 },
      { key: 'nod', at: 8000 },
      { key: 'laugh', at: 14000 },
      { key: 'speak', at: 26000 },
      { key: 'breathe', at: 38000 },
    ])
    expect(Math.max(...tr.smile)).toBeCloseTo(0.54, 1)
    expect(tr.bpm[570]).not.toBeNull()
    expect(tr.f0[320]).not.toBeNull()
    expect(tr.f0[100]).toBeNull()
    expect(JSON.stringify({ f, tr }).length).toBeLessThan(40000)
  })

  test('mini ping (laugh + breathe): voice and move stay at zero / null', () => {
    const rec = fullRecording(true)
    const { features: f, traces: tr } = computePing(rec, 1000 + 1000)
    expect(f.voice).toEqual({ speechFraction: 0, pauseCount: 0, meanPauseMs: 0, f0MedianHz: null, f0SdSemitones: null, loudnessSdDb: 0, syllableRateHz: null })
    expect(f.move).toEqual({ nodAmplitudeDeg: null, nodPeakVelDegS: null, nodCount: 0, restlessness: 0, source: 'camera' })
    expect(f.smile.peak).toBeCloseTo(0.5, 1)
    expect(f.smile.latencyMs).not.toBeNull()
    expect(f.heart.swingBpm ?? 0).toBeGreaterThan(6)
    expect(f.heart.swingBpm ?? 99).toBeLessThan(11.5)
    expect(f.heart.restBpm).not.toBeNull()
    expect(tr.t.length).toBe(180)
  })

  test('empty recording: zeros, no throw', () => {
    const rec = emptyRecording(0)
    const { features: f, traces: tr } = computePing(rec, null)
    expect(f.heart).toEqual({ restBpm: null, swingBpm: null, quality: 0, source: 'none' })
    expect(f.smile.peak).toBe(0)
    expect(tr.t.length).toBe(0)
  })
})
