// A walk with a beat. The beat starts at the person's own step rate and moves a little ahead only while
// they keep up; when they fall off it, it comes back to them. Steps come from the AirPods or the phone's
// motion sensor. With neither, the beat is fixed and the screen says so.
import { useRef, useState } from 'react'
import { audio } from '../audio'
import type { Handle } from '../audio'
import { mockControl } from '../mockSense'
import { median } from './num'
import { currentSense, isMock } from '../session'
import { DOSE_SECONDS, DoseShell, DoseWords, createTimers, endHoldMs, leftOf, patched, reducedMotion, useRun } from './shared'
import type { DoseProps } from './shared'
import { FIXED_BEAT, createStepCounter, leadBeat, startBeat, walkEndLine } from './steps'
import type { Beat } from './steps'

const TOTAL_MS = DOSE_SECONDS * 1000
const TICK_MS = 90
/** no motion sample at all after this long: there is no sensor to wait for */
const NO_SENSOR_AFTER_MS = 6000
/** a sensor but no steps after this long: start a fixed beat to walk to */
const NO_STEPS_AFTER_MS = 10000
/** the beat is scheduled this far ahead on the audio clock, so it never stutters */
const AHEAD_S = 0.35
/** the step rate eases toward each new reading, so one uneven step does not move the number or the beat */
const CADENCE_EASE = 0.12
/** the first few step gaps read a little off: the beat starts once the rate has been felt for this long */
const SETTLE_MS = 1500
/** off the beat for this long before the screen says the beat is coming back */
const SAY_BACK_AFTER_S = 1
/** a calm pentatonic figure, one note per step (0 is a rest) */
const NOTES = [220, 0, 277.18, 0, 329.63, 0, 277.18, 246.94]

type Source = 'finding' | 'airpods' | 'phone' | 'none'

interface View {
  line: string
  sub: string
  cadence: number | null
  beat: number | null
  left: string
  end: string | null
}

const START: View = { line: 'Start walking.', sub: 'I’m finding your pace.', cadence: null, beat: null, left: leftOf(TOTAL_MS, 0), end: null }

/** the size of the phone's own acceleration in g, with gravity taken out */
function phoneMotion(e: DeviceMotionEvent): number | null {
  const a = e.acceleration
  if (a && a.x != null && a.y != null && a.z != null) return Math.hypot(a.x, a.y, a.z) / 9.81
  const g = e.accelerationIncludingGravity
  if (g && g.x != null && g.y != null && g.z != null) return Math.abs(Math.hypot(g.x, g.y, g.z) / 9.81 - 1)
  return null
}

function walkWords(beat: Beat | null, following: boolean, source: Source, cadence: number | null): [string, string] {
  if (!beat) return [START.line, START.sub]
  if (following && cadence == null) return ['Keep walking.', 'I can’t feel your steps right now.']
  if (!following) {
    const why = source === 'none' ? 'No motion sensor here, so the beat is fixed.' : 'I can’t feel your steps yet, so the beat is fixed.'
    return ['Walk with the beat.', why]
  }
  if (beat.offS > SAY_BACK_AFTER_S) return ['The beat is coming back to you.', '']
  return beat.spm > beat.own ? ['You’re with the beat.', 'It moves ahead while you keep up.'] : ['This is your own pace.', 'Keep it, and the beat moves ahead.']
}

export default function Walk({ onFinish, onLeave }: DoseProps) {
  const [view, setView] = useState<View>(START)
  const padL = useRef<HTMLSpanElement>(null)
  const padR = useRef<HTMLSpanElement>(null)
  const done = useRef(() => {})

  useRun(() => {
    const sense = currentSense()
    const ctx = audio.ctx
    const timers = createTimers()
    const steps = createStepCounter()
    const cadences: number[] = []
    const fired: { at: number; n: number }[] = []
    const still = reducedMotion()
    const t0 = performance.now()
    let voice: Handle | null = null
    let source: Source = 'finding'
    let lastSample = 0
    let felt: number | null = null
    let feltSince = 0
    let beat: Beat | null = null
    /** false while the beat is fixed because no step rate can be measured */
    let following = false
    let nextAt = 0
    let n = 0
    let raf = 0
    let ended = false

    const set = (patch: Partial<View>) => setView((v) => patched(v, patch))
    if (isMock()) mockControl.walking = true
    void audio.playSoon('vo-dose-walk').then((h) => {
      voice = h
      if (ended) h?.stop(50)
    })

    const feed = (t: number, mag: number, from: 'airpods' | 'phone') => {
      // AirPods ride on the head and read steps cleanly: once they speak, the phone is not asked
      if (source === 'airpods' && from === 'phone') return
      source = from
      lastSample = t
      steps.feed(t, mag)
    }
    const off = sense?.on('head', (f) => {
      if (f.source === 'airpods') feed(f.t, Math.hypot(f.ax, f.ay, f.az), 'airpods')
    })
    const onMotion = (e: DeviceMotionEvent) => {
      const mag = phoneMotion(e)
      if (mag != null) feed(performance.now(), mag, 'phone')
    }
    window.addEventListener('devicemotion', onMotion)

    const startAt = (spm: number, follow: boolean) => {
      beat = startBeat(spm)
      following = follow
      if (ctx && !nextAt) nextAt = ctx.currentTime + 0.15
    }

    /** the step rate now, or null when no steps are being felt */
    const measure = (now: number): number | null => {
      const raw = now - lastSample > 2500 ? null : steps.cadence(now)
      if (raw == null) {
        felt = null
        return null
      }
      if (felt == null) feltSince = now
      felt = felt == null ? raw : felt + (raw - felt) * CADENCE_EASE
      return now - feltSince >= SETTLE_MS ? felt : null
    }

    const schedule = () => {
      if (!ctx || !beat) return
      // a tab that slept must not fire the beats it missed all at once
      if (nextAt < ctx.currentTime) nextAt = ctx.currentTime + 0.05
      while (nextAt < ctx.currentTime + AHEAD_S) {
        audio.thump(nextAt, 0.42)
        const note = NOTES[n % NOTES.length]
        if (note) audio.pluck(nextAt, note, 0.13)
        fired.push({ at: nextAt, n })
        if (fired.length > 8) fired.shift()
        n++
        nextAt += 60 / beat.spm
      }
    }

    const end = () => {
      if (ended) return
      ended = true
      voice?.stop(200)
      audio.chime(0.35)
      const kept = beat && following ? beat.keptS : 0
      const line = walkEndLine(cadences, kept, source !== 'none' && source !== 'finding')
      set({ end: line })
      const metrics: Record<string, number> = { steps: steps.count(), keptBeatSeconds: Math.round(kept) }
      if (beat) metrics.beatSpm = Math.round(beat.spm)
      if (cadences.length) metrics.cadenceSpm = Math.round(median(cadences))
      else metrics.timed = 1
      timers.after(endHoldMs(line), () => onFinish(metrics, line))
    }
    done.current = end

    const tick = () => {
      if (ended) return
      const now = performance.now()
      const ms = now - t0
      const cadence = measure(now)
      if (cadence != null) {
        cadences.push(cadence)
        if (!following) startAt(cadence, true)
      } else if (!beat && source === 'finding' && ms > NO_SENSOR_AFTER_MS) {
        source = 'none'
        startAt(FIXED_BEAT, false)
      } else if (!beat && ms > NO_STEPS_AFTER_MS) {
        startAt(FIXED_BEAT, false)
      }
      if (beat && following) leadBeat(beat, cadence, TICK_MS / 1000)
      schedule()
      const [line, sub] = walkWords(beat, following, source, cadence)
      set({ line, sub, cadence: cadence == null ? null : Math.round(cadence), beat: beat ? beat.spm : null, left: leftOf(TOTAL_MS, ms) })
      if (ms >= TOTAL_MS) end()
    }

    /** the two pads light on the beat they stand for, left then right */
    const draw = () => {
      raf = requestAnimationFrame(draw)
      if (!ctx || still) return
      let last: { at: number; n: number } | null = null
      for (const f of fired) if (f.at <= ctx.currentTime) last = f
      const glow = last && !ended ? Math.exp(-(ctx.currentTime - last.at) * 5) : 0
      padL.current?.style.setProperty('--on', (last && last.n % 2 === 0 ? glow : 0).toFixed(3))
      padR.current?.style.setProperty('--on', (last && last.n % 2 === 1 ? glow : 0).toFixed(3))
    }

    timers.every(TICK_MS, tick)
    raf = requestAnimationFrame(draw)

    return () => {
      ended = true
      timers.stop()
      cancelAnimationFrame(raf)
      off?.()
      window.removeEventListener('devicemotion', onMotion)
      voice?.stop(200)
      mockControl.walking = false
    }
  })

  const ended = view.end != null
  const number = view.cadence ?? view.beat
  return (
    <DoseShell title="A walk with a beat" count={view.left} ended={ended} onDone={() => done.current()} onLeave={onLeave}>
      <div className="va-walk">
        <div className="va-walk-pads" aria-hidden="true">
          <span ref={padL} className="va-walk-pad" />
          <span ref={padR} className="va-walk-pad" />
        </div>
        <p className="va-walk-num">{number ?? ''}</p>
        <p className="va-walk-unit">
          {number == null ? '' : view.cadence != null ? `steps a minute · beat ${view.beat ?? ''}` : 'beats a minute'}
        </p>
      </div>
      <DoseWords line={view.end ?? view.line} sub={view.sub} end={ended} />
    </DoseShell>
  )
}
