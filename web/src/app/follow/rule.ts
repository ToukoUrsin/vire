import type { EarEvent, EarModel2, EarNow } from '../../../../shared/ear'

/** First honest ear-model answer after a laugh starts. An event already on at the start has no time. */
export function readEarLaugh(samples: { t: number; now: EarNow }[], model: EarModel2 | null, startedAt: number): number | null {
  if (!model) return null
  const good = (e: EarEvent) => model.events[e]?.score.ok === true
  const events = (['laugh', 'smile'] as EarEvent[]).filter(good)
  if (!events.length) return null
  const first = samples.find((s) => s.t >= startedAt && events.some((e) => s.now.on.includes(e)))
  if (!first) return null
  const prior = [...samples].reverse().find((s) => s.t < startedAt)
  if ((prior && events.some((e) => prior.now.on.includes(e))) || first.t - startedAt < 200) return null
  return first.t - startedAt
}
