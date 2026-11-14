// bun test server/earreplay.test.ts: the replay bundle is built from a stored session with the same readers, thinned
// for drawing, carries no device name, says scripted unless the worker said real, and the pick survives on disk.
import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EarSessionRec } from '../shared/earsession'
import { readSession } from '../shared/earsessionread'
import { REPLAY_REAL, REPLAY_SCRIPTED } from '../shared/earreplay'
import type { ReplayBundle } from '../shared/earreplay'

// earsessions.ts reads its folder once, when first imported, and bun runs all test files in one process: these
// tests run in a process of their own, with a folder of their own
if (!process.env.VIRE_REPLAY_CHILD) {
  test('the replay tests, in a process of their own', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vire-replay-')) + '/'
    const r = Bun.spawnSync([process.execPath, 'test', import.meta.path], { env: { ...process.env, VIRE_REPLAY_CHILD: '1', VIRE_EAR_DIR: dir }, cwd: import.meta.dir })
    const said = r.stderr.toString()
    if (r.exitCode !== 0) console.error(said)
    expect(r.exitCode).toBe(0)
    expect(said).toContain(' 4 pass')
  })
}
const child = !!process.env.VIRE_REPLAY_CHILD
const dir = process.env.VIRE_EAR_DIR ?? ''
const { saveSession, latestSession } = child ? await import('./earsessions') : ({} as typeof import('./earsessions'))
const { buildReplay, thin, currentReplay, pickReplay, clearReplay } = child ? await import('./earreplay') : ({} as typeof import('./earreplay'))
const it = child ? test : test.skip

/** a breathing session at 50 a second with heart rate four times a second and a named device */
function session(): EarSessionRec {
  const head: number[][] = []
  for (let t = 0; t < 120_000; t += 20) {
    const amp = t < 30_000 ? 1.2 : t >= 90_000 ? 0.5 : 0.3
    const w = (2 * Math.PI * t) / 1000
    head.push([t, Math.sin(w) * amp, Math.cos(w * 0.7) * amp, 0, 0, 0, 1, Math.cos(w) * amp * 6.3, -Math.sin(w * 0.7) * amp * 4.4, 0])
  }
  const airHr = Array.from({ length: 480 }, (_, i) => [i * 250, i < 120 ? 72 : i >= 360 ? 66 : 69])
  const rest = (o: number) => [
    { ask: 'rest' as const, t0: o, t1: o + 22_000 },
    { ask: 'smile' as const, t0: o + 22_000, t1: o + 25_000 },
    { ask: 'relax' as const, t0: o + 25_000, t1: o + 28_000 },
  ]
  return {
    v: 1,
    at: '2026-11-14T18:00:00.000Z',
    kind: 'breathe',
    device: { shell: 'ios', gyro: true, hz: 50, ua: 'test' },
    head,
    pulse: [],
    airHr,
    heartSamples: [{ t: 1000, bpm: 72, src: 'Anna’s AirPods Pro', model: 'AirPodsPro3,1', n: 1 }],
    phases: [
      { name: 'before', t0: 0, t1: 30_000 },
      { name: 'session', t0: 30_000, t1: 90_000 },
      { name: 'after', t0: 90_000, t1: 118_000 },
    ],
    breaths: Array.from({ length: 6 }, (_, i) => ({ t0: 30_000 + i * 10_000, tMid: 30_000 + i * 10_000 + 4000, t1: 30_000 + (i + 1) * 10_000, perMin: i < 2 ? 8 : 6 })),
    steps: [...rest(0), ...rest(90_000)],
    sound: [
      { id: 'sea-own', t: 1000, made: 'tone' },
      { id: 'abc', t: 31_000, made: 'set' },
    ],
    adapt: [
      { t: 50_000, from: 8, to: 6, follows: true, coherence: 0.6, readable: true, moveDegS: 0.3, by: 'breath' },
      { t: 80_000, from: 6, to: 6, follows: false, coherence: 0.1, readable: false, moveDegS: 0.3, by: 'stillness' },
    ],
  }
}

it('the bundle carries the same numbers readSession gives, thinned for drawing and without a name', () => {
  const s = session()
  const b = buildReplay({ id: '20261114180000-abc', session: s }, { real: false, scripted: true })
  const r = readSession(s)
  expect(b.read.settle).toBe(r.settle)
  expect(b.read.heartChange).toBe(r.heartChange)
  expect(b.read.paceFirst).toBe(8)
  expect(b.read.paceLast).toBe(6)
  expect(b.seen.read).toEqual(b.read)
  expect(b.seen.practices).toBe(1)
  expect(b.seen.pieces).toEqual({ set: 1, live: 0 })
  expect(b.checks).toEqual([
    { t: 50_000, from: 8, to: 6, follows: true, by: 'breath' },
    { t: 80_000, from: 6, to: 6, follows: false, by: 'stillness' },
  ])
  // heart rows: four a second in, at most ten a second out (here all four)
  expect(b.heart.from).toBe('airpods')
  expect(b.heart.rows.length).toBe(480)
  // head movement twice a second, from the check before to the end of the check after
  expect(b.move.length).toBeGreaterThan(200)
  expect(b.move.length).toBeLessThanOrEqual(237)
  const early = b.move.filter((m) => m[0] > 5000 && m[0] < 25_000).map((m) => m[1])
  const late = b.move.filter((m) => m[0] > 95_000 && m[0] < 110_000).map((m) => m[1])
  expect(Math.min(...early)).toBeGreaterThan(Math.max(...late))
  expect(JSON.stringify(b)).not.toContain('Anna')
  expect(JSON.stringify(b)).not.toContain('AirPodsPro3')
  expect('head' in b).toBe(false)
  // the scripted run says so, and lands on the clinic's screen as a demo
  expect(b.real).toBe(false)
  expect(b.label).toBe(REPLAY_SCRIPTED)
  expect(b.seen.shell).toBe('sim')
  expect(b.read.heartSources).toEqual(['a stand-in'])
})

it('thin keeps at most n rows a second', () => {
  const rows = Array.from({ length: 1000 }, (_, i) => [i * 10, i])
  expect(thin(rows, 10).length).toBe(100)
  expect(thin(rows, 10)[1][0]).toBe(100)
})

it('the worker picks a stored session; real only when said; the pick is a file that is not a session; delete clears it', async () => {
  const kept = await saveSession({ key: 'k'.repeat(32), session: session() })
  expect(kept).not.toBeNull()
  const latestBefore = await latestSession()
  expect(await pickReplay({ id: 'nope' })).toBeNull()
  const plain = (await pickReplay({ id: kept!.id }))!
  expect(plain.real).toBe(false)
  expect(plain.scripted).toBe(false)
  expect(plain.label).not.toBe(REPLAY_REAL)
  expect(plain.seen.shell).toBe('ios')
  expect(plain.read.heartSources).toEqual(['AirPods'])
  const real = (await pickReplay({ id: kept!.id, real: true }))!
  expect(real.real).toBe(true)
  expect(real.label).toBe(REPLAY_REAL)
  expect(JSON.stringify(real)).not.toContain('Anna')
  const now = (await currentReplay())!
  expect(now.id).toBe(kept!.id)
  expect(now.real).toBe(true)
  // the pick does not look like a session to anything that lists them
  const names = readdirSync(join(dir, 'sessions'))
  expect(names.filter((n) => n.endsWith('.json'))).toEqual([`${kept!.id}.json`])
  expect(existsSync(join(dir, 'sessions', 'replay.pick'))).toBe(true)
  expect((await latestSession())?.id).toBe(latestBefore?.id)
  await clearReplay()
  const back = await currentReplay()
  expect(back?.id).not.toBe(kept!.id)
})

it('the committed scripted run is small, labelled scripted, and carries no device name', () => {
  const f = join(import.meta.dir, 'replay-scripted.json')
  expect(statSync(f).size).toBeLessThan(150_000)
  const b = JSON.parse(readFileSync(f, 'utf8')) as ReplayBundle
  expect(b.real).toBe(false)
  expect(b.scripted).toBe(true)
  expect(b.label).toBe(REPLAY_SCRIPTED)
  expect(b.seen.shell).toBe('sim')
  expect(b.breaths.length).toBeGreaterThan(5)
  expect(b.checks.length).toBeGreaterThan(0)
  expect(new Set(b.breaths.map((x) => x.perMin)).size).toBeGreaterThan(1)
  const text = JSON.stringify(b)
  expect(/Anna|Mozilla|"ua"|"route"|"device"/.test(text)).toBe(false)
})
