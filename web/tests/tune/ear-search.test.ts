// The wider search's model on the device: when it replaces the device's own, and that the device reads the
// search's kinds of model (a conv net on the raw motion, boosted trees) the way the search wrote them.
import { describe, expect, test } from 'bun:test'
import type { EarModel2, EarScore } from '@shared/ear'
import { adoptSearch, heldOutScore, simulateTeach } from '../../src/tune/ear'
import { predictDet } from '../../src/tune/ear/check'
import type { EarDet } from '../../src/tune/ear/check'
import { RAW_CH, RAW_HZ, channelsFromRows, rawAt } from '../../src/tune/ear/features'
import { dumpMinutes } from '../../src/tune/ear/sandbox'

const score = (auc: number, ok: boolean): EarScore => ({ auc, chance: 0.6, windows: 100, times: 6, ok, held: 'minute' })
const model = (by: EarModel2['by'], minutes: number, at: string, events: Record<string, [number, boolean]>, tried = 13): EarModel2 => ({
  v: 2, at, by, shell: 'ios', hz: 50, gyro: true, tried, minutes,
  events: Object.fromEntries(Object.entries(events).map(([e, [auc, ok]]) => [e, { score: score(auc, ok), det: { from: by } }])),
})

describe('taking the search\'s model', () => {
  const mine = model('device', 2, '2026-11-14T10:02:00.000Z', { smile: [0.9, true], nod: [0.95, true], shake: [0.7, false] })
  test('row by row: the search where it passed, the device where only it passed', () => {
    const found = model('sandbox', 2, '2026-11-14T10:02:00.000Z', { smile: [0.97, true], nod: [0.7, false], shake: [0.99, true] }, 366)
    const got = adoptSearch(mine, found)!
    expect(got.by).toBe('sandbox')
    expect(got.tried).toBe(366)
    expect((got.events.smile!.det as { from: string }).from).toBe('sandbox')
    expect((got.events.nod!.det as { from: string }).from).toBe('device')
    expect(got.events.nod!.by).toBe('device')
    expect((got.events.shake!.det as { from: string }).from).toBe('sandbox')
    // the one number is about what the search itself checked, not the row the device kept
    expect(heldOutScore(got)).toBeCloseTo((0.97 + 0.99) / 2, 6)
  })
  test('a search on fewer minutes, or older than the minute the device just learned from, is not taken', () => {
    expect(adoptSearch(mine, model('sandbox', 1, '2026-11-14T10:02:00.000Z', { smile: [1, true] }))).toBe(null)
    expect(adoptSearch(mine, model('sandbox', 2, '2026-11-14T10:01:00.000Z', { smile: [1, true] }))).toBe(null)
  })
  test('the same search is taken once', () => {
    const found = model('sandbox', 3, '2026-11-14T10:03:00.000Z', { smile: [0.97, true] }, 366)
    const got = adoptSearch(mine, found)!
    expect(got.minutes).toBe(3)
    expect(adoptSearch(got, found)).toBe(null)
  })
  test('a device with no model yet takes it; a search that found nothing is not taken', () => {
    expect(adoptSearch(null, model('sandbox', 1, 'x', { nod: [0.9, true] }))!.events.nod!.score.ok).toBe(true)
    expect(adoptSearch(mine, model('sandbox', 3, '2026-11-14T10:03:00.000Z', {}))).toBe(null)
  })
})

describe('the motion itself, for the conv net', () => {
  const rec = simulateTeach({ seed: 3, hz: 50 })
  const ch = channelsFromRows(rec.head, rec.device.gyro)
  const ts = rec.head.map((r) => r[0])
  test('a window is an even grid, 50 a second, with the angles against where the window began', () => {
    const end = 2000
    const x = rawAt(ch, ts, end, 2)
    expect(x.length).toBe(2 * RAW_HZ * RAW_CH)
    for (let c = 0; c < 3; c++) {
      let lead = 0
      for (let k = 0; k < 10; k++) lead += x[k * RAW_CH + c]
      expect(Math.abs(lead / 10)).toBeLessThan(1e-9)
    }
    // the last grid sample is the newest row itself (acceleration is not referenced to anything)
    expect(x[(2 * RAW_HZ - 1) * RAW_CH + 3]).toBeCloseTo(ch[end][3], 9)
  })
  test('where the head points does not change it', () => {
    const turned = ch.map((r) => [r[0] + 20, r[1] - 75, r[2] + 9, ...r.slice(3)])
    const a = rawAt(ch, ts, 1500, 1)
    const b = rawAt(turned, ts, 1500, 1)
    for (let i = 0; i < a.length; i++) expect(b[i]).toBeCloseTo(a[i], 9)
  })
  test('the search is handed every window with its minute, its time and what the camera said', () => {
    const { meta, files } = dumpMinutes([rec, simulateTeach({ seed: 5, hz: 50, at: '2026-11-14T10:09:00.000Z' })])
    expect(meta.minutes).toBe(2)
    expect(meta.events.smile?.kind).toBe('minute')
    for (const set of meta.sets) {
      const file = files.find((f) => f.name === set.file)!
      expect(file.data.length).toBe(set.n * set.d)
      expect(set.minute.length).toBe(set.n)
      expect(new Set(set.minute).size).toBe(2)
      expect(set.y.smile!.length).toBe(set.n)
    }
    expect(meta.sets.some((s) => s.kind === 'raw')).toBe(true)
  })
})

describe('the search\'s kinds of model, read on the device', () => {
  test('a conv net: one filter that fires on a rise in pitch', () => {
    // 3 samples of 9 channels; the filter looks at pitch only: later minus earlier
    // weights are laid out as the search writes them: filter, then channel, then time
    const w = new Array(9 * 3).fill(0)
    w[0 * 3 + 0] = -1
    w[0 * 3 + 2] = 1
    const det = { family: 'conv', window: 0.1, subset: 'raw', mean: new Array(9).fill(0), scale: new Array(9).fill(1), layers: [{ k: 3, s: 1, cin: 9, cout: 1, w, b: [0] }], w: [0, 2], b: -1, on: 0.5, off: 0.4 } as unknown as EarDet
    const flat = (pitch: number[]) => pitch.flatMap((p) => [p, 0, 0, 0, 0, 0, 0, 0, 0])
    const sig = (z: number) => 1 / (1 + Math.exp(-z))
    // rising by 1 a sample: every position answers 2, so the largest is 2 and the model says sigmoid(2*2 - 1)
    expect(predictDet(det, flat([0, 1, 2, 3, 4]))).toBeCloseTo(sig(3), 6)
    // falling: the filter stays silent (ReLU), the model says sigmoid(-1)
    expect(predictDet(det, flat([4, 3, 2, 1, 0]))).toBeCloseTo(sig(-1), 6)
  })
  test('boosted trees: each tree is walked from its root', () => {
    const det = {
      family: 'tree', window: 1, subset: 'all', mean: [0, 0], scale: [1, 1], shrinkage: 0.5, b: 0.25,
      trees: [
        { feature: 0, threshold: 0, left: 1, right: 2, value: 0 }, { feature: -1, threshold: 0, left: -1, right: -1, value: -2 }, { feature: -1, threshold: 0, left: -1, right: -1, value: 2 },
        { feature: 1, threshold: 1, left: 4, right: 5, value: 0 }, { feature: -1, threshold: 0, left: -1, right: -1, value: 1 }, { feature: -1, threshold: 0, left: -1, right: -1, value: 3 },
      ],
      treeRoots: [0, 3], on: 0.5, off: 0.4,
    } as unknown as EarDet
    const sig = (z: number) => 1 / (1 + Math.exp(-z))
    expect(predictDet(det, [1, 2])).toBeCloseTo(sig(0.25 + 0.5 * (2 + 3)), 6)
    expect(predictDet(det, [-1, 0])).toBeCloseTo(sig(0.25 + 0.5 * (-2 + 1)), 6)
  })
})
