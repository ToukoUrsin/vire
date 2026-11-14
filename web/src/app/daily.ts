import type { DailyStatus } from '@shared/types'
import { apiUrl } from '../shared/api'

let current: DailyStatus | null = null
let loading: Promise<DailyStatus | null> | null = null

export function getDaily(): DailyStatus | null { return current }
export function dailyUrl(kind: 'laugh' | 'question'): string {
  return apiUrl(`daily/${kind}.mp3`)
}
export async function loadDaily(): Promise<DailyStatus | null> {
  if (loading) return loading
  loading = fetch(apiUrl('daily'), { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() as Promise<DailyStatus> : null))
    .then((v) => {
      if (v && v.date && v.question) {
        current = v
        try { localStorage.setItem('vire.daily', JSON.stringify(v)) } catch { /* private mode */ }
      }
      return v
    })
    .catch(() => {
      try { current = JSON.parse(localStorage.getItem('vire.daily') ?? 'null') as DailyStatus | null } catch { current = null }
      return current
    })
    .finally(() => { loading = null })
  return loading
}

/** Fetch both files once so the service worker can keep them for an offline open. */
export async function prefetchDaily(): Promise<DailyStatus | null> {
  const s = await loadDaily()
  if (!s) return null
  await Promise.allSettled([fetch(dailyUrl('laugh')), fetch(dailyUrl('question'))])
  return s
}
