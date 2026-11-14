import { describe, expect, test } from 'bun:test'
import type { EarModel2, EarNow } from '../../../shared/ear'
import { readEarLaugh } from '../../src/app/follow/rule'

const model = (ok = true): EarModel2 => ({
  v: 2, at: new Date(0).toISOString(), by: 'device', shell: 'sim', hz: 25, gyro: true, tried: 1,
  events: {
    smile: { score: { auc: 0.9, chance: 0.5, windows: 10, times: 4, ok }, det: {} },
    laugh: { score: { auc: 0.9, chance: 0.5, windows: 10, times: 4, ok }, det: {} },
  },
})
const now = (t: number, on: EarNow['on']): { t: number; now: EarNow } => ({ t, now: { t, p: {}, on } })

describe('AirPods laugh answer', () => {
  test('first on after the grace is timed', () => {
    expect(readEarLaugh([now(1000, []), now(2100, ['laugh'])], model(), 1000)).toBe(1100)
  })
  test('already on has no time', () => {
    expect(readEarLaugh([now(1000, ['smile']), now(1100, ['smile'])], model(), 1000)).toBeNull()
  })
  test('never on is not read', () => {
    expect(readEarLaugh([now(1000, []), now(2200, [])], model(), 1000)).toBeNull()
  })
  test('an event that did not check out is not read', () => {
    expect(readEarLaugh([now(1000, []), now(2200, ['laugh'])], model(false), 1000)).toBeNull()
  })
})
