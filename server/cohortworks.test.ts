// bun test server/cohortworks.test.ts: the clinic's re-training sandbox learns "what works" with sandbox/works.py, a port
// of shared/earlearn.ts. The same histories must give the same answer in both, including all 50 roster people.
import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { learn } from '../shared/earlearn'
import type { Scored } from '../shared/earlearn'
import { generateCohort } from './cohort'
import { workingOf } from './outerloop'

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
test('the sandbox (Python) and the app (TypeScript) learn the same thing from the same practices', async () => {
  const histories = fixed
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
  const practices = [{ kind: 'breathe' as const, settle: 20, at: 'a' }, { kind: 'scan' as const, settle: 2, at: 'b' }]
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

test('all 50 roster histories agree with the clinic list and the Python sandbox learner', async () => {
  const people = generateCohort(Date.parse('2026-11-14T12:00:00Z'))
  const histories = people.map((p) => p.practices.filter((x) => x.done && x.settle != null).map((x) => ({ kind: x.kind, settle: x.settle!, at: x.at })))
  const proc = Bun.spawn([python, join(repo, 'sandbox/works.py'), '--learn'], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
  proc.stdin.write(JSON.stringify({ histories }))
  proc.stdin.end()
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  expect(await proc.exited, err).toBe(0)
  const py = (JSON.parse(out) as { learned: ReturnType<typeof learn>[] }).learned
  expect(py).toHaveLength(50)
  people.forEach((person, i) => {
    const ts = learn(histories[i]!)
    const list = workingOf(person.practices)
    const p = py[i]!
    expect(p.best, person.name).toBe(ts.best)
    expect(p.said, person.name).toBe(ts.said)
    expect(p.next, person.name).toBe(ts.next)
    expect(p.total, person.name).toBe(ts.total)
    expect(p.kinds.map((k) => [k.kind, k.n, k.mean]), person.name).toEqual(ts.kinds.map((k) => [k.kind, k.n, k.mean]))
    expect(list.best, person.name).toBe(ts.best)
    expect(list.said === 'none' ? 'early' : list.said, person.name).toBe(ts.said)
    expect(list.total, person.name).toBe(ts.total)
  })
})
