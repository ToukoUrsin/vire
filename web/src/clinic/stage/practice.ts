// The newest practice a person did in their AirPods, for the big screen: polled from GET /api/ear/sessions/latest.
// What it did and what has been learned, never the rows. Nothing is filled in while there is none.
import { useEffect, useRef, useState } from 'react'
import type { Learned } from '@shared/earlearn'
import type { SessionRead } from '@shared/earsessionread'
import { api } from '../../shared/api'
import { isMock } from '../data'

export interface PracticeSeen {
  id: string
  /** when it arrived at the server, ms */
  arrivedAt: number
  shell: 'mac' | 'ios' | 'sim'
  read: SessionRead & { id: string }
  learned: Learned
  practices: number
  pieces: { set: number; live: number }
}

/** a practice stays on the screen this long after it arrived */
export const PRACTICE_SHOW_MS = 4 * 60_000
const POLL_MS = 2000

/** pure: should the big screen show this practice now (Date.now() clock) */
export const practiceShows = (seen: PracticeSeen | null, now: number): boolean => !!seen && now - seen.arrivedAt < PRACTICE_SHOW_MS

export function usePractice(): { seen: PracticeSeen | null; shows: boolean } {
  const [seen, setSeen] = useState<PracticeSeen | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const last = useRef<string | null>(null)

  useEffect(() => {
    if (isMock()) return
    let dead = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      let got: PracticeSeen | null = null
      try {
        got = await api<PracticeSeen>('ear/sessions/latest')
      } catch {
        got = null // 404: no practice yet, or the server is away for a moment
      }
      if (dead) return
      if (got && got.id !== last.current) {
        last.current = got.id
        setSeen(got)
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

  return { seen, shows: practiceShows(seen, now) }
}
