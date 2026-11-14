// bun test server/earsessions.test.ts: a session is kept, read from the AirPods alone, and the learner counts honestly.
import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EarSessionRec, SessionKind } from '../shared/earsession'
import { learn } from '../shared/earlearn'
import { readSession } from '../shared/earsessionread'

const dir = mkdtempSync(join(tmpdir(), 'vire-ses-')) + '/'
process.env.VIRE_EAR_DIR = dir
const { saveSession, mineSessions, checkEarSession, listSessions, readSessionFile, plainSource, latestSession } = await import('./earsessions')

/** a session where the head wobbles `before` degrees in the first check and `after` in the last */
function session(kind: SessionKind, at: string, before: number, after: number, opts: { hr?: boolean; src?: string } = {}): EarSessionRec {
  const head: number[][] = []
  const CHECK = 30_000
  const MID = 60_000
  const steps = (o: number) => [
    { ask: 'rest' as const, t0: o, t1: o + 18_000 },
    { ask: 'smile' as const, t0: o + 18_000, t1: o + 21_000 },
    { ask: 'relax' as const, t0: o + 21_000, t1: o + 24_000 },
    { ask: 'smile' as const, t0: o + 24_000, t1: o + 27_000 },
    { ask: 'relax' as const, t0: o + 27_000, t1: o + 30_000 },
  ]
  const all = [...steps(0), ...steps(CHECK + MID)]
  for (let t = 0; t < CHECK * 2 + MID; t += 20) {
    const amp = t < CHECK ? before : t >= CHECK + MID ? after : 0.2
    const smiling = all.some((s) => s.ask === 'smile' && t >= s.t0 + 400 && t < s.t1)
    const w = (2 * Math.PI * t) / 1000
    head.push([t, Math.sin(w) * amp + (smiling ? 2.5 : 0), Math.cos(w * 0.7) * amp, smiling ? 1.2 : 0, 0, 0, 1, Math.cos(w) * amp * 6.3, -Math.sin(w * 0.7) * amp * 4.4, 0])
  }
  const airHr = opts.hr ? Array.from({ length: 24 }, (_, i) => [i * 5000, i < 6 ? 72 : i >= 18 ? 66 : 69]) : []
  return {
    v: 1, at, kind,
    device: { shell: 'ios', gyro: true, hz: 50, ua: 'test' },
    head, pulse: [], airHr,
    ...(opts.src ? { heartSamples: [{ t: 1000, bpm: 72, src: opts.src, model: 'AirPodsPro3,1', n: 1 }] } : {}),
    phases: [{ name: 'before', t0: 0, t1: CHECK }, { name: 'session', t0: CHECK, t1: CHECK + MID }, { name: 'after', t0: CHECK + MID, t1: CHECK * 2 + MID }],
    breaths: Array.from({ length: 6 }, (_, i) => ({ t0: CHECK + i * 10_000, tMid: CHECK + i * 10_000 + 4000, t1: CHECK + (i + 1) * 10_000, perMin: i < 2 ? 8 : 6 })),
    steps: all,
    sound: [{ id: 'tone', t: CHECK, made: 'tone' }],
  }
}
const A = 'a'.repeat(32)
const B = 'b'.repeat(32)

test('what a session changed is read from the two checks: head movement, smile size, heart rate', () => {
  const r = readSession(session('breathe', '2026-11-14T18:00:00.000Z', 1.2, 0.6, { hr: true }))
  expect(r.before.moveDegS).toBeGreaterThan(r.after.moveDegS!)
  expect(r.settle).toBeGreaterThan(30)
  expect(r.settle).toBeLessThan(70)
  expect(r.before.asked).toBe(2)
  expect(r.heartFrom).toBe('airpods')
  expect(r.before.heartBpm).toBe(72)
  expect(r.after.heartBpm).toBe(66)
  expect(r.heartChange).toBe(-6)
  expect(r.paceFirst).toBe(8)
  expect(r.paceLast).toBe(6)
  expect(r.hz).toBeCloseTo(50, 0)
})

test('with no heart samples nothing is said about the heart', () => {
  const r = readSession(session('scan', '2026-11-14T18:10:00.000Z', 1, 1))
  expect(r.heartFrom).toBeNull()
  expect(r.before.heartBpm).toBeNull()
  expect(r.heartChange).toBeNull()
})

test('a session is kept under the device key, read back only by it, and the name of the AirPods never comes back', async () => {
  const kept = await saveSession({ key: A, session: session('breathe', '2026-11-14T18:00:00.000Z', 1.2, 0.6, { hr: true, src: 'Anna’s AirPods Pro' }) })
  expect(kept).not.toBeNull()
  expect(kept!.sessions.length).toBe(1)
  expect(kept!.sessions[0].heartSources).toEqual(['AirPods'])
  expect(JSON.stringify(kept)).not.toContain('Anna')
  const file = readFileSync(join(dir, 'sessions', `${kept!.id}.json`), 'utf8')
  expect(file).not.toContain(A)
  expect(file).toContain('Anna’s AirPods Pro')
  expect((await mineSessions(B))!.sessions.length).toBe(0)
  expect(await mineSessions('nope')).toBeNull()
  expect((await mineSessions(A))!.sessions[0].id).toBe(kept!.id)
  expect((await listSessions()).map((s) => s.id)).toContain(kept!.id)
  expect(await readSessionFile(kept!.id)).toContain('"session"')
  expect(await readSessionFile('../x')).toBeNull()
  expect(plainSource('Apple Watch')).toBe('Apple Watch')
})

test('what is not a session is refused', () => {
  expect(checkEarSession(null)).toBeNull()
  expect(checkEarSession({ v: 1, kind: 'nap' })).toBeNull()
  const bad = session('breathe', 'x', 1, 1)
  bad.head[3] = [1, 2, 3]
  expect(checkEarSession(bad)).toBeNull()
})

test('the learner says nothing early, tries every kind once, and names a kind only with the counts to back it', () => {
  expect(learn([]).said).toBe('early')
  expect(learn([]).next).toBe('breathe')
  const one = learn([{ kind: 'breathe', settle: 40, at: 'a' }])
  expect(one.said).toBe('early')
  expect(one.next).toBe('scan')
  expect(one.why).toBe('not tried yet')
  const few = learn([{ kind: 'breathe', settle: 40, at: 'a' }, { kind: 'scan', settle: 5, at: 'b' }, { kind: 'breathe', settle: 35, at: 'c' }])
  expect(few.said).toBe('leaning')
  expect(few.best).toBe('breathe')
  expect(few.next).toBe('walk')
  const many = learn([
    ...[42, 38, 45, 40, 36].map((settle, i) => ({ kind: 'breathe' as const, settle, at: `b${i}` })),
    ...[4, -3, 6, 1].map((settle, i) => ({ kind: 'scan' as const, settle, at: `s${i}` })),
    ...[10, 2].map((settle, i) => ({ kind: 'walk' as const, settle, at: `w${i}` })),
  ])
  expect(many.said).toBe('learned')
  expect(many.best).toBe('breathe')
  expect(many.sure).toBeGreaterThan(0.8)
  expect(many.kinds.find((k) => k.kind === 'breathe')!.n).toBe(5)
  expect(many.total).toBe(11)
  // a session whose check could not be read is not counted
  expect(learn([{ kind: 'breathe', settle: null, at: 'a' }]).total).toBe(0)
  // the same sessions give the same answer twice
  expect(learn(many.kinds.flatMap(() => [])).next).toBe(learn([]).next)
})

test('sessions of one device add up in its learner', async () => {
  await saveSession({ key: A, session: session('scan', '2026-11-14T18:20:00.000Z', 1.0, 0.95) })
  const got = await saveSession({ key: A, session: session('breathe', '2026-11-14T18:40:00.000Z', 1.1, 0.5) })
  expect(got!.sessions.length).toBe(3)
  expect(got!.learned.total).toBe(3)
  expect(got!.learned.best).toBe('breathe')
  expect(got!.learned.said).toBe('leaning')
})

test('the newest practice is what the big screen may see: no rows, no names', async () => {
  const key = 'k'.repeat(40)
  const got = await saveSession({ key, session: session('breathe', '2026-11-14T09:00:00.000Z', 2, 1, { hr: true, src: 'Anna’s AirPods Pro' }) })
  const latest = await latestSession()
  expect(latest!.id).toBe(got!.id)
  expect(latest!.shell).toBe('ios')
  expect(latest!.read.heartSources).toEqual(['AirPods'])
  expect(latest!.learned.total).toBeGreaterThan(0)
  expect(latest!.practices).toBe(got!.sessions.length)
  const said = JSON.stringify(latest)
  expect(said.includes('Anna')).toBe(false)
  expect(said.includes('"head"')).toBe(false)
  expect(said.includes(key)).toBe(false)
  expect(Math.abs(Date.now() - latest!.arrivedAt)).toBeLessThan(5000)
})
