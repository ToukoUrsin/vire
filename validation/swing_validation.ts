#!/usr/bin/env bun
// Heart swing at the breath's period: the camera's reading against a finger oximeter on UBFC-rPPG dataset 2.
//
//   bun validation/swing_validation.ts
//
// Camera side: the skin colour the app's face tracker read from each frame (recorded by run_lab.mjs for the pulse
// check, `face` rows of RAW/<subject>.json) goes through the app's own code: CameraPulse -> analyzePulseWindow ->
// the quality gate -> beatSeries -> lockedSwing. Each frame carries the capture time the dataset gives for it.
// (The recording itself was made with a slowed clock on a loaded server with no GPU, which stamps frames late by
// 60-70 ms SD; a phone stamps a frame when the camera took it. The reading with those late stamps is reported too.)
// Reference side: the oximeter's pulse wave through the same beat picking and the same lockedSwing.
//
// Writes validation/results-swing.jsonl (one line per window) and OUT/swing-summary.json (read by build_summary.py).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { analyzePulseWindow, beatSeries, coversBreaths, HEART_MAX_SWING_SE, HEART_MIN_QUALITY, lockedSwing } from '../web/src/sense/features'
import { CameraPulse } from '../web/src/sense/rppg'

const RAW = '/bulk2/runs/depression/validation/raw/pulse_v1_warp'
const GT = '/bulk2/runs/depression/validation/pulse/ubfc/DATASET_2'
const OUT = '/bulk2/runs/depression/validation/swing'
const HERE = import.meta.dir
const WIN = 20_000
const STEP = 10_000
const PERIOD = 10_000
/** a window counts as still when the oximeter's own swing at the period is under this */
const STILL_BPM = 1.5
/** and a reading over this on a still window is a false swing */
const FALSE_BPM = 3

interface Frame {
  /** capture time from the dataset, ms from the first frame */
  t: number
  /** the stamp the slowed browser run gave it, on the same origin */
  tLate: number
  gate: number
  r: number
  g: number
  b: number
}

interface Person {
  subject: string
  half: 'A' | 'B'
  frames: Frame[]
  ppgT: number[]
  ppg: number[]
}

interface Reading {
  quality: number
  /** lock-in swing and its standard error, before the display gate */
  swing: number | null
  se: number | null
  dropped: number | null
  /** max minus min of the smoothed beat-to-beat rate: what the echo used before */
  range: number | null
  beats: number
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length)
const sd = (a: number[]) => {
  const m = mean(a)
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1))
}
const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y)
  return s.length ? (s[Math.floor((s.length - 1) / 2)]! + s[Math.ceil((s.length - 1) / 2)]!) / 2 : NaN
}
const round = (x: number | null, n = 2) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 10 ** n) / 10 ** n)
const corr = (a: number[], b: number[]) => {
  const ma = mean(a)
  const mb = mean(b)
  let sab = 0
  let saa = 0
  let sbb = 0
  for (let i = 0; i < a.length; i++) {
    sab += (a[i]! - ma) * (b[i]! - mb)
    saa += (a[i]! - ma) ** 2
    sbb += (b[i]! - mb) ** 2
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : null
}

function load(subject: string, index: number): Person {
  const d = JSON.parse(readFileSync(path.join(RAW, `${subject}.json`), 'utf8'))
  const gt = readFileSync(path.join(GT, subject, 'ground_truth.txt'), 'utf8')
    .trim()
    .split(/\n/)
    .map((ln) => ln.trim().split(/\s+/).map(Number))
  const ppg = gt[0]!
  const ppgT = gt[2]!.map((x) => (x - gt[2]![0]!) * 1000)
  const rows = d.face as (number | null)[][]
  // put the browser's stamps on the dataset's origin: the median offset between the two clocks
  const offs: number[] = []
  for (const f of rows) {
    const k = Math.round(f[1] ?? -1)
    if (k >= 0 && k < ppgT.length && finite(f[0])) offs.push(f[0] - ppgT[k]!)
  }
  const off = median(offs)
  const frames: Frame[] = []
  let last = -1
  for (const f of rows) {
    const k = Math.round(f[1] ?? -1)
    // each video frame once, in order, and only when the tracker had a face and a skin colour
    if (k <= last || k >= ppgT.length || f[3] !== 1 || !finite(f[13]) || !finite(f[14]) || !finite(f[15]) || !finite(f[0])) continue
    last = k
    frames.push({ t: ppgT[k]!, tLate: f[0] - off, gate: finite(f[11]) ? f[11] : 0, r: f[13], g: f[14], b: f[15] })
  }
  return { subject, half: index % 2 === 0 ? 'A' : 'B', frames, ppgT, ppg }
}

/** the app's pulse wave for these frames */
function wave(frames: Frame[], late: boolean): { t: number[]; v: number[] } {
  const cam = new CameraPulse()
  let prev = -Infinity
  for (const f of frames) {
    const t = late ? f.tLate : f.t
    if (t <= prev) continue
    prev = t
    cam.push(t, f.r, f.g, f.b)
  }
  return cam.series(-1e12, 1e12)
}

/** what the app's breathe step would report for this window */
function read(w: { t: number[]; v: number[] }, gates: number[], start: number, periodMs = PERIOD, winMs = WIN): Reading {
  const none: Reading = { quality: 0, swing: null, se: null, dropped: null, range: null, beats: 0 }
  const win: [number, number] = [start, start + winMs]
  const pw = analyzePulseWindow(w.t, w.v, win)
  if (!pw) return none
  const quality = pw.snrQuality * (gates.length ? mean(gates) : 0)
  if (quality < HEART_MIN_QUALITY) return { ...none, quality }
  const bs = beatSeries(pw)
  if (!bs) return { ...none, quality }
  const ls = coversBreaths(pw, win) ? lockedSwing(bs.rateT, bs.rate, start, periodMs) : null
  return { quality, swing: ls?.swingBpm ?? null, se: ls?.se ?? null, dropped: ls?.dropped ?? null, range: bs.swingBpm, beats: bs.beats.length }
}

interface Ref {
  swing: number | null
  se: number | null
  clean: boolean
  /** the period (4 to 12 s) at which this person's rate swings most in this window, and that swing */
  ownPeriodS: number | null
  ownSwing: number | null
}

function reference(p: Person, start: number): { ref: Ref; rateT: number[]; rate: number[] } | null {
  const pw = analyzePulseWindow(p.ppgT, p.ppg, [start, start + WIN])
  const bs = pw ? beatSeries(pw) : null
  if (!pw || !bs) return null
  // the oximeter slips on some people: its beats must add up to its own rate
  const expected = (pw.bpm * WIN) / 60000
  const whole = Math.abs(bs.beats.length - expected) <= 0.15 * expected
  const ls = lockedSwing(bs.rateT, bs.rate, start)
  let ownPeriodS: number | null = null
  let ownSwing: number | null = null
  for (let period = 4000; period <= 12000; period += 500) {
    const l = lockedSwing(bs.rateT, bs.rate, start, period)
    if (l && l.se <= HEART_MAX_SWING_SE && (ownSwing === null || l.swingBpm > ownSwing)) {
      ownSwing = l.swingBpm
      ownPeriodS = period / 1000
    }
  }
  const clean = whole && !!ls && ls.se <= HEART_MAX_SWING_SE
  return { ref: { swing: ls?.swingBpm ?? null, se: ls?.se ?? null, clean, ownPeriodS, ownSwing }, rateT: bs.rateT, rate: bs.rate }
}

interface Row {
  subject: string
  half: 'A' | 'B'
  startS: number
  quality: number
  refSwing: number | null
  refSe: number | null
  refClean: boolean
  /** the lock-in reading, and whether the app would show it (quality and standard error gates) */
  newReading: number | null
  newSe: number | null
  shown: boolean
  /** the same with the slowed run's late frame stamps */
  lateReading: number | null
  lateShown: boolean
  /** max minus min of the smoothed rate, shown whenever the quality gate passes */
  oldReading: number | null
  ownPeriodS: number | null
  ownRefSwing: number | null
  ownNewReading: number | null
  ownShown: boolean
}

interface Pair {
  subject: string
  startS: number
  reading: number
  ref: number
}

function agreement(pairs: Pair[]) {
  if (!pairs.length) return { windows: 0 }
  const err = pairs.map((p) => p.reading - p.ref)
  const m = mean(err)
  const s = sd(err)
  let worst = 0
  for (let i = 1; i < err.length; i++) if (Math.abs(err[i]!) > Math.abs(err[worst]!)) worst = i
  const bins = [
    [0, STILL_BPM],
    [STILL_BPM, 3],
    [3, 6],
    [6, Infinity],
  ].map(([lo, hi]) => {
    const e = pairs.filter((p) => p.ref >= lo! && p.ref < hi!).map((p) => p.reading - p.ref)
    return { referenceSwing: hi === Infinity ? `${lo}+` : `${lo}-${hi}`, windows: e.length, mae: e.length ? round(mean(e.map(Math.abs))) : null, bias: e.length ? round(mean(e)) : null }
  })
  return {
    windows: pairs.length,
    people: new Set(pairs.map((p) => p.subject)).size,
    mae: round(mean(err.map(Math.abs))),
    medianAbsError: round(median(err.map(Math.abs))),
    bias: round(m),
    rmse: round(Math.sqrt(mean(err.map((x) => x * x)))),
    correlation: round(corr(pairs.map((p) => p.reading), pairs.map((p) => p.ref)), 3),
    loa95: [round(m - 1.96 * s), round(m + 1.96 * s)],
    meanReference: round(mean(pairs.map((p) => p.ref))),
    worst: { subject: pairs[worst]!.subject, startS: pairs[worst]!.startS, reading: round(pairs[worst]!.reading), reference: round(pairs[worst]!.ref), error: round(err[worst]!) },
    byReferenceSwing: bins,
  }
}

const subjects = readdirSync(RAW)
  .filter((x) => /^subject\d+\.json$/.test(x))
  .map((x) => x.replace('.json', ''))
  .sort((a, b) => Number(a.slice(7)) - Number(b.slice(7)))
const people = subjects.map(load)

const rows: Row[] = []
const dropouts: { subject: string; startS: number; durationMs: number; rep: number; reference: number; newReading: number | null; shown: boolean; oldReading: number | null }[] = []
// deterministic placements for the blanked stretches
let seed = 0x51a7
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}

for (const p of people) {
  const w = wave(p.frames, false)
  const wLate = wave(p.frames, true)
  const end = Math.min(p.frames[p.frames.length - 1]!.t, p.ppgT[p.ppgT.length - 1]!)
  for (let start = 0; start + WIN <= end; start += STEP) {
    const gates = p.frames.filter((f) => f.t >= start && f.t < start + WIN).map((f) => f.gate)
    const gatesLate = p.frames.filter((f) => f.tLate >= start && f.tLate < start + WIN).map((f) => f.gate)
    const r = reference(p, start)
    const cam = read(w, gates, start)
    const late = read(wLate, gatesLate, start)
    const shown = finite(cam.swing) && finite(cam.se) && cam.se <= HEART_MAX_SWING_SE
    const own = r?.ref.ownPeriodS ? read(w, gates, start, r.ref.ownPeriodS * 1000) : null
    rows.push({
      subject: p.subject,
      half: p.half,
      startS: start / 1000,
      quality: round(cam.quality, 3)!,
      refSwing: round(r?.ref.swing ?? null, 3),
      refSe: round(r?.ref.se ?? null, 3),
      refClean: !!r?.ref.clean,
      newReading: round(cam.swing, 3),
      newSe: round(cam.se, 3),
      shown,
      lateReading: round(late.swing, 3),
      lateShown: finite(late.swing) && finite(late.se) && late.se <= HEART_MAX_SWING_SE,
      oldReading: round(cam.range, 3),
      ownPeriodS: r?.ref.ownPeriodS ?? null,
      ownRefSwing: round(r?.ref.ownSwing ?? null, 3),
      ownNewReading: round(own?.swing ?? null, 3),
      ownShown: !!own && finite(own.swing) && finite(own.se) && own.se <= HEART_MAX_SWING_SE,
    })
    if (!r?.ref.clean || !finite(r.ref.swing)) continue
    // dropouts: the face is lost for half a second or a second somewhere in the window (a head turn, a flicker)
    for (const durationMs of [300, 500, 700, 850, 1000]) {
      for (let rep = 0; rep < 5; rep++) {
        const at = start + 1000 + rnd() * (WIN - durationMs - 2000)
        const kept = p.frames.filter((f) => f.t >= start - 15000 && f.t < start + WIN + 2000 && !(f.t >= at && f.t < at + durationMs))
        const cut = read(wave(kept, false), kept.filter((f) => f.t >= start && f.t < start + WIN).map((f) => f.gate), start)
        dropouts.push({
          subject: p.subject,
          startS: start / 1000,
          durationMs,
          rep,
          reference: round(r.ref.swing, 3)!,
          newReading: round(cut.swing, 3),
          shown: finite(cut.swing) && finite(cut.se) && cut.se <= HEART_MAX_SWING_SE,
          oldReading: round(cut.range, 3),
        })
      }
    }
  }
}

// one paced breath (the mini ping after a dose reads the swing from 10 s): the same comparison on 10 s windows
const oneBreath: Pair[] = []
let oneBreathWindows = 0
for (const p of people) {
  const w = wave(p.frames, false)
  const end = Math.min(p.frames[p.frames.length - 1]!.t, p.ppgT[p.ppgT.length - 1]!)
  for (let start = 0; start + PERIOD <= end; start += PERIOD) {
    const win: [number, number] = [start, start + PERIOD]
    const rp = analyzePulseWindow(p.ppgT, p.ppg, win)
    const rb = rp ? beatSeries(rp) : null
    const rl = rp && rb && Math.abs(rb.beats.length - (rp.bpm * PERIOD) / 60000) <= 0.15 * ((rp.bpm * PERIOD) / 60000) ? lockedSwing(rb.rateT, rb.rate, start) : null
    if (!rl || rl.se > HEART_MAX_SWING_SE) continue
    oneBreathWindows++
    const gates = p.frames.filter((f) => f.t >= start && f.t < start + PERIOD).map((f) => f.gate)
    const cam = read(w, gates, start, PERIOD, PERIOD)
    if (finite(cam.swing) && finite(cam.se) && cam.se <= HEART_MAX_SWING_SE) oneBreath.push({ subject: p.subject, startS: start / 1000, reading: cam.swing, ref: rl.swingBpm })
  }
}

const scored = rows.filter((r) => r.refClean && finite(r.refSwing))
const pairsNew = (rs: Row[]): Pair[] => rs.filter((r) => r.shown).map((r) => ({ subject: r.subject, startS: r.startS, reading: r.newReading!, ref: r.refSwing! }))
const pairsOld = (rs: Row[]): Pair[] => rs.filter((r) => finite(r.oldReading)).map((r) => ({ subject: r.subject, startS: r.startS, reading: r.oldReading!, ref: r.refSwing! }))
const pairsLate = (rs: Row[]): Pair[] => rs.filter((r) => r.lateShown).map((r) => ({ subject: r.subject, startS: r.startS, reading: r.lateReading!, ref: r.refSwing! }))
const pairsOwn: Pair[] = rows
  .filter((r) => r.ownShown && finite(r.ownRefSwing) && r.refClean)
  .map((r) => ({ subject: r.subject, startS: r.startS, reading: r.ownNewReading!, ref: r.ownRefSwing! }))

const still = scored.filter((r) => r.refSwing! < STILL_BPM)
const stillNew = still.filter((r) => r.shown)
const stillOld = still.filter((r) => finite(r.oldReading))
const calibration = pairsNew(scored).map((p, i) => Math.abs(p.reading - p.ref) / Math.max(0.05, scored.filter((r) => r.shown)[i]!.newSe!))

function dropoutStats(durationMs: number) {
  const all = dropouts.filter((d) => d.durationMs === durationMs)
  const shown = all.filter((d) => d.shown)
  const old = all.filter((d) => finite(d.oldReading))
  const stillAll = all.filter((d) => d.reference < STILL_BPM)
  return {
    trials: all.length,
    new: {
      shown: shown.length,
      mae: shown.length ? round(mean(shown.map((d) => Math.abs(d.newReading! - d.reference)))) : null,
      bias: shown.length ? round(mean(shown.map((d) => d.newReading! - d.reference))) : null,
      stillTrials: stillAll.filter((d) => d.shown).length,
      stillFalse: stillAll.filter((d) => d.shown && d.newReading! > FALSE_BPM).length,
    },
    old: {
      shown: old.length,
      mae: round(mean(old.map((d) => Math.abs(d.oldReading! - d.reference)))),
      bias: round(mean(old.map((d) => d.oldReading! - d.reference))),
      stillTrials: stillAll.filter((d) => finite(d.oldReading)).length,
      stillFalse: stillAll.filter((d) => finite(d.oldReading) && d.oldReading! > FALSE_BPM).length,
    },
  }
}

// ---- a known swing: the lock-in on a heart that swings by a set amount, seen with the camera's measured beat timing error ----
// (people here are not paced, so a known paced swing has to be made: beats of a heart at `bpm` whose rate swings by
// `swing` with a 10 s period, each beat seen late or early by the timing error measured above, one beat missed and
// one misplaced by a fifth of a beat in every 20 s)
function beatTimingError(): number {
  const errs: number[] = []
  for (const p of people) {
    const w = wave(p.frames, false)
    const end = Math.min(p.frames[p.frames.length - 1]!.t, p.ppgT[p.ppgT.length - 1]!)
    for (let start = 0; start + WIN <= end; start += STEP) {
      const row = rows.find((r) => r.subject === p.subject && r.startS === start / 1000)
      if (!row?.refClean || row.quality < HEART_MIN_QUALITY) continue
      const cp = analyzePulseWindow(w.t, w.v, [start, start + WIN])
      const rp = analyzePulseWindow(p.ppgT, p.ppg, [start, start + WIN])
      const cb = cp ? beatSeries(cp) : null
      const rb = rp ? beatSeries(rp) : null
      if (!cb || !rb) continue
      const lag = cb.beats.map((b) => rb.beats.reduce((best, x) => (Math.abs(b - x) < Math.abs(best) ? b - x : best), Infinity))
      const mid = median(lag)
      const e = lag.map((x) => x - mid).filter((x) => Math.abs(x) < 250)
      if (e.length >= 10) errs.push(sd(e))
    }
  }
  return median(errs)
}

function gauss(): number {
  const u = Math.max(1e-12, rnd())
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd())
}

function simulate(bpm: number, swing: number, timingSdMs: number, trials: number) {
  const got: number[] = []
  let withheld = 0
  for (let k = 0; k < trials; k++) {
    const phase0 = rnd() * 2 * Math.PI
    // true beats: integrate the swinging rate
    const beats: number[] = []
    let acc = rnd()
    for (let t = 0; t < WIN; t += 2) {
      acc += ((bpm + (swing / 2) * Math.sin((2 * Math.PI * t) / PERIOD + phase0)) / 60000) * 2
      if (acc >= 1) {
        acc -= 1
        beats.push(t)
      }
    }
    const seen = beats.map((b) => b + timingSdMs * gauss())
    const miss = 2 + Math.floor(rnd() * (seen.length - 4))
    seen.splice(miss, 1)
    const moved = 2 + Math.floor(rnd() * (seen.length - 4))
    seen[moved]! += (0.2 * 60000) / bpm
    seen.sort((a, b) => a - b)
    // the app's own step from beats to rates: impossible intervals are dropped
    const ibi = seen.slice(1).map((b, i) => b - seen[i]!)
    const med = median(ibi)
    const rateT: number[] = []
    const rate: number[] = []
    for (let i = 0; i < ibi.length; i++) {
      if (ibi[i]! < 0.65 * med || ibi[i]! > 1.5 * med) continue
      rateT.push((seen[i]! + seen[i + 1]!) / 2)
      rate.push(60000 / ibi[i]!)
    }
    const ls = lockedSwing(rateT, rate, 0)
    if (!ls || ls.se > HEART_MAX_SWING_SE) {
      withheld++
      continue
    }
    got.push(ls.swingBpm)
  }
  return { bpm, swing, trials, shown: got.length, withheld, meanReading: round(mean(got)), sdReading: round(sd(got)), p5: round([...got].sort((a, b) => a - b)[Math.floor(0.05 * got.length)] ?? null), p95: round([...got].sort((a, b) => a - b)[Math.floor(0.95 * got.length)] ?? null) }
}

const timingSdMs = beatTimingError()
const known = []
for (const bpm of [60, 80, 100]) for (const swing of [0, 4, 8, 12, 16]) known.push(simulate(bpm, swing, timingSdMs, 400))

// ---- the browser on a synthetic paced face (made by OUT/make_swing.py, run by OUT/browser-v2/run.sh) ----
const browser = [0, 4, 8, 12].map((swing) => {
  const dir = path.join(OUT, 'browser-v2')
  const runs: { run: string; swingBpm: number | null; swingSe: number | null; fps: number | null }[] = []
  for (const f of existsSync(dir) ? readdirSync(dir).filter((x) => x.startsWith(`browser-${swing}-`) && x.endsWith('.json')).sort() : []) {
    try {
      const d = JSON.parse(readFileSync(path.join(dir, f), 'utf8'))
      const h = d?.ping?.features?.heart
      if (h) runs.push({ run: f, swingBpm: h.swingBpm ?? null, swingSe: h.swingSe ?? null, fps: d?.perf?.fps ?? null })
    } catch {
      // a run that did not finish
    }
  }
  const vals = runs.map((r) => r.swingBpm).filter(finite)
  return { swing, runs, shown: vals.length, meanReading: vals.length ? round(mean(vals)) : null }
})

const summary = {
  generatedAt: new Date().toISOString(),
  limits:
    'Not paced: these people sat at a desk and breathed as they liked, so this is the part of the heart rate that moves at a 10 s period, which paced breathing makes large. Sitting still in good light; uncompressed video; 16 people; frame capture times from the dataset; reference from the oximeter over the same seconds. A known paced swing is simulated or synthetic, never a person.',
  windowS: WIN / 1000,
  stepS: STEP / 1000,
  periodS: PERIOD / 1000,
  gate: { minQuality: HEART_MIN_QUALITY, maxSeBpm: HEART_MAX_SWING_SE },
  people: people.length,
  windows: rows.length,
  windowsReferenceClean: scored.length,
  windowsShown: scored.filter((r) => r.shown).length,
  shownPct: round((100 * scored.filter((r) => r.shown).length) / Math.max(1, scored.length), 1),
  new: agreement(pairsNew(scored)),
  newByHalf: { A: agreement(pairsNew(scored.filter((r) => r.half === 'A'))), B: agreement(pairsNew(scored.filter((r) => r.half === 'B'))) },
  old: agreement(pairsOld(scored)),
  lateStamps: agreement(pairsLate(scored)),
  ownPeriod: agreement(pairsOwn),
  oneBreath: { windowsReferenceClean: oneBreathWindows, ...agreement(oneBreath) },
  seCalibration: { medianErrorOverSe: round(median(calibration)), within2Se: round((100 * calibration.filter((z) => z <= 2).length) / Math.max(1, calibration.length), 1) },
  still: {
    referenceUnder: STILL_BPM,
    falseOver: FALSE_BPM,
    windows: still.length,
    newShown: stillNew.length,
    newFalse: stillNew.filter((r) => r.newReading! > FALSE_BPM).length,
    oldShown: stillOld.length,
    oldFalse: stillOld.filter((r) => r.oldReading! > FALSE_BPM).length,
  },
  dropouts: { 300: dropoutStats(300), 500: dropoutStats(500), 700: dropoutStats(700), 850: dropoutStats(850), 1000: dropoutStats(1000) },
  knownSwing: { simulated: true, beatTimingErrorMs: round(timingSdMs, 1), trialsEach: 400, results: known },
  browser: { synthetic: true, results: browser },
}

mkdirSync(OUT, { recursive: true })
writeFileSync(path.join(HERE, 'results-swing.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
writeFileSync(path.join(OUT, 'dropouts-swing.jsonl'), dropouts.map((r) => JSON.stringify(r)).join('\n') + '\n')
writeFileSync(path.join(OUT, 'swing-summary.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify(summary, null, 2))
