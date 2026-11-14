import { useEffect, useRef, useState } from 'react'
import type { EarEvent } from '@shared/ear'
import { currentSense, keepAwake, live, stopSession } from '../session'
import { currentEarNow, personalRead } from '../personal'
import { IconClose } from '../icons'
import { loadEarModel } from '../../tune/ear'

type Counts = Record<'nod' | 'shake' | 'laugh' | 'smile', number>

const emptyCounts = (): Counts => ({ nod: 0, shake: 0, laugh: 0, smile: 0 })

export default function Follow({ onLeave }: { onLeave(): void }) {
  const [head, setHead] = useState({ pitch: 0, yaw: 0, roll: 0 })
  const [counts, setCounts] = useState<Counts>(emptyCounts)
  const [talkS, setTalkS] = useState(0)
  const [moveDeg, setMoveDeg] = useState(0)
  const [startedAt] = useState(() => performance.now())
  const [air, setAir] = useState(true)
  const [readyTick, setReadyTick] = useState(0)
  const lastOn = useRef<Set<EarEvent>>(new Set())
  const lastT = useRef(performance.now())
  const totalMove = useRef(0)
  const totalTalk = useRef(0)
  const countsRef = useRef(counts)

  useEffect(() => {
    const ready = currentSense()
    if (!ready) {
      const retry = window.setInterval(() => {
        if (currentSense()) {
          clearInterval(retry)
          setReadyTick((n) => n + 1)
        }
      }, 120)
      return () => clearInterval(retry)
    }
    const sense = ready
    setAir(sense.caps.airpodsMotion)
    void keepAwake(true)
    live.setPhase('idle')
    live.startFrames()
    const offs = [
      sense.on('caps', (c) => setAir(c.airpodsMotion)),
      sense.on('head', (h) => {
        if (h.source !== 'airpods') return
        setHead({ pitch: h.pitch, yaw: h.yaw, roll: h.roll })
        const now = performance.now()
        const dt = Math.max(0, Math.min(0.5, (now - lastT.current) / 1000))
        lastT.current = now
        const r = personalRead().rate ?? 0
        totalMove.current += r * dt
        setMoveDeg(totalMove.current)
      }),
    ]
    let raf = 0
    const tick = () => {
      const now = performance.now()
      const ear = currentEarNow()
      const on = new Set(ear?.on ?? personalRead().earOn)
      const fired = (['nod', 'shake', 'laugh', 'smile'] as const).filter((e) => on.has(e) && !lastOn.current.has(e))
      if (fired.length) setCounts((old) => {
        const next = { ...old }
        fired.forEach((e) => { next[e]++ })
        countsRef.current = next
        return next
      })
      const dt = Math.max(0, Math.min(0.5, (now - lastT.current) / 1000))
      if (on.has('talk')) {
        totalTalk.current += dt
        setTalkS(totalTalk.current)
      }
      lastOn.current = on
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      offs.forEach((off) => off())
      live.stopFrames()
      stopSession()
      void keepAwake(false)
      try {
        localStorage.setItem('vire.follow.last', JSON.stringify({ at: new Date().toISOString(), counts: countsRef.current, talkS: totalTalk.current, moveDeg: totalMove.current, seconds: (performance.now() - startedAt) / 1000 }))
      } catch { /* private mode */ }
    }
    // Follow owns one continuous session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyTick, onLeave])

  const mins = Math.max(1 / 60, (performance.now() - startedAt) / 60000)
  const perMinute = Math.round(moveDeg / mins)
  const model = loadEarModel()
  const can = (event: EarEvent) => model?.events[event]?.score.ok === true
  const cell = (event: keyof Counts, label: string) => can(event) ? <div><b>{counts[event]}</b><span>{label}</span></div> : <div><b>—</b><span>{label} · needs the camera</span></div>
  return (
    <div className="va-follow">
      <header className="va-follow-top">
        <div>
          <p className="va-follow-kicker">FOLLOW</p>
          <h1 className="va-follow-title">Your measured loop</h1>
        </div>
        <button className="va-icon-btn" onClick={onLeave} aria-label="Stop following"><IconClose /></button>
      </header>
      <main className="va-follow-main">
        <section className="va-follow-compass" aria-label="Head direction from AirPods">
          <svg viewBox="0 0 260 260" role="img" aria-label={`Head turned ${Math.round(head.yaw)} degrees`}>
            <circle className="va-follow-orbit" cx="130" cy="130" r="104" />
            <path className="va-follow-cross" d="M130 20v220M20 130h220" />
            <g transform={`translate(130 130) rotate(${head.roll}) rotate(${head.yaw * -0.35}) translate(-130 -130)`}>
              <path className="va-follow-head" d="M130 62c-36 0-62 26-62 66 0 46 25 70 62 70s62-24 62-70c0-40-26-66-62-66Z" />
              <path className="va-follow-nose" d="M130 94v64l-14 11h28" />
              <circle className="va-follow-dot" cx="108" cy="122" r="4" /><circle className="va-follow-dot" cx="152" cy="122" r="4" />
            </g>
            <text x="130" y="16" textAnchor="middle">UP</text><text x="244" y="135" textAnchor="end">RIGHT</text>
          </svg>
          <p className="va-follow-reading">{Math.round(head.yaw)}° yaw · {Math.round(head.pitch)}° pitch · {Math.round(head.roll)}° roll</p>
        </section>
        {!air && <p className="va-follow-alert" role="status">AirPods stopped. Put them back in and I’ll pick up again.</p>}
        <section className="va-follow-tally" aria-label="Follow tally">
          {cell('nod', 'nods')}
          {cell('shake', 'head shakes')}
          {cell('laugh', 'laughs')}
          {cell('smile', 'smiles')}
          <div><b>{can('talk') ? `${Math.round(talkS)}s` : '—'}</b><span>talking{can('talk') ? '' : ' · needs the camera'}</span></div>
          <div><b>{perMinute}°</b><span>head movement / min</span></div>
        </section>
      </main>
      <p className="va-small va-honest">A measured loop, not a diagnosis.</p>
    </div>
  )
}
