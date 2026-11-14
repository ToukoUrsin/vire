// The forest: three birds in a minute. Each one calls from the direction the head has looked at least,
// and is found by facing it and holding. The forest stays put while the head turns.
import { useRef, useState } from 'react'
import { audio } from '../audio'
import type { Handle } from '../audio'
import { mockControl } from '../mockSense'
import { currentSense, isMock } from '../session'
import {
  BIRDS,
  CLOSER_AFTER_S,
  CLOSER_EVERY_S,
  CONE_DEG,
  HINT_AFTER_S,
  HOLD_S,
  closer,
  createTurnMeter,
  emptyVisits,
  forestEndLine,
  placeBird,
  visit,
  whereWords,
} from './birds'
import ForestPanorama from './forest/ForestPanorama'
import { createHeading } from './forest/heading'
import { createForestSound } from './forest/sound'
import { clamp, wrap180 } from './num'
import { DOSE_SECONDS, DoseShell, DoseWords, createTimers, endHoldMs, patched, reducedMotion, useRun } from './shared'
import type { DoseProps } from './shared'

/** no bird starts before these seconds, so the three are spread over the minute */
const BIRD_NOT_BEFORE_S = [2, 20, 38]
/** a breath between finding one bird and hearing the next */
const AFTER_FOUND_MS = 1500
/** "Found it." stays this long, then the words go quiet until the next bird calls */
const FOUND_WORDS_MS = 3000
/** demo signals: the scripted head listens this long before it turns to the bird */
const SCRIPTED_LISTEN_MS = 2200
/** with no sensor after this long, say that a finger works too */
const NO_SENSOR_AFTER_MS = 3500
/** the arc is full at this many degrees to one side */
const ARC_FULL_DEG = 90

interface Bird {
  bearing: number
  /** performance.now() when it began calling */
  since: number
  /** and when it next comes a third of the way closer */
  closerAt: number
}

interface View {
  line: string
  sub: string
  yaw: number
  pitch: number
  bird: number | null
  found: number[]
  hold: number
  hintSide: 'left' | 'right' | null
  left: number
  right: number
  /** the whole range, the number the end line says */
  turned: number
  end: string | null
}

const START: View = {
  line: 'Somewhere around you, a bird is calling.',
  sub: 'Turn your head to find it.',
  yaw: 0,
  pitch: 0,
  bird: null,
  found: [],
  hold: 0,
  hintSide: null,
  left: 0,
  right: 0,
  turned: 0,
  end: null,
}

const round1 = (x: number) => Math.round(x * 10) / 10

export default function Forest({ onFinish, onLeave }: DoseProps) {
  const [view, setView] = useState<View>(START)
  const [still] = useState(reducedMotion)
  const heading = useRef<ReturnType<typeof createHeading> | null>(null)
  const done = useRef(() => {})

  useRun(() => {
    const head = createHeading(currentSense())
    heading.current = head
    const sound = createForestSound()
    const timers = createTimers()
    const visits = emptyVisits()
    const turn = createTurnMeter()
    const found: number[] = []
    const t0 = performance.now()
    let voice: Handle | null = null
    let bird: Bird | null = null
    let nextBirdAt = t0 + BIRD_NOT_BEFORE_S[0]! * 1000
    let yaw = 0
    let pitch = 0
    let hold = 0
    let last = 0
    let raf = 0
    let ended = false
    let foundShown: number[] = []

    const set = (patch: Partial<View>) => setView((v) => patched(v, patch))
    void audio.playSoon('vo-dose-forest').then((h) => {
      voice = h
      if (ended) h?.stop(50)
    })

    const newBird = (now: number) => {
      const bearing = placeBird(visits, yaw, head.reach(), found, Math.random)
      bird = { bearing, since: now, closerAt: now + CLOSER_AFTER_S * 1000 }
      hold = 0
      sound.newBird(found.length, bearing)
      if (isMock()) timers.after(SCRIPTED_LISTEN_MS, () => (mockControl.seekYaw = bearing + head.headZero()))
    }

    /** what to say about the bird that is calling now */
    const birdWords = (b: Bird, now: number): [string, string] => {
      if (hold > 0.25) return ['There. Hold it.', '']
      if (now - b.since >= HINT_AFTER_S * 1000) return [whereWords(b.bearing, yaw), '']
      if (!head.sensed() && now - t0 > NO_SENSOR_AFTER_MS) return ['No motion sensor here.', 'Drag the forest to look around.']
      return found.length ? ['Another one is calling.', START.sub] : [START.line, START.sub]
    }

    const birdFound = (now: number) => {
      if (!bird) return
      found.push(bird.bearing)
      foundShown = [...found]
      bird = null
      hold = 0
      sound.quietBird()
      sound.found()
      mockControl.seekYaw = null
      const all = found.length >= BIRDS
      nextBirdAt = all ? Infinity : Math.max(now + AFTER_FOUND_MS, t0 + BIRD_NOT_BEFORE_S[found.length]! * 1000)
      set(all ? { line: 'All three found.', sub: 'Stay with the forest.' } : { line: 'Found it.', sub: '' })
      if (!all) timers.after(FOUND_WORDS_MS, () => !bird && !ended && set({ line: 'Listen to the forest.', sub: 'Another bird will call soon.' }))
    }

    /** the bird that is calling: is the head on it, and has it waited long enough to come closer */
    const follow = (b: Bird, now: number, dt: number) => {
      const facing = Math.abs(wrap180(b.bearing - yaw)) < CONE_DEG
      hold = facing ? hold + dt : Math.max(0, hold - 2 * dt)
      sound.callIfDue(now)
      if (hold >= HOLD_S) {
        birdFound(now)
        return
      }
      if (now >= b.closerAt && !facing) {
        b.bearing = closer(b.bearing, yaw)
        b.closerAt = now + CLOSER_EVERY_S * 1000
        sound.moveBird(b.bearing)
      }
      const [line, sub] = birdWords(b, now)
      set({ line, sub })
    }

    const end = () => {
      if (ended) return
      ended = true
      voice?.stop(300)
      sound.quietBird()
      mockControl.seekYaw = null
      const range = turn.rangeDeg()
      const line = forestEndLine(range, found.length)
      set({ end: line, bird: null, hintSide: null })
      const metrics = { headRangeDeg: range, birdsFound: found.length, leftDeg: Math.round(turn.turned.left), rightDeg: Math.round(turn.turned.right) }
      timers.after(endHoldMs(line), () => onFinish(metrics, line))
    }
    done.current = end

    const frame = (now: number) => {
      raf = document.visibilityState === 'visible' ? requestAnimationFrame(frame) : 0
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016
      last = now
      const ease = still ? 1 : 1 - Math.exp(-12 * dt)
      yaw = wrap180(yaw + wrap180(head.yaw(now) - yaw) * ease)
      pitch += (head.pitch() - pitch) * ease
      sound.turnListener(yaw)
      if (ended) return
      visit(visits, yaw, dt)
      turn.feed(yaw)
      if (!bird && now >= nextBirdAt) newBird(now)
      if (bird) follow(bird, now, dt)
      if (now - t0 >= DOSE_SECONDS * 1000) end()
      const off = bird ? wrap180(bird.bearing - yaw) : 0
      const hinted = bird != null && (now - bird.since) / 1000 >= HINT_AFTER_S
      set({
        yaw: round1(yaw),
        pitch: round1(pitch),
        bird: bird ? bird.bearing : null,
        found: foundShown,
        hold: clamp(hold / HOLD_S, 0, 1),
        hintSide: hinted ? (off > 0 ? 'left' : 'right') : null,
        left: Math.round(turn.turned.left),
        right: Math.round(turn.turned.right),
        turned: turn.rangeDeg(),
      })
    }

    const onVisible = () => {
      if (document.visibilityState !== 'visible' || raf) return
      last = performance.now()
      raf = requestAnimationFrame(frame)
    }
    document.addEventListener('visibilitychange', onVisible)
    raf = requestAnimationFrame(frame)

    return () => {
      ended = true
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisible)
      timers.stop()
      head.stop()
      sound.stop()
      voice?.stop(300)
      mockControl.seekYaw = null
    }
  })

  const ended = view.end != null
  return (
    <DoseShell title="The forest" count={`${view.found.length} of ${BIRDS} found`} ended={ended} onDone={() => done.current()} onLeave={onLeave}>
      <div className="va-forest-scene">
        <ForestPanorama
          yaw={view.yaw}
          pitch={view.pitch}
          bird={view.bird}
          found={view.found}
          hold={view.hold}
          hintSide={view.hintSide}
          reducedMotion={still}
          onManualYaw={(yaw) => heading.current?.drag(yaw)}
        />
        <div className="va-forest-scrim" aria-hidden="true" />
        <TurnArc left={view.left} right={view.right} turned={view.turned} />
        <DoseWords line={view.end ?? view.line} sub={view.sub} end={ended} />
      </div>
    </DoseShell>
  )
}

/** how far the head has turned to each side of where it started, filling outwards from the top */
function TurnArc({ left, right, turned }: { left: number; right: number; turned: number }) {
  const share = (deg: number) => clamp(deg / ARC_FULL_DEG, 0, 1)
  return (
    <div className="va-forest-arc" role="img" aria-label={`You have turned through ${turned} degrees`}>
      <svg viewBox="0 0 200 66" aria-hidden="true">
        <path className="va-forest-arc-track" d="M12 60.5 A100 100 0 0 1 188 60.5" />
        <path className="va-forest-arc-fill" d="M100 8 A100 100 0 0 0 12 60.5" pathLength={1} style={{ strokeDasharray: `${share(left)} 1` }} />
        <path className="va-forest-arc-fill" d="M100 8 A100 100 0 0 1 188 60.5" pathLength={1} style={{ strokeDasharray: `${share(right)} 1` }} />
        <path className="va-forest-arc-start" d="M100 3 V13" />
      </svg>
      <span>{turned}° turned</span>
    </div>
  )
}
