// The newest Modal search for a person's ear model, polled once a second for the big screen. Everything the
// search board shows comes from GET /api/ear/jobs/latest; nothing is filled in while it is empty.
import { useEffect, useRef, useState } from 'react'
import type { EarJob } from '@shared/ear'
import { api } from '../../shared/api'
import { isMock } from '../data'

/** a finished search stays on the screen this long */
export const SEARCH_SHOW_MS = 3 * 60_000
/** a search that has been waiting or running this long without finishing is taken as stuck and left off the screen */
export const SEARCH_STUCK_MS = 15 * 60_000
const POLL_MS = 1000

export interface SearchSeen {
  job: EarJob
  /** when the search finished: when the phone took the model, when this screen saw it finish, or the latest it can have started */
  endedAt: number | null
}

/** pure: should the big screen show this search now (Date.now() clock) */
export function searchShows(seen: SearchSeen | null, now: number): boolean {
  if (!seen) return false
  const { job } = seen
  if (job.state === 'queued' || job.state === 'running') return job.at == null || now - job.at < SEARCH_STUCK_MS
  const ended = seen.endedAt ?? job.landedAt ?? (job.at != null ? job.at + job.seconds * 1000 : null)
  // a camera-off daily minute of the same person brings the screen back: today against their usual
  const last = Math.max(ended ?? 0, job.dailyAt ?? 0)
  return last > 0 && now - last < SEARCH_SHOW_MS
}

export function useEarSearch(): { seen: SearchSeen | null; shows: boolean } {
  const [seen, setSeen] = useState<SearchSeen | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const last = useRef<SearchSeen | null>(null)

  useEffect(() => {
    if (isMock()) return
    let dead = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      let job: EarJob | null = null
      try {
        job = await api<EarJob>('ear/jobs/latest')
      } catch {
        job = null // 404: no search yet, or the server is away for a moment
      }
      if (dead) return
      const prev = last.current
      let endedAt: number | null = null
      if (job && (job.state === 'done' || job.state === 'failed')) {
        if (prev && prev.job.id === job.id) endedAt = prev.endedAt ?? (prev.job.state === 'done' || prev.job.state === 'failed' ? null : Date.now())
        if (job.landedAt) endedAt = Math.max(endedAt ?? 0, job.landedAt)
      }
      const next = job ? { job, endedAt } : null
      if (JSON.stringify(next) !== JSON.stringify(prev)) {
        last.current = next
        setSeen(next)
      }
      setNow(Date.now())
      timer = setTimeout(tick, POLL_MS)
    }
    void tick()
    return () => {
      dead = true
      clearTimeout(timer)
    }
  }, [])

  return { seen, shows: searchShows(seen, now) }
}
