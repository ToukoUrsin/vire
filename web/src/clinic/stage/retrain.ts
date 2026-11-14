// The newest clinic re-training run (every simulated patient at once, one sandbox each), polled once a second for the
// big screen from GET /api/ear/cohort/latest, and the button's POST /api/ear/cohort. Nothing is filled in here.
// (named apart from Cohort.tsx: on a Mac, ./cohort and ./Cohort are the same file)
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CohortRun } from '@shared/cohort'
import { COHORT_DEFAULT } from '@shared/cohort'
import { api, apiUrl } from '../../shared/api'
import { isMock } from '../data'

/** a finished run stays on the screen this long */
export const COHORT_SHOW_MS = 3 * 60_000
/** a run waiting or running this long is taken as stuck and left off the screen (the server fails it sooner) */
const COHORT_STUCK_MS = 15 * 60_000
const POLL_MS = 1000

export interface CohortSeen {
  run: CohortRun
  /** when this screen saw the run end, or the server's word for it */
  endedAt: number | null
}

/** pure: should the big screen show this run now */
export function cohortShows(seen: CohortSeen | null, now: number): boolean {
  if (!seen) return false
  const { run } = seen
  if (run.state === 'queued' || run.state === 'running') return now - run.at < COHORT_STUCK_MS
  const ended = seen.endedAt ?? run.endedAt
  return ended != null && now - ended < COHORT_SHOW_MS
}

export function useCohort(): { seen: CohortSeen | null; shows: boolean; start: () => Promise<string | null> } {
  const [seen, setSeen] = useState<CohortSeen | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const last = useRef<CohortSeen | null>(null)
  const poke = useRef<() => void>(() => {})

  useEffect(() => {
    if (isMock()) return
    let dead = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      clearTimeout(timer)
      let run: CohortRun | null = null
      try {
        run = await api<CohortRun>('ear/cohort/latest')
      } catch {
        run = null // 404: no run yet, or the server is away for a moment
      }
      if (dead) return
      const prev = last.current
      let endedAt: number | null = null
      if (run && (run.state === 'done' || run.state === 'failed')) {
        // seen running here and now over: the screen's own clock; else the server's
        endedAt = prev && prev.run.id === run.id ? (prev.endedAt ?? (prev.run.state === 'done' || prev.run.state === 'failed' ? run.endedAt : Date.now())) : run.endedAt
      }
      const next = run ? { run, endedAt } : null
      if (JSON.stringify(next) !== JSON.stringify(prev)) {
        last.current = next
        setSeen(next)
      }
      setNow(Date.now())
      timer = setTimeout(tick, POLL_MS)
    }
    poke.current = () => void tick()
    void tick()
    return () => {
      dead = true
      clearTimeout(timer)
    }
  }, [])

  /** ask for a run; returns the server's refusal in its own words, or null when it started */
  const start = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch(apiUrl('ear/cohort'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patients: COHORT_DEFAULT }) })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      poke.current()
      return res.ok ? null : body.error || `The server said no (${res.status}).`
    } catch {
      return 'The server cannot be reached right now.'
    }
  }, [])

  return { seen, shows: cohortShows(seen, now), start }
}
