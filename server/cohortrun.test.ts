import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// cohortrun.ts keeps its runs in the one database the server opens on import, so each test runs in a process of its own
async function run(script: string, env: Record<string, string> = {}): Promise<any> {
  const dir = mkdtempSync(join(tmpdir(), 'vire-cohort-'))
  const proc = Bun.spawn(['bun', '-e', script], { cwd: import.meta.dir, env: { ...process.env, VIRE_DB: join(dir, 'c.sqlite'), VIRE_EAR_DIR: join(dir, 'ear') + '/', ...env }, stdout: 'pipe', stderr: 'pipe' })
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  if ((await proc.exited) !== 0) throw new Error(err)
  return JSON.parse(out)
}

const progress = `
  const prog = (n, over = {}) => ({
    patients: Array.from({ length: n }, (_, i) => ({ n: i + 1, state: i < 2 ? 'done' : 'running', tried: 100 + i, seconds: 12.34, auc: i < 2 ? 0.9 + i / 100 : null })),
    seconds: 14, sandboxes: n - 2, peak: n, where: 'modal', refused: 1, ...over,
  });
`

test('a run goes queued, running, done; the public run has one entry per simulated patient and the totals', async () => {
  const v = await run(`
    import { startCohort, claimCohort, progressCohort, finishCohort, latestCohort } from './cohortrun.ts';
    ${progress}
    const t = 1_000_000;
    const s = startCohort(undefined, t);
    const queued = latestCohort(t);
    const claim = claimCohort(t + 1000);
    const again = claimCohort(t + 1000);
    const mid = progressCohort(claim.id, prog(50), t + 5000);
    const bad = progressCohort(claim.id, prog(49), t + 6000);
    const done = finishCohort(claim.id, prog(50, { sandboxes: 0, seconds: 41.2 }), t + 42000);
    const late = progressCohort(claim.id, prog(50), t + 43000);
    console.log(JSON.stringify({ s, queued, claim, again, mid, bad, done, late }));
  `)
  expect(v.s.run.state).toBe('queued')
  expect(v.s.run.patients).toHaveLength(50)
  expect(v.s.run.simulated).toBe(true)
  expect(v.queued.patients.every((p: any) => p.state === 'waiting' && p.auc === null)).toBe(true)
  expect(v.claim.patients).toBe(50)
  expect(typeof v.claim.seed).toBe('number')
  expect(v.claim.now).toBe(1_000_000)
  expect(v.again).toBeNull()
  expect(v.mid.state).toBe('running')
  expect(v.mid.sandboxes).toBe(48)
  expect(v.mid.peak).toBe(50)
  expect(v.mid.where).toBe('modal')
  expect(v.mid.tried).toBe(Array.from({ length: 50 }, (_, i) => 100 + i).reduce((a, b) => a + b, 0))
  expect(v.mid.patients[0]).toMatchObject({ n: 1, name: 'Aino K.', id: expect.any(String), state: 'done', tried: 100, seconds: 12.3, auc: 0.9 })
  expect(v.bad).toBeNull()
  expect(v.done.state).toBe('done')
  expect(v.done.seconds).toBe(41.2)
  expect(v.done.sandboxes).toBe(0)
  expect(v.done.peak).toBe(50)
  expect(v.done.refused).toBe(1)
  expect(v.done.endedAt).toBe(1_042_000)
  expect(v.late).toBeNull()
  // nothing of a model goes out
  expect(JSON.stringify(v.done)).not.toContain('det')
})

test('the caps: one run at a time, two minutes apart, at most VIRE_COHORT_MAX_RUNS that a worker took, and plain refusals', async () => {
  const v = await run(`
    import { startCohort, claimCohort, finishCohort } from './cohortrun.ts';
    ${progress}
    let t = 1_000_000;
    const out = {};
    out.tooMany = startCohort(61, t);
    out.zero = startCohort(0, t);
    out.first = startCohort(5, t);
    out.busy = startCohort(5, t + 1000);
    const c1 = claimCohort(t + 1000);
    finishCohort(c1.id, prog(5), t + 40_000);
    out.soon = startCohort(5, t + 60_000);
    out.second = startCohort(5, t + 121_000);
    const c2 = claimCohort(t + 121_000);
    finishCohort(c2.id, { error: 'Modal said no' }, t + 130_000);
    out.third = startCohort(5, t + 250_000);
    console.log(JSON.stringify(out));
  `, { VIRE_COHORT_MAX_RUNS: '2' })
  expect(v.tooMany.status).toBe(400)
  expect(v.zero.status).toBe(400)
  expect(v.first.run.patients).toHaveLength(5)
  expect(v.busy.status).toBe(409)
  expect(v.busy.error).toContain('already going')
  expect(v.soon.status).toBe(429)
  expect(v.soon.error).toMatch(/2 minutes.*in 60 seconds/)
  expect(v.second.run.state).toBe('queued')
  expect(v.third.status).toBe(429)
  expect(v.third.error).toContain('all 2 re-training runs')
})

test('a silent worker fails the run after 3 minutes; a run no worker takes fails and does not use up the cap', async () => {
  const v = await run(`
    import { startCohort, claimCohort, progressCohort, latestCohort } from './cohortrun.ts';
    ${progress}
    const t = 1_000_000;
    const a = startCohort(3, t);
    const untaken = latestCohort(t + 181_000);
    const b = startCohort(3, t + 182_000);
    const c = claimCohort(t + 182_000);
    progressCohort(c.id, prog(3), t + 200_000);
    const alive = latestCohort(t + 370_000);
    const silent = latestCohort(t + 381_000);
    const next = startCohort(3, t + 400_000);
    console.log(JSON.stringify({ untaken, b, alive, silent, next }));
  `, { VIRE_COHORT_MAX_RUNS: '2' })
  expect(v.untaken.state).toBe('failed')
  expect(v.untaken.error).toContain('no worker')
  expect(v.b.run.state).toBe('queued')
  expect(v.alive.state).toBe('running')
  expect(v.silent.state).toBe('failed')
  expect(v.silent.error).toContain('silent for 3 minutes')
  expect(v.silent.sandboxes).toBe(0)
  // one run was taken, the cap is two
  expect(v.next.run.state).toBe('queued')
})

test('progress is checked at the boundary', async () => {
  const v = await run(`
    import { checkProgress } from './cohortrun.ts';
    ${progress}
    const ok = (x) => checkProgress(x, 3) !== null;
    const p = prog(3);
    console.log(JSON.stringify({
      good: ok(p),
      wrongN: ok({ ...p, patients: p.patients.map((x, i) => ({ ...x, n: i })) }),
      badState: ok({ ...p, patients: p.patients.map((x) => ({ ...x, state: 'eaten' })) }),
      badAuc: ok({ ...p, patients: p.patients.map((x) => ({ ...x, auc: 1.5 })) }),
      tooManySandboxes: ok({ ...p, sandboxes: 4 }),
      badWhere: ok({ ...p, where: 'moon' }),
      noWhere: ok({ ...p, where: undefined }),
    }));
  `)
  expect(v).toEqual({ good: true, wrongN: false, badState: false, badAuc: false, tooManySandboxes: false, badWhere: false, noWhere: false })
})

test('what works per patient is kept when it adds up, and dropped on its own (the patient stays) when it does not', async () => {
  const v = await run(`
    import { startCohort, claimCohort, progressCohort, finishCohort, checkWorks } from './cohortrun.ts';
    ${progress}
    const good = { best: 'walk', said: 'learned', sure: 0.913, next: 'scan', total: 12, kinds: [{ kind: 'breathe', n: 1, mean: -6 }, { kind: 'scan', n: 4, mean: 14.04 }, { kind: 'walk', n: 7, mean: 21.4 }] };
    const early = { best: 'breathe', said: 'early', sure: 0, next: 'scan', total: 2, kinds: [{ kind: 'breathe', n: 2, mean: 30 }, { kind: 'scan', n: 0, mean: null }, { kind: 'walk', n: 0, mean: null }] };
    const t = 1_000_000;
    startCohort(3, t);
    const c = claimCohort(t + 1000);
    const p = prog(3);
    p.patients[0].works = good;
    p.patients[1].works = { ...good, total: 99 };
    p.patients[2].works = early;
    const mid = progressCohort(c.id, p, t + 5000);
    const done = finishCohort(c.id, p, t + 9000);
    const bad = [
      checkWorks({ ...good, said: 'posterior' }),
      checkWorks({ ...good, best: 'run' }),
      checkWorks({ ...good, sure: 1.2 }),
      checkWorks({ ...good, kinds: good.kinds.slice(0, 2) }),
      checkWorks({ ...good, kinds: [good.kinds[1], good.kinds[0], good.kinds[2]] }),
      checkWorks({ ...early, best: 'walk' }),
      checkWorks('learned'),
    ];
    console.log(JSON.stringify({ mid, done, bad, none: checkWorks({ ...early, best: null }) }));
  `)
  expect(v.mid.patients[0].works).toEqual({ best: 'walk', said: 'learned', sure: 0.91, next: 'scan', total: 12, kinds: [{ kind: 'breathe', n: 1, mean: -6 }, { kind: 'scan', n: 4, mean: 14 }, { kind: 'walk', n: 7, mean: 21.4 }] })
  expect(v.mid.patients[1].works).toBeUndefined()
  expect(v.mid.patients[1].auc).toBe(0.91)
  expect(v.mid.patients[2].works.said).toBe('early')
  expect(v.done.patients[0].works.best).toBe('walk')
  expect(v.bad.every((x: unknown) => x === null)).toBe(true)
  expect(v.none.best).toBeNull()
})
