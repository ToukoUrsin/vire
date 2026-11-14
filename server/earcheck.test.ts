// bun test server/earcheck.test.ts: the real-check bundle is kept only when it has the right shape, survives on disk,
// and the page's own counter reads it as the offline score does.
import { expect, test } from 'bun:test'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { heardBy, isCheckBundle } from '../shared/earcheck'
import type { CheckBundle } from '../shared/earcheck'

const dir = mkdtempSync(join(tmpdir(), 'vire-check-')) + '/'
process.env.VIRE_EAR_DIR = dir
const { clearCheck, currentCheck, keepCheck } = await import('./earcheck')

/** a 20 s check: rest, a nod asked and heard, rest, a head shake asked and not heard */
function bundle(): CheckBundle {
  const head: [number, number, number][] = []
  const read: [number, number, number, number, number][] = []
  for (let t = 0; t < 20_000; t += 40) head.push([t, t >= 5000 && t < 8000 ? Math.sin(t / 100) * 12 : 0.2, 0.1])
  for (let t = 0; t < 20_000; t += 80) read.push([t, t >= 5600 && t < 8200 ? 0.9 : 0.05, 0.1, t >= 5600 && t < 8200 ? 1 : 0, 0])
  return {
    v: 1,
    recordedAt: '2026-11-14T22:12:47.797Z',
    taughtAt: '2026-11-14T18:11:02.142Z',
    shell: 'mac',
    taughtShell: 'ios',
    hz: 50,
    ms: 20_000,
    steps: [
      { t0: 0, t1: 5000, ask: 'rest' },
      { t0: 5000, t1: 8000, ask: 'nod' },
      { t0: 8000, t1: 12_000, ask: 'rest' },
      { t0: 12_000, t1: 15_000, ask: 'shake' },
      { t0: 15_000, t1: 20_000, ask: 'rest' },
    ],
    head,
    read,
    score: { nod: { asked: 1, heard: 1, unasked: 0, auc: 0.99 }, shake: { asked: 1, heard: 0, unasked: 0, auc: 0.5 } },
    model: { minutes: 3, tried: 366, held: { nod: 0.97, shake: 0.97, smile: 0.64 } },
  }
}

test('only a bundle of the right shape is kept, and it survives on disk', async () => {
  expect(await currentCheck()).toBeNull()
  expect(await keepCheck(null)).toBeNull()
  expect(await keepCheck({ ...bundle(), v: 2 })).toBeNull()
  expect(await keepCheck({ ...bundle(), head: [[0, 'x', 0]] })).toBeNull()
  expect(await keepCheck({ ...bundle(), steps: [{ t0: 0, t1: 5, ask: 'dance' }] })).toBeNull()
  expect(await currentCheck()).toBeNull()
  const b = bundle()
  expect(isCheckBundle(b)).toBe(true)
  expect(await keepCheck(b)).toEqual(b)
  expect(await currentCheck()).toEqual(b)
  // not a `.json` file: the sessions folder's `.json` files are sessions, and the newest is the clinic's practice
  expect(readdirSync(join(dir, 'sessions')).filter((f) => f.endsWith('.json'))).toEqual([])
  await clearCheck()
  expect(await currentCheck()).toBeNull()
})

test('the page counts up to the stored score, and never ahead of the playhead', () => {
  const b = bundle()
  expect(heardBy(b, 'nod', 4000)).toEqual({ asked: 0, heard: 0 })
  expect(heardBy(b, 'nod', 5200)).toEqual({ asked: 1, heard: 0 }) // asked, not yet heard
  expect(heardBy(b, 'nod', 6000)).toEqual({ asked: 1, heard: 1 })
  expect(heardBy(b, 'nod', b.ms)).toEqual({ asked: b.score.nod.asked, heard: b.score.nod.heard })
  expect(heardBy(b, 'shake', b.ms)).toEqual({ asked: b.score.shake.asked, heard: b.score.shake.heard })
})
