// While a Vire page is open and the AirPods stream motion, keep one small bin a minute, build today from them,
// set it against the person's own earlier days, and offer a short practice when one of the few rules says so.
// Nothing here runs when the page is closed or hidden: it counts only what came while it was open.
//
// `paused`: a practice is running. The minutes go on being kept (marked as practice, left out of head down),
// and no practice is offered.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { EarModel2 } from '@shared/ear'
import { DOWN_DEG, binId, createPassiveTracker, driftOf, keepBetter, localDay, offerFor } from '@shared/earpassive'
import type { DaySummary, Drift, PassiveBin, PassiveOffer, PassiveShell, PassiveTracker, PassiveUsual } from '@shared/earpassive'
import { onNative } from '../../sense/native'
import type { Sense } from '../../sense/types'
import { createEarReader } from '../ear'
import type { EarReader } from '../ear'
import { daysNow } from './days'
import { fetchMine, keepBins, listBins, sendBins } from './store'

export type { PassiveOffer }

export interface PassiveLiveNow {
  /** the AirPods sent samples in the last 3 seconds */
  worn: boolean
  /** steps in the last 4 seconds */
  walking: boolean
  /** pitch more than 20 degrees below the person's upright, over the last 5 seconds */
  headDown: boolean
  /** a call (or anything else using the microphone): the iPhone's sound is on a Bluetooth HFP route */
  callMode: boolean
  /** AirPods samples a second */
  hz: number
}

export interface PassiveState {
  /** today so far, from the minutes kept while Vire was open; null before the first minute */
  today: DaySummary | null
  /** from this person's own earlier days (a stand-in's from a stand-in's) */
  usual: PassiveUsual | null
  /** how many earlier days the usual comes from */
  daysKept: number
  live: PassiveLiveNow
  offer: PassiveOffer | null
  dismiss(): void
  /** what today has outside the usual (or, before a band, above a stated default) */
  drift: Drift[]
  /** stand-in AirPods or a script: kept apart, never a person's usual */
  sim: boolean
  /** earlier days of the same kind with any minutes */
  earlier: number
}

const inApp = () => !!(window as unknown as { webkit?: { messageHandlers?: { vire?: unknown } } }).webkit?.messageHandlers?.vire
const local = (k: string): string | null => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
/** tests shorten the minute; nothing else sets this */
const speed = () => Math.max(1, Math.min(120, Number(local('vire.passive.speed')) || 1))
/** a stand-in for the AirPods (tests point the page at one) or a sped-up minute is never a person's day */
function shellHere(): PassiveShell {
  if (local('vire.passive.speed') || local('vire.ears.url')) return 'sim'
  return inApp() ? 'ios' : 'mac'
}
const OFFER_AT = 'vire.passive.offerAt'
const lastOfferAt = (): number | null => {
  const n = Number(local(OFFER_AT))
  return Number.isFinite(n) && n > 0 ? n : null
}
const NO_LIVE: PassiveLiveNow = { worn: false, walking: false, headDown: false, callMode: false, hz: 0 }
const counted = (m: EarModel2 | null) => ({ nod: !!m?.events.nod?.score.ok, smile: !!m?.events.smile?.score.ok })

export function usePassive(sense: Sense, model: EarModel2 | null, opts: { paused?: boolean } = {}): PassiveState {
  const paused = !!opts.paused
  const [setup] = useState(() => {
    const shell = shellHere()
    return { shell, sim: shell === 'sim', tracker: createPassiveTracker({ shell, minuteMs: Math.round(60_000 / speed()) }) as PassiveTracker }
  })
  const { tracker, sim } = setup
  /** every minute on this device of this kind, and the days the server has */
  const bins = useRef(new Map<string, PassiveBin>())
  const server = useRef<DaySummary[]>([])
  const usualRef = useRef<{ usual: PassiveUsual | null; earlier: number; day: string }>({ usual: null, earlier: 0, day: '' })
  const reader = useRef<EarReader | null>(null)
  const was = useRef(new Set<string>())
  const pausedRef = useRef(paused)
  const callRef = useRef(false)
  const offerRef = useRef<PassiveOffer | null>(null)
  const [view, setView] = useState<Omit<PassiveState, 'dismiss'>>({ today: null, usual: null, daysKept: 0, live: NO_LIVE, offer: null, drift: [], sim, earlier: 0 })

  /** the usual moves only when a minute closes or the days arrive */
  const reusual = useCallback(() => {
    const day = localDay(Date.now())
    const d = daysNow([...bins.current.values()], server.current, day, sim)
    usualRef.current = { usual: d.usual, earlier: d.earlier, day }
  }, [sim])
  const add = useCallback((list: PassiveBin[]) => {
    for (const b of list) {
      if ((b.shell === 'sim') !== sim) continue
      const id = binId(b)
      bins.current.set(id, keepBetter(bins.current.get(id), b))
    }
  }, [sim])

  useEffect(() => {
    pausedRef.current = paused
    tracker.practice(paused)
    if (paused && offerRef.current) {
      offerRef.current = null
      setView((v) => ({ ...v, offer: null }))
    }
  }, [paused, tracker])

  // the person's own model: nods and smiles are counted only when it passed its check on them
  useEffect(() => {
    const c = counted(model)
    tracker.counting(c)
    reader.current = model && (c.nod || c.smile) ? createEarReader(model) : null
    was.current = new Set()
  }, [model, tracker])

  useEffect(() => {
    const offs = [
      sense.on('head', (h) => {
        if (h.source !== 'airpods') return
        const t = performance.timeOrigin + h.t
        tracker.head([t, h.pitch, h.yaw, h.roll, h.ax, h.ay, h.az, h.rx ?? 0, h.ry ?? 0, h.rz ?? 0])
        const r = reader.current
        if (!r) return
        try {
          const n = r.push(h)
          if (!n) return
          for (const e of n.on) if ((e === 'nod' || e === 'smile') && !was.current.has(e)) tracker.event(e, performance.timeOrigin + n.t)
          was.current = new Set(n.on)
        } catch (e) {
          console.error('[passive] the model could not read the AirPods', e)
          reader.current = null
        }
      }),
      sense.on('pulse', (p) => {
        if (p.source === 'airpods' && p.bpm != null) tracker.heart(performance.timeOrigin + p.t, p.bpm)
      }),
    ]
    // call mode: the iPhone's sound goes over a Bluetooth HFP route (the AirPods then send far fewer samples)
    const offNative = onNative((m) => {
      if (m.k !== 'status') return
      const on = /hfp|handsfree|hands-free/i.test(m.route ?? '')
      callRef.current = on
      tracker.call(on)
    })
    return () => {
      offs.forEach((off) => off())
      offNative()
    }
  }, [sense, tracker])

  // what this device kept on earlier visits, and what the server has for its key
  useEffect(() => {
    let live = true
    void listBins().then((list) => {
      if (!live) return
      add(list)
      reusual()
      void sendBins()
    })
    void fetchMine(localDay(Date.now())).then((mine) => {
      if (!live || !mine) return
      server.current = mine.days
      reusual()
    })
    return () => {
      live = false
    }
  }, [add, reusual])

  useEffect(() => {
    const save = (leaving: boolean) => {
      const snap = tracker.snapshot()
      void keepBins(snap ? [snap] : []).then(() => sendBins(leaving))
    }
    const hidden = () => document.visibilityState === 'hidden' && save(true)
    const leave = () => save(true)
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('pagehide', leave)
    const every = Math.max(250, Math.min(1000, tracker.minuteMs / 12))
    const tick = setInterval(() => {
      const now = Date.now()
      const closed = tracker.tick(now)
      const day = localDay(now)
      if (closed.length) {
        add(closed)
        void keepBins(closed).then(() => sendBins())
      }
      if (closed.length || usualRef.current.day !== day) reusual()
      const todays = [...bins.current.values()].filter((b) => b.day === day)
      const snap = tracker.snapshot()
      const withSnap = snap && snap.day === day && !bins.current.has(binId(snap)) ? [...todays, snap] : todays
      const today = daysNow(withSnap, [], day, sim).today
      const { usual, earlier } = usualRef.current
      const l = tracker.live(now)
      const upright = today?.upright ?? null
      const live: PassiveLiveNow = {
        worn: l.worn,
        walking: l.walking,
        headDown: l.worn && l.pitch !== null && !!upright && l.pitch < upright.pitch - DOWN_DEG,
        callMode: callRef.current,
        hz: l.hz,
      }
      if (offerRef.current && (callRef.current || pausedRef.current)) offerRef.current = null
      if (!offerRef.current) {
        const o = offerFor({ now, minuteMs: tracker.minuteMs, bins: todays, usual, upright, lastOfferAt: lastOfferAt(), callMode: callRef.current, practice: pausedRef.current })
        if (o) {
          offerRef.current = o
          try {
            localStorage.setItem(OFFER_AT, String(now))
          } catch {
            /* the page keeps nothing: one offer a visit at most then */
          }
        }
      }
      setView({ today, usual, daysKept: usual?.days ?? 0, live, offer: offerRef.current, drift: driftOf(today, usual), sim, earlier })
    }, every)
    return () => {
      clearInterval(tick)
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('pagehide', leave)
      save(false)
    }
  }, [tracker, add, reusual, sim])

  const dismiss = useCallback(() => {
    offerRef.current = null
    setView((v) => ({ ...v, offer: null }))
  }, [])
  return { ...view, dismiss }
}
