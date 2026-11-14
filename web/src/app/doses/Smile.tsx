// Smile along: four laughs with quiet between them. The face is read the whole time; the fourth laugh is
// the one it answered most. Nobody is asked to smile, and a face that stays quiet is a reading too.
import { useRef, useState } from 'react'
import { audio } from '../audio'
import type { Handle } from '../audio'
import { loadLovedLaugh } from '../laugh'
import { mockControl } from '../mockSense'
import { LAUGH_STIMS, bestStim, currentModel, personalRead, recordStimAnswer, stimName } from '../personal'
import { currentSense, isMock } from '../session'
import type { FaceFrame } from '../../sense/types'
import {
  AFTER_S,
  LAUGH_AT_S,
  LAUGH_S,
  SMILE_MARGIN,
  answerTo,
  firstThree,
  mostAnswered,
  pickFourth,
  restOutside,
  smileEndLine,
  smileMetrics,
} from './laughs'
import type { LaughAnswer, SmileSample } from './laughs'
import {
  DOSE_SECONDS,
  DoseShell,
  DoseWords,
  band,
  createClock,
  createTimers,
  dot,
  endHoldMs,
  leftOf,
  level,
  openPlot,
  patched,
  token,
  trace,
  useRun,
} from './shared'
import type { DoseProps } from './shared'

const TOTAL_MS = DOSE_SECONDS * 1000
const WINDOW_MS = (LAUGH_S + AFTER_S) * 1000
/** a face out of view this long is gone, not a blink of the tracker */
const LOST_AFTER_MS = 700
/** the most the clock waits, in all, for a face to come back */
const HOLD_BUDGET_MS = 10000
/** a laugh is read only when the face was in view for about half of it */
const MIN_FRAMES = 60

const LISTEN = 'Just listen. Let your face do what it does.'
const FACE_GONE = 'I can’t see your face. I’ll wait a moment.'
const FACE_GONE_ON = 'I can’t see your face, so this part isn’t read.'

interface Played {
  clip: string
  /** ms on the dose clock */
  from: number
  /** when its reading closed; null while it plays */
  until: number | null
}

interface View {
  line: string
  sub: string
  names: string[]
  left: string
  end: string | null
}

/** the smile reading: the personal face model's when the tune step was done, the general one otherwise */
function smileOf(f: FaceFrame): number {
  const own = currentModel() ? personalRead().muscles?.[0] : undefined
  return own ?? f.smile
}

const clipNumber = (clip: string) => LAUGH_STIMS.indexOf(clip as (typeof LAUGH_STIMS)[number]) + 1 || LAUGH_STIMS.length + 1

/** demo signals: the scripted person smiles at the second laugh, a little at the third, not at the first */
const SCRIPTED_SMILE_S = [0, 5, 2.5, 4]

export default function Smile({ onFinish, onLeave }: DoseProps) {
  const [view, setView] = useState<View>({ line: LISTEN, sub: '', names: [], left: leftOf(TOTAL_MS, 0), end: null })
  const chart = useRef<HTMLCanvasElement>(null)
  const done = useRef(() => {})

  useRun(() => {
    const sense = currentSense()
    const clock = createClock()
    const timers = createTimers()
    const samples: SmileSample[] = []
    const played: Played[] = []
    const answers: LaughAnswer[] = []
    const earlierBest = bestStim()
    let pool: string[] = [...LAUGH_STIMS]
    let order: string[] = []
    let lovedUrl: string | null = null
    let sound: Handle | null = null
    let open: Played | null = null
    let lastSeen = sense ? performance.now() : -Infinity
    let heldMs = 0
    let ended = false

    const set = (patch: Partial<View>) => setView((v) => patched(v, patch))
    LAUGH_STIMS.forEach((id) => void audio.load(id))
    void loadLovedLaugh().then((url) => {
      lovedUrl = url
      if (url && !order.length) pool = [...pool, 'personal']
      if (url && ended) URL.revokeObjectURL(url)
    })

    const off = sense?.on('face', (f) => {
      if (!f.present) return
      lastSeen = f.t
      if (!clock.holding()) samples.push({ t: clock.ms(f.t), v: smileOf(f) })
    })

    const restNow = () => restOutside(samples, played.map((p) => [p.from, p.from + WINDOW_MS]))

    const playClip = (clip: string): Handle | null => {
      if (clip === 'personal') return lovedUrl ? audio.playUrl(lovedUrl, { gain: 1 }) : null
      return audio.play(clip, { gain: 1 })
    }

    const scriptSmile = (i: number) => {
      const seconds = SCRIPTED_SMILE_S[i] ?? 0
      if (!isMock() || !seconds) return
      timers.after(900, () => (mockControl.face = 'smile'))
      timers.after(900 + seconds * 1000, () => (mockControl.face = null))
    }

    const startLaugh = (i: number) => {
      if (!order.length) order = firstThree(pool, Math.random)
      const again = i === 3 ? mostAnswered(answers) : null
      const clip = i < 3 ? order[i] : (pickFourth(answers, earlierBest) ?? order[0])
      const handle = clip ? playClip(clip) : null
      if (!clip || !handle) return
      sound = handle
      open = { clip, from: clock.ms(), until: null }
      played.push(open)
      scriptSmile(i)
      set({ names: played.map((p) => stimName(p.clip)), sub: again ? 'Once more, the one your face answered most.' : '' })
    }

    /**
     * Every finished laugh, read against the resting level as it is known now: the level settles as quiet
     * stretches go by, so the first laugh is read again once there is more than three seconds to go on.
     */
    const readLaughs = () => {
      answers.length = 0
      const rest = restNow()
      if (rest == null) return
      for (const p of played) {
        if (p.until == null) continue
        const until = p.until
        const seen = samples.filter((s) => s.t >= p.from && s.t < until).length
        if (seen >= MIN_FRAMES) answers.push(answerTo(p.clip, samples, rest, p.from, until))
      }
    }

    /** the laugh's ten seconds are over (or the person stopped): what did the face do */
    const closeLaugh = () => {
      const p = open
      open = null
      if (!p) return
      p.until = Math.min(clock.ms(), p.from + WINDOW_MS)
      readLaughs()
    }

    /** between laughs the clock waits for a face that left; while a laugh plays it runs on and says so */
    const watchFace = (dt: number) => {
      const gone = performance.now() - lastSeen > LOST_AFTER_MS
      const wait = gone && !open && heldMs < HOLD_BUDGET_MS && played.length < LAUGH_AT_S.length
      if (wait) heldMs += dt
      clock.hold(wait)
      set({ line: gone ? (wait ? FACE_GONE : FACE_GONE_ON) : LISTEN })
    }

    const end = () => {
      if (ended) return
      ended = true
      sound?.stop(400)
      closeLaugh()
      mockControl.face = null
      answers.forEach((a) => recordStimAnswer(a.clip, a.peak, a.latencyMs))
      const line = endLine(played.length, answers)
      set({ end: line })
      const metrics = answers.length ? smileMetrics(answers, clipNumber) : { faceRead: 0, laughs: played.length }
      timers.after(endHoldMs(line), () => onFinish(metrics, line))
    }
    done.current = end

    let last = performance.now()
    const step = () => {
      if (ended) return
      const now = performance.now()
      watchFace(now - last)
      last = now
      const ms = clock.ms()
      if (open && ms >= open.from + LAUGH_S * 1000) sound?.stop(600)
      if (open && ms >= open.from + WINDOW_MS) closeLaugh()
      const next = played.length
      if (!open && next < LAUGH_AT_S.length && ms >= LAUGH_AT_S[next]! * 1000) startLaugh(next)
      if (ms >= TOTAL_MS) end()
      set({ left: leftOf(TOTAL_MS, ms) })
    }

    const draw = () => {
      const rest = restNow()
      const live = open && rest != null ? answerTo(open.clip, samples, rest, open.from, clock.ms()) : null
      const crossings = [...answers.flatMap((a) => a.crossings), ...(live?.crossings ?? [])]
      drawChart(chart.current, samples, played, rest, crossings, ended ? TOTAL_MS : clock.ms())
    }

    timers.every(50, step)
    timers.every(66, draw)

    return () => {
      ended = true
      timers.stop()
      off?.()
      sound?.stop(200)
      mockControl.face = null
      if (lovedUrl) URL.revokeObjectURL(lovedUrl)
    }
  })

  const ended = view.end != null
  return (
    <DoseShell title="Smile along" count={view.left} ended={ended} onDone={() => done.current()} onLeave={onLeave}>
      <div className="va-smile">
        <ol className="va-smile-laughs" aria-label="The laughs so far">
          {LAUGH_AT_S.map((at, i) => (
            <li key={at} style={{ left: `${((at + LAUGH_S / 2) / DOSE_SECONDS) * 100}%` }}>
              {view.names[i] ?? ''}
            </li>
          ))}
        </ol>
        <canvas ref={chart} className="va-smile-chart" role="img" aria-label="Your smile through the minute, with each laugh shaded" />
      </div>
      <DoseWords line={view.end ?? view.line} sub={view.sub} end={ended} />
    </DoseShell>
  )
}

function endLine(laughsPlayed: number, answers: LaughAnswer[]): string {
  if (!laughsPlayed) return 'The laughter didn’t play, so there was nothing to answer.'
  if (!answers.length) return 'I couldn’t see your face through the laughter, so nothing was read.'
  return smileEndLine(answers, stimName)
}

/** the minute left to right: each laugh shaded, the smile drawn over it, a dot where it rose clear of rest */
function drawChart(cv: HTMLCanvasElement | null, samples: SmileSample[], played: Played[], rest: number | null, crossings: number[], nowMs: number) {
  const p = openPlot(cv)
  if (!p || !cv) return
  const ink = token(cv, '--stage-ink')
  const smile = token(cv, '--ch-smile')
  const x = (ms: number) => (ms / TOTAL_MS) * p.w
  const y = (v: number) => p.h - 8 - Math.min(1, Math.max(0, v)) * (p.h - 20)
  LAUGH_AT_S.forEach((at, i) => {
    const from = played[i]?.from ?? at * 1000
    band(p, x(from), x(from + LAUGH_S * 1000), played[i] ? smile : ink, played[i] ? 0.14 : 0.05)
  })
  if (rest != null) {
    level(p, y(rest), ink, 0.3)
    level(p, y(rest + SMILE_MARGIN), ink, 0.3, true)
  }
  band(p, x(nowMs), x(nowMs) + 1, ink, 0.35)
  if (samples.length < 2) return
  const pts: ([number, number] | null)[] = []
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!
    // a face out of view leaves a gap in the line, not a bridge across it
    if (i > 0 && s.t - samples[i - 1]!.t > 600) pts.push(null)
    pts.push([x(s.t), y(s.v)])
  }
  trace(p, pts, smile)
  if (rest != null) crossings.forEach((t) => dot(p, x(t), y(rest + SMILE_MARGIN), 3.5, ink))
  const head = samples[samples.length - 1]!
  dot(p, x(head.t), y(head.v), 3, smile)
}
