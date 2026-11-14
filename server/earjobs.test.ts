import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('ear jobs requeue one silent claim, then fail the next', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vire-earjobs-'))
  const db = join(dir, 'jobs.sqlite')
  const ears = join(dir, 'recordings')
  await mkdir(ears)
  const recording = {
    v: 1,
    at: '2026-11-14T00:00:00.000Z',
    userId: null,
    device: { shell: 'sim', gyro: false, hz: 25, ua: 'test' },
    head: [],
    face: [],
    voice: [],
    steps: [],
  }
  await writeFile(join(ears, 'rec.json'), JSON.stringify({ id: 'rec', recording }))
  const script = `
    import { queueEarJob, claimEarJob, expireEarJobs, getEarJob } from './earjobs.ts';
    const j = queueEarJob('rec', 1000);
    await claimEarJob(1000);
    expireEarJobs(181001);
    const afterFirst = getEarJob(j.id);
    await claimEarJob(181002);
    expireEarJobs(362003);
    console.log(JSON.stringify({ afterFirst, final: getEarJob(j.id) }));
  `
  const proc = Bun.spawn(['bun', '-e', script], { cwd: import.meta.dir, env: { ...process.env, VIRE_DB: db, VIRE_EAR_DIR: ears }, stdout: 'pipe', stderr: 'pipe' })
  const output = await new Response(proc.stdout).text()
  expect(await proc.exited).toBe(0)
  const value = JSON.parse(output) as { afterFirst: { state: string }; final: { state: string; error?: string } }
  expect(value.afterFirst.state).toBe('queued')
  expect(value.final.state).toBe('failed')
  expect(value.final.error).toContain('silent')
})

test('a search job carries every minute of the person, and the newest search is public without the model itself', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vire-earjobs-'))
  const db = join(dir, 'jobs.sqlite')
  const ears = join(dir, 'recordings') + '/'
  const script = `
    import { saveEar } from './ear.ts';
    import { queueEarJob, claimEarJob, updateEarProgress, finishEarJob, latestEarJob, landEarJob, getEarJob, noteEarDays } from './earjobs.ts';
    const rec = (at, shell = 'ios') => ({ v: 1, at, userId: null, device: { shell, gyro: true, hz: 50, ua: 't' }, head: [[0, 0, 0, 0, 0, 0, 1, 0, 0, 0]], face: [], voice: [], steps: [{ ask: 'rest', t0: 0, t1: 1000 }] });
    const key = 'a'.repeat(32);
    const one = await saveEar({ recording: rec('2026-11-14T10:00:00.000Z'), key });
    await saveEar({ recording: rec('2026-11-14T10:05:00.000Z', 'mac'), key });
    await saveEar({ recording: rec('2026-11-14T10:07:00.000Z'), key: 'b'.repeat(32) });
    const two = await saveEar({ recording: rec('2026-11-14T10:10:00.000Z'), key });
    const lone = await saveEar({ recording: rec('2026-11-14T10:20:00.000Z') });
    queueEarJob(one.id, 1000);
    const j = queueEarJob(two.id, 2000);
    const l = queueEarJob(lone.id, 1500);
    await noteEarDays(j.id);
    const first = await claimEarJob(Date.now());
    const second = await claimEarJob(Date.now());
    const third = await claimEarJob(Date.now());
    updateEarProgress(j.id, [{ name: 'a', auc: 0.9, ms: 5 }], 3);
    const model = { v: 2, at: 'x', by: 'sandbox', shell: 'ios', hz: 50, gyro: true, tried: 1, minutes: 2, events: { nod: { score: { auc: 0.9, chance: 0.6, windows: 10, times: 3, ok: true }, det: { w: [1, 2, 3] } } } };
    const done = finishEarJob(j.id, model, [{ name: 'a', auc: 0.9, ms: 5 }]);
    const early = landEarJob(l.id);
    const landed = landEarJob(j.id, 777);
    console.log(JSON.stringify({ first: first.minutes.map((m) => m.at), second: third.minutes.map((m) => m.at), secondJob: third.job.minutes, third: second.minutes.length, done: done.state, early, landed: landed.landedAt, own: getEarJob(j.id).model.events.nod.det, latest: latestEarJob() }));
  `
  const proc = Bun.spawn(['bun', '-e', script], { cwd: import.meta.dir, env: { ...process.env, VIRE_DB: db, VIRE_EAR_DIR: ears }, stdout: 'pipe', stderr: 'pipe' })
  const output = await new Response(proc.stdout).text()
  const err = await new Response(proc.stderr).text()
  expect(err.trim()).toBe('')
  expect(await proc.exited).toBe(0)
  const v = JSON.parse(output)
  // the same device's minutes of the same kind, oldest first; another device's and another kind's stay out
  expect(v.first).toEqual(['2026-11-14T10:00:00.000Z', '2026-11-14T10:10:00.000Z'])
  expect(v.second).toEqual(['2026-11-14T10:00:00.000Z', '2026-11-14T10:10:00.000Z'])
  expect(v.secondJob).toBe(2)
  expect(v.third).toBe(1)
  expect(v.done).toBe('done')
  expect(v.early).toBeNull()
  expect(v.landed).toBe(777)
  expect(v.own).toEqual({ w: [1, 2, 3] })
  // the newest search, as the big screen gets it: the scores, never how the model computes
  expect(v.latest.minutes).toBe(2)
  expect(v.latest.landedAt).toBe(777)
  expect(v.latest.model.events.nod.score.auc).toBe(0.9)
  expect(JSON.stringify(v.latest)).not.toContain('"w"')
  // each of the person's minutes as the AirPods alone felt it, oldest first, for "today against the usual"
  expect(v.latest.days.map((d: { at: string }) => d.at)).toEqual(['2026-11-14T10:00:00.000Z', '2026-11-14T10:10:00.000Z'])
  expect(v.latest.days[1].asked).toBe(0)
})

test("a device gets its own newest search with the model, and a search that has not started gives way to a newer minute's", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vire-earjobs-'))
  const script = `
    import { ownerOf } from './ear.ts';
    import { queueEarJob, claimEarJob, getEarJob, latestEarJobOf } from './earjobs.ts';
    const me = ownerOf('a'.repeat(32));
    const other = ownerOf('b'.repeat(32));
    const one = queueEarJob('r1', 1000, me);
    const theirs = queueEarJob('r9', 1500, other);
    const two = queueEarJob('r2', 2000, me);
    console.log(JSON.stringify({ one: getEarJob(one.id), theirs: getEarJob(theirs.id).state, mine: latestEarJobOf(me).id === two.id, other: latestEarJobOf(other).id === theirs.id, nobody: latestEarJobOf(ownerOf('c'.repeat(32))), bad: latestEarJobOf(ownerOf('nope')) }));
  `
  const proc = Bun.spawn(['bun', '-e', script], { cwd: import.meta.dir, env: { ...process.env, VIRE_DB: join(dir, 'jobs.sqlite'), VIRE_EAR_DIR: join(dir, 'recordings') + '/' }, stdout: 'pipe', stderr: 'pipe' })
  const output = await new Response(proc.stdout).text()
  expect((await new Response(proc.stderr).text()).trim()).toBe('')
  expect(await proc.exited).toBe(0)
  const v = JSON.parse(output)
  expect(v.one.state).toBe('failed')
  expect(v.one.error).toContain('newer minute')
  expect(v.theirs).toBe('queued')
  expect(v.mine).toBe(true)
  expect(v.other).toBe(true)
  expect(v.nobody).toBe(null)
  expect(v.bad).toBe(null)
})

test("a camera-off daily minute starts no search, teaches nothing, and is the last day of the person's newest search", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vire-earjobs-'))
  const script = `
    import { saveEar, ownerOf, minutesWith, mineEar } from './ear.ts';
    import { queueEarJob, claimEarJob, noteEarDays, noteDailyMinute, latestEarJob, latestEarJobOf, getEarJob } from './earjobs.ts';
    const rec = (at, kind) => ({ v: 1, at, userId: null, device: { shell: 'ios', gyro: true, hz: 50, ua: 't' }, head: [[0, 0, 0, 0, 0, 0, 1, 0, 0, 0]], face: [], voice: [], steps: [{ ask: 'rest', t0: 0, t1: 1000 }], ...(kind ? { kind } : {}) });
    const key = 'a'.repeat(32);
    const me = ownerOf(key);
    const one = await saveEar({ recording: rec('2026-11-14T10:00:00.000Z'), key });
    const j1 = queueEarJob(one.id, 1000, me);
    await noteEarDays(j1.id);
    const day = await saveEar({ recording: rec('2026-11-14T11:00:00.000Z', 'daily'), key });
    const before = (await mineEar(key)).length;
    const noted = await noteDailyMinute(me, day.id, 5000);
    const afterDaily = getEarJob(j1.id);
    const two = await saveEar({ recording: rec('2026-11-14T12:00:00.000Z'), key });
    const j2 = queueEarJob(two.id, 9000, me);
    await noteEarDays(j2.id);
    const claimed = await claimEarJob(Date.now());
    console.log(JSON.stringify({ daily: day.daily, before, noted: noted === j1.id, days: afterDaily.days.map((d) => d.at), dailyAt: afterDaily.dailyAt, minutesAfterDaily: afterDaily.minutes,
      nobody: await noteDailyMinute(ownerOf('c'.repeat(32)), day.id), teach: (await minutesWith(two.id)).map((m) => m.at), all: (await minutesWith(two.id, true)).map((m) => m.kind ?? 'teach'),
      j2: getEarJob(j2.id).minutes, j2days: getEarJob(j2.id).days.length, claimedId: claimed.job.id, claimedMinutes: claimed.minutes.map((m) => m.kind ?? 'teach') }));
  `
  const proc = Bun.spawn(['bun', '-e', script], { cwd: import.meta.dir, env: { ...process.env, VIRE_DB: join(dir, 'jobs.sqlite'), VIRE_EAR_DIR: join(dir, 'recordings') + '/' }, stdout: 'pipe', stderr: 'pipe' })
  const output = await new Response(proc.stdout).text()
  expect((await new Response(proc.stderr).text()).trim()).toBe('')
  expect(await proc.exited).toBe(0)
  const v = JSON.parse(output)
  expect(v.daily).toBe(true)
  expect(v.before).toBe(2)
  expect(v.noted).toBe(true)
  // the daily minute is the last of the days, and the search still learned from one minute only
  expect(v.days).toEqual(['2026-11-14T10:00:00.000Z', '2026-11-14T11:00:00.000Z'])
  expect(v.dailyAt).toBe(5000)
  expect(v.minutesAfterDaily).toBe(1)
  expect(v.nobody).toBeNull()
  // the next search learns from the two minutes the camera taught; the usual has all three
  expect(v.teach).toEqual(['2026-11-14T10:00:00.000Z', '2026-11-14T12:00:00.000Z'])
  expect(v.all).toEqual(['teach', 'daily', 'teach'])
  expect(v.j2).toBe(2)
  expect(v.j2days).toBe(3)
  expect(v.claimedMinutes.every((k: string) => k === 'teach')).toBe(true)
})

test('the big screen follows what happened last: a daily minute after an older search brings that search back', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vire-earjobs-'))
  const script = `
    import { saveEar, ownerOf } from './ear.ts';
    import { queueEarJob, noteDailyMinute, latestEarJob } from './earjobs.ts';
    const rec = (at, kind) => ({ v: 1, at, userId: null, device: { shell: 'ios', gyro: true, hz: 50, ua: 't' }, head: [[0, 0, 0, 0, 0, 0, 1, 0, 0, 0]], face: [], voice: [], steps: [{ ask: 'rest', t0: 0, t1: 1000 }], ...(kind ? { kind } : {}) });
    const key = 'a'.repeat(32);
    const me = ownerOf(key);
    const one = await saveEar({ recording: rec('2026-11-14T10:00:00.000Z'), key });
    const mine = queueEarJob(one.id, 1000, me);
    const theirs = queueEarJob('other', 2000, ownerOf('b'.repeat(32)));
    const first = latestEarJob().id === theirs.id;
    const day = await saveEar({ recording: rec('2026-11-14T11:00:00.000Z', 'daily'), key });
    await noteDailyMinute(me, day.id, 3000);
    console.log(JSON.stringify({ first, then: latestEarJob().id === mine.id, dailyAt: latestEarJob().dailyAt }));
  `
  const proc = Bun.spawn(['bun', '-e', script], { cwd: import.meta.dir, env: { ...process.env, VIRE_DB: join(dir, 'jobs.sqlite'), VIRE_EAR_DIR: join(dir, 'recordings') + '/' }, stdout: 'pipe', stderr: 'pipe' })
  const output = await new Response(proc.stdout).text()
  expect((await new Response(proc.stderr).text()).trim()).toBe('')
  expect(await proc.exited).toBe(0)
  expect(JSON.parse(output)).toEqual({ first: true, then: true, dailyAt: 3000 })
})
