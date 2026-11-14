// Slow breathing: three paces, two breaths each. The heart shows which pace swings it most,
// and that pace is where tomorrow starts. Without a readable pulse it is a plain pacer and says so.
import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { audio } from '../audio'
import type { Handle } from '../audio'
import { mockControl } from '../mockSense'
import { currentSense, isMock } from '../session'
import { createDemoWave, scriptedHeart } from './demoPulse'
import { clamp, mean, plural, smooth } from './num'
import {
  BREATHS_PER_PACE,
  PACE_FIRST,
  PACE_MAX,
  PACE_MIN,
  WAVE_SETTLES_MS,
  bestRead,
  breathAt,
  breatheEndLine,
  breatheMetrics,
  emptyPulseLog,
  liveRate,
  logPulse,
  nextCentre,
  paceSchedule,
  readPace,
} from './paces'
import type { LiveRate, PaceRead, PaceSlot, WaveSeries } from './paces'
import { DoseShell, DoseWords, band, createTimers, dot, endHoldMs, label, leftOf, openPlot, patched, reducedMotion, token, trace, useRun } from './shared'
import type { DoseProps } from './shared'

const PACE_KEY = 'vire.dose.breathe.pace'
/** how small the guide is at the bottom of the out-breath, as a share of its full size */
const ORB_EMPTY = 0.58
/** a camera that has just started needs about ten seconds before it can say whether it sees a pulse */
const FINDING_MS = 12000
/** the live line looks back this far, and its newest second is left off: it is still settling */
const LINE_WINDOW_MS = 20000
const LINE_HEAD_MS = 1000
/** the oldest beats in the window are read with nothing before them and land loosely: a point stays as it was drawn before it got there */
const LINE_EDGE_MS = 4000
/** two points of the line further apart than this are not joined */
const LINE_BREAK_MS = 1500
/** the first breath waits this long at most for the camera's first frame */
const LEAD_MAX_MS = 4000

function rememberedPace(): number {
  try {
    const raw = localStorage.getItem(PACE_KEY)
    const pace = raw == null ? NaN : Number(raw)
    return Number.isFinite(pace) ? clamp(pace, PACE_MIN, PACE_MAX) : PACE_FIRST
  } catch {
    return PACE_FIRST
  }
}

function rememberPace(pace: number) {
  try {
    localStorage.setItem(PACE_KEY, pace.toFixed(1))
  } catch {
    /* private mode: tomorrow starts at six again */
  }
}

/** 0 at the bottom of the out-breath, 1 at the top of the in-breath */
const lungs = (u: number) => (u < 0.5 ? smooth(u * 2) : 1 - smooth((u - 0.5) * 2))

type Pulse = 'finding' | 'read' | 'unread'

interface View {
  word: string
  sub: string
  slot: number
  reads: PaceRead[]
  pulse: Pulse
  bpm: number | null
  left: string
  end: string | null
}

/** the top of the chart is kept for the words in and out */
const LABEL_ROW_PX = 16

interface LinePoint {
  /** ms into the dose */
  ms: number
  bpm: number
}

/** a stretch of the dose, ms from its start to its end */
type Stretch = [number, number]

const within = (ms: number, stretches: Stretch[]) => stretches.some(([from, to]) => ms >= from && ms < to)

/** lay the newest reading over the line: it replaces what was drawn for the same seconds while they were still settling */
function mergeLine(line: LinePoint[], live: LiveRate, t0: number, now: number) {
  const settled = now - t0 - LINE_WINDOW_MS + LINE_EDGE_MS
  const head = now - LINE_HEAD_MS
  const fresh: LinePoint[] = []
  for (let i = 0; i < live.t.length; i++) {
    const ms = live.t[i]! - t0
    if (ms >= 0 && ms >= settled && live.t[i]! < head) fresh.push({ ms, bpm: live.bpm[i]! })
  }
  if (!fresh.length) return
  while (line.length && line[line.length - 1]!.ms >= fresh[0]!.ms) line.pop()
  line.push(...fresh)
}

/** the line as the chart draws it: nothing where the pulse was not read, and no bridge across a pause */
function shownLine(line: LinePoint[], unread: Stretch[]): (LinePoint | null)[] {
  const out: (LinePoint | null)[] = []
  let last: LinePoint | null = null
  for (const pt of line) {
    if (within(pt.ms, unread)) {
      last = null
      continue
    }
    if (!last || pt.ms - last.ms > LINE_BREAK_MS) out.push(null)
    out.push(pt)
    last = pt
  }
  return out
}

function paceWords(slots: PaceSlot[], i: number): string {
  if (i === 0) return 'In as the sound rises, out as it falls.'
  return slots[i]!.pace < slots[i - 1]!.pace ? 'Now a little slower.' : 'Now a little faster.'
}

function pulseLabel(v: View): string {
  if (v.pulse === 'read' && v.bpm != null) return `${v.bpm} beats a minute`
  if (v.pulse === 'unread') return 'I can’t read your pulse right now'
  return 'Finding your pulse'
}

function readLabel(read: PaceRead): string {
  return read.swingBpm == null ? 'not read' : plural(Math.round(read.swingBpm), 'beat')
}

export default function Breathe({ onFinish, onLeave }: DoseProps) {
  const [slots] = useState(() => paceSchedule(rememberedPace()))
  const [view, setView] = useState<View>({
    word: 'Breathe in',
    sub: paceWords(slots, 0),
    slot: 0,
    reads: [],
    pulse: 'finding',
    bpm: null,
    left: leftOf(slots[slots.length - 1]!.endMs, 0),
    end: null,
  })
  const orb = useRef<HTMLDivElement>(null)
  const chart = useRef<HTMLCanvasElement>(null)
  const done = useRef(() => {})

  useRun(() => {
    const sense = currentSense()
    const totalMs = slots[slots.length - 1]!.endMs
    const centre = slots[0]!.pace
    const log = emptyPulseLog()
    const timers = createTimers()
    const handles: Handle[] = []
    const reads: PaceRead[] = []
    const line: LinePoint[] = []
    const unread: Stretch[] = []
    const still = reducedMotion()
    const opened = performance.now()
    let t0 = opened
    const demoHeart = isMock() ? scriptedHeart(slots, t0) : null
    const demoWave = demoHeart ? createDemoWave(demoHeart, t0) : null
    /** the minute starts on the camera's first frame: a pace is read only when the pulse covers it from its first breath */
    let begun = demoHeart != null || !sense?.caps.camera
    let seen = false
    /** the pulse has passed the gate at some point, and did the last time it was looked at, `lookedMs` into the dose */
    let found = false
    let followed = false
    let lookedMs = 0
    let slotNow = 0
    let halfNow = -1
    let ended = false
    let raf = 0

    const set = (patch: Partial<View>) => setView((v) => patched(v, patch))
    /** ms into the minute; 0 while the first breath is still waiting */
    const sinceStart = () => (begun ? performance.now() - t0 : 0)
    const keep = (h: Handle | null) => {
      if (h) handles.push(h)
    }

    sense?.setHeartSession(true)
    const off = sense?.on('pulse', (p) => {
      seen = true
      logPulse(log, p)
    })
    if (!begun) set({ word: 'Settle in.', sub: 'Your first breath starts in a moment.' })
    if (demoHeart) mockControl.heart = demoHeart
    void audio.playSoon('vo-dose-breathe', { gain: 0.9 }).then((h) => (ended ? h?.stop(50) : keep(h)))

    /** the camera's pulse wave between two times on the pulse clock */
    const waveBetween = (from: number, to: number): WaveSeries => {
      if (demoWave) return demoWave(from, to, performance.now())
      return sense ? sense.pulseWave(from, to) : { t: [], v: [] }
    }

    const breathe = (inward: boolean, slot: PaceSlot) => {
      set({ word: inward ? 'Breathe in' : 'And out' })
      keep(audio.breath(inward ? 'in' : 'out', slot.breathMs / 2000, 0.45))
    }

    /** a pace is over: read its swing, and take its line off the chart when the reading is withheld */
    const closePace = (i: number) => {
      const slot = slots[i]!
      const read = readPace(log, waveBetween(t0 + slot.startMs, t0 + slot.endMs), slot, t0)
      reads.push(read)
      if (read.swingBpm == null) unread.push([slot.startMs, slot.endMs])
      set({ reads: [...reads] })
    }

    /** AirPods send rates as they are; the camera's wave needs a moment before a pace's last beat is in it */
    const settleMs = () => (followed && !log.airT.length ? WAVE_SETTLES_MS : 0)

    /** read every pace whose breaths are over; `settled` waits for the wave to hold its last beat */
    const readPaces = (ms: number, settled: boolean) => {
      while (reads.length < slots.length) {
        const slot = slots[reads.length]!
        if (ms < slot.endMs + (settled ? settleMs() : 0)) return
        closePace(reads.length)
      }
    }

    /** the beat-to-beat rate up to now, laid over the line; a gap where the pulse stopped passing the gate */
    const followPulse = () => {
      if (ended || !begun) return
      const now = performance.now()
      const ms = now - t0
      const live = liveRate(log, waveBetween(now - LINE_WINDOW_MS, now), now)
      if (live) {
        found = true
        mergeLine(line, live, t0, now)
        set({ pulse: 'read', bpm: Math.round(mean(live.bpm.slice(-8))) })
      } else {
        // before the pulse is first found nothing is held against those seconds: the wave may still cover them
        if (found) unread.push([lookedMs, ms])
        set({ pulse: ms > FINDING_MS ? 'unread' : 'finding', bpm: null })
      }
      followed = live != null
      lookedMs = ms
    }

    const breathsDone = (ms: number) => {
      const at = breathAt(slots, ms)
      return at ? Math.floor(at.half / 2) : slots.length * BREATHS_PER_PACE
    }

    const end = () => {
      if (ended) return
      ended = true
      const ms = sinceStart()
      readPaces(ms, false)
      const source = log.airT.length ? 'airpods' : 'camera'
      rememberPace(nextCentre(reads, centre))
      const line = breatheEndLine(reads, source)
      set({ end: line, reads: [...reads] })
      handles.forEach((h) => h.stop(600))
      audio.chime(0.3)
      const metrics = breatheMetrics(reads, centre, breathsDone(ms))
      timers.after(endHoldMs(line), () => onFinish(metrics, line))
    }
    done.current = end

    const begin = () => {
      t0 = performance.now()
      begun = true
      set({ sub: paceWords(slots, 0) })
    }

    const step = () => {
      if (ended) return
      if (!begun) {
        if (!seen && performance.now() - opened < LEAD_MAX_MS) return
        begin()
      }
      const ms = sinceStart()
      const at = breathAt(slots, ms)
      readPaces(ms, true)
      set({ left: leftOf(totalMs, ms) })
      if (!at) {
        // the breaths are over; the last pace is read once its last beat is in the wave
        if (reads.length === slots.length) end()
        else set({ word: 'One moment.', sub: 'Reading your last breaths.' })
        return
      }
      if (at.slot !== slotNow) {
        slotNow = at.slot
        set({ slot: slotNow, sub: paceWords(slots, slotNow) })
      }
      if (at.half !== halfNow) {
        halfNow = at.half
        breathe(at.half % 2 === 0, slots[at.slot]!)
      }
    }

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const ms = Math.min(totalMs, sinceStart())
      const at = breathAt(slots, ms)
      if (orb.current && !still) {
        const size = ended || !at ? ORB_EMPTY : ORB_EMPTY + (1 - ORB_EMPTY) * lungs(at.u)
        orb.current.style.transform = `scale(${size.toFixed(4)})`
      }
      drawChart(chart.current, slots, shownLine(line, unread), ended ? totalMs : ms)
    }

    step()
    timers.every(40, step)
    timers.every(500, followPulse)
    raf = requestAnimationFrame(draw)

    return () => {
      ended = true
      cancelAnimationFrame(raf)
      timers.stop()
      off?.()
      handles.forEach((h) => h.stop(180))
      mockControl.heart = null
    }
  })

  const best = bestRead(view.reads)
  const ended = view.end != null
  return (
    <DoseShell title="Slow breathing" count={view.left} ended={ended} onDone={() => done.current()} onLeave={onLeave}>
      <div className="va-breathe-hero" data-ended={ended || undefined}>
        <div className="va-breathe-guide" aria-hidden="true">
          <div ref={orb} className="va-breathe-orb" />
        </div>
      </div>
      <DoseWords line={view.end ?? view.word} sub={view.sub} end={ended} />
      <div className="va-heart">
        <p className="va-heart-label" data-pulse={view.pulse}>
          {ended ? '' : pulseLabel(view)}
        </p>
        <canvas ref={chart} className="va-heart-chart" role="img" aria-label="Your heart rate, beat by beat, across the three paces" />
        <ol className="va-heart-paces" style={{ '--paces': slots.map((s) => `${s.endMs - s.startMs}fr`).join(' ') } as CSSProperties}>
          {slots.map((s, i) => {
            const read = view.reads[i]
            return (
              <li key={s.pace} data-now={(!ended && i === view.slot) || undefined} data-best={(best != null && read === best) || undefined}>
                <b>{s.pace.toFixed(1)}</b>
                {read && <span> · {readLabel(read)}</span>}
              </li>
            )
          })}
        </ol>
      </div>
    </DoseShell>
  )
}

/** the whole minute left to right: each pace's in-breaths shaded, the heart rate drawn where it was read */
function drawChart(cv: HTMLCanvasElement | null, slots: PaceSlot[], line: (LinePoint | null)[], nowMs: number) {
  const p = openPlot(cv)
  if (!p || !cv) return
  const totalMs = slots[slots.length - 1]!.endMs
  const ink = token(cv, '--stage-ink')
  const heart = token(cv, '--ch-heart')
  const x = (ms: number) => (ms / totalMs) * p.w
  for (const s of slots) {
    for (let b = 0; b * s.breathMs < s.endMs - s.startMs - 1; b++) {
      const from = s.startMs + b * s.breathMs
      band(p, x(from), x(from + s.breathMs / 2), ink, 0.07)
    }
    if (s.startMs > 0) band(p, x(s.startMs) - 0.5, x(s.startMs) + 0.5, ink, 0.3)
  }
  const first = slots[0]!
  label(p, 'in', x(first.breathMs / 4), 3, ink, 0.55)
  label(p, 'out', x((3 * first.breathMs) / 4), 3, ink, 0.55)
  band(p, x(nowMs), x(nowMs) + 1, ink, 0.35)
  const read = line.filter((pt): pt is LinePoint => pt != null)
  if (read.length < 2) return
  const lo = Math.min(...read.map((pt) => pt.bpm))
  const hi = Math.max(...read.map((pt) => pt.bpm))
  const mid = (lo + hi) / 2
  const half = Math.max(5, (hi - lo) / 2 + 1)
  // the line stays under the row that says in and out
  const top = LABEL_ROW_PX + 4
  const bottom = p.h - 6
  const y = (bpm: number) => (top + bottom) / 2 - ((bpm - mid) / half) * ((bottom - top) / 2)
  trace(
    p,
    line.map((pt) => (pt ? [x(pt.ms), y(pt.bpm)] : null)),
    heart,
  )
  const head = read[read.length - 1]!
  dot(p, x(head.ms), y(head.bpm), 3, heart)
}
