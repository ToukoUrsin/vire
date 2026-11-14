// bun test server/cohortworks.test.ts: the clinic's re-training sandbox learns "what works" with sandbox/works.py, a port
// of shared/earlearn.ts. The same histories must give the same answer in both, and the simulated histories must be
// seeded, labelled, between 2 and 30 practices, and show a mix of practices and of how sure the learner is.
import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { learn } from '../shared/earlearn'
import type { Scored } from '../shared/earlearn'
import { cohortPractices, PRACTICES_MAX, PRACTICES_MIN } from '../sandbox/cohort_practices'

const repo = join(import.meta.dir, '..')
const python = process.env.VIRE_PYTHON ?? 'python3'

const fixed: Scored[][] = [
  [],
  [{ kind: 'breathe', settle: 40, at: 'a' }],
  [{ kind: 'breathe', settle: 40, at: 'a' }, { kind: 'scan', settle: 5, at: 'b' }, { kind: 'breathe', settle: 35, at: 'c' }],
  [
    { kind: 'breathe', settle: 40, at: '1' }, { kind: 'scan', settle: 2, at: '2' }, { kind: 'walk', settle: -3.5, at: '3' },
    { kind: 'breathe', settle: 31.2, at: '4' }, { kind: 'scan', settle: 8, at: '5' }, { kind: 'walk', settle: 1, at: '6' },
    { kind: 'breathe', settle: 44, at: '7' }, { kind: 'breathe', settle: 38.9, at: '8' }, { kind: 'scan', settle: -1, at: '9' },
  ],
  // a check with too few samples (null) and a kind the learner does not know are left out alike
  [{ kind: 'walk', settle: 12, at: 'x' }, { kind: 'walk', settle: null, at: 'y' }, { kind: 'scan', settle: 0.1, at: 'z' }, { kind: 'run' as never, settle: 50, at: 'w' }],
  // close calls: nothing stands out
  [{ kind: 'breathe', settle: 10, at: '2026-11-01T08:00:00.000Z' }, { kind: 'scan', settle: 11, at: '2026-11-02T08:00:00.000Z' }, { kind: 'walk', settle: 9.5, at: '2026-11-03T08:00:00.000Z' }, { kind: 'scan', settle: 0.05, at: '2026-11-04T08:00:00.000Z' }, { kind: 'breathe', settle: 1e-7, at: '2026-11-05T08:00:00.000Z' }],
]
// and some of the simulated patients themselves, from the short to the long
const simulated = [3, 8, 17, 21, 34, 50].map((n) => cohortPractices(1_763_110_000, n).practices)

test('the sandbox (Python) and the app (TypeScript) learn the same thing from the same practices', async () => {
  const histories = [...fixed, ...simulated]
  const proc = Bun.spawn([python, join(repo, 'sandbox/works.py'), '--learn'], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
  proc.stdin.write(JSON.stringify({ histories }))
  proc.stdin.end()
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  expect(await proc.exited, err).toBe(0)
  const py = (JSON.parse(out) as { learned: ReturnType<typeof learn>[] }).learned
  expect(py).toHaveLength(histories.length)
  histories.forEach((h, i) => {
    const ts = learn(h)
    const p = py[i]!
    const where = `history ${i}`
    expect(p.best, where).toBe(ts.best)
    expect(p.said, where).toBe(ts.said)
    expect(p.next, where).toBe(ts.next)
    expect(p.why, where).toBe(ts.why)
    expect(p.total, where).toBe(ts.total)
    expect(p.kinds.map((k) => [k.kind, k.n, k.mean, k.believed, k.sd]), where).toEqual(ts.kinds.map((k) => [k.kind, k.n, k.mean, k.believed, k.sd]))
    // the same seeded draws in both; a hair of floating point may differ, so `sure` is held to 0.02
    expect(Math.abs(p.sure - ts.sure), where).toBeLessThanOrEqual(0.02)
  })
})

test('a patient file the sandbox gets says what works in a few fields', async () => {
  const practices = cohortPractices(7, 5).practices
  const dir = mkdtempSync(join(tmpdir(), 'vire-works-'))
  const file = join(dir, 'p1.json')
  await Bun.write(file, JSON.stringify({ simulated: true, minutes: [], practices }))
  const proc = Bun.spawn([python, join(repo, 'sandbox/works.py'), file], { stdout: 'pipe', stderr: 'pipe' })
  const out = await new Response(proc.stdout).text()
  expect(await proc.exited).toBe(0)
  const w = JSON.parse(out).works
  const ts = learn(practices)
  expect(w).toEqual({ best: ts.best, said: ts.said, sure: w.sure, next: ts.next, total: ts.total, kinds: ts.kinds.map((k) => ({ kind: k.kind, n: k.n, mean: k.mean })) })
  expect(Math.abs(w.sure - ts.sure)).toBeLessThanOrEqual(0.02)
})

test('simulated histories: seeded, 2 to 30 practices, settle scattered, and a mix of what helps and of how sure', () => {
  expect(cohortPractices(5, 9)).toEqual(cohortPractices(5, 9))
  expect(cohortPractices(5, 9)).not.toEqual(cohortPractices(6, 9))
  const all = Array.from({ length: 50 }, (_, i) => cohortPractices(1_763_110_000, i + 1))
  for (const p of all) {
    expect(p.practices.length).toBeGreaterThanOrEqual(PRACTICES_MIN)
    expect(p.practices.length).toBeLessThanOrEqual(PRACTICES_MAX)
    for (const s of p.practices) expect(['breathe', 'scan', 'walk']).toContain(s.kind)
  }
  const learned = all.map((p) => learn(p.practices))
  const said = new Set(learned.map((l) => l.said))
  expect(said).toEqual(new Set(['learned', 'leaning', 'early']))
  const best = new Set(learned.filter((l) => l.said !== 'early').map((l) => l.best))
  expect(best).toEqual(new Set(['breathe', 'scan', 'walk']))
  // the patients' hidden usuals differ, so the clinic is not one practice for all
  expect(new Set(all.map((p) => (Object.entries(p.truth).sort((a, b) => b[1] - a[1])[0]![0]))).size).toBe(3)
})
