import { describe, expect, test } from 'bun:test'
import type { EarRecording } from '@shared/ear'
import { trainEarModel } from '../../src/tune/ear'
import { simulateTeach } from '../../src/tune/ear/sim'
import { heardInMinute } from '../../src/tune/usual/heard'

/** the day's minute as the page sends it: the same asks, no camera frames, no sound */
const daily = (rec: EarRecording): EarRecording => ({ ...rec, face: [], voice: [], kind: 'daily' })

describe('what the model heard in a camera-off minute', () => {
  const taught = [1, 2, 3].map((seed) => simulateTeach({ seed, smileSize: 3, at: `2026-01-0${seed}T00:00:00.000Z` }))
  const model = trainEarModel(taught)

  test('counts the asked nods and head shakes it heard, from the AirPods rows alone', () => {
    const got = heardInMinute(model, daily(simulateTeach({ seed: 9, smileSize: 3, at: '2026-01-09T00:00:00.000Z' })))
    const nod = got.find((h) => h.event === 'nod')
    const shake = got.find((h) => h.event === 'shake')
    expect(model.events.nod?.score.ok).toBe(true)
    expect(nod?.asked).toBe(3)
    expect(nod!.heard).toBeGreaterThanOrEqual(2)
    expect(shake?.asked).toBe(3)
    expect(shake!.heard).toBeGreaterThanOrEqual(2)
    // the still moments stay still
    expect(nod!.still).toBeGreaterThan(5)
    expect(nod!.wrong).toBeLessThanOrEqual(1)
    expect(shake!.wrong).toBeLessThanOrEqual(1)
  })

  test('a minute with no movement in it is heard as nothing', () => {
    const still = simulateTeach({ seed: 5, smileSize: 0 })
    const flat = { ...still, head: still.head.map((r) => [r[0], 0, 0, 0, 0, 0, 1, 0, 0, 0]) }
    for (const h of heardInMinute(model, daily(flat))) expect(h.heard).toBe(0)
  })

  test('lists nothing without a model, and nothing the model may not follow on its own', () => {
    const rec = daily(simulateTeach({ seed: 9 }))
    expect(heardInMinute(null, rec)).toEqual([])
    const none = { ...model, events: Object.fromEntries(Object.entries(model.events).map(([e, v]) => [e, { ...v!, score: { ...v!.score, ok: false } }])) }
    expect(heardInMinute(none, rec)).toEqual([])
  })
})
