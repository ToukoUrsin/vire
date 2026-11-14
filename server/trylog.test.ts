import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dir = mkdtempSync(join(tmpdir(), 'vire-try-'))
process.env.VIRE_EAR_DIR = dir
const { TRY_MAX_BYTES, checkTryLog, registerTryRoutes } = await import('./trylog')

const row = (t: number) => [t, 1.2, -76.1, 13.9, 0.02, -0.97, 0.24, 0, 0, 0]
const check = { t: 24000, t0: 3500, from: 10, to: 8.5, follows: true, readable: true, still: true, coherence: 0.98, amplitudeDeg: 2.1, moveDegS: 1.1, perMin: 10.06, conf: 0.95, by: 'breath' }
const one = (id: string, over: Record<string, unknown> = {}) => ({
  v: 1,
  id,
  at: '2026-11-15T07:00:00.000Z',
  ua: 'Mozilla/5.0 (iPhone)',
  sampleHz: 60.1,
  rowHz: 50,
  ended: 'time',
  ms: 81000,
  checks: [check],
  result: { from: 10, to: 8.5, checks: 1, followed: 1, byStill: 0, notFollowed: 0, moving: 0 },
  sound: 'tone',
  pieces: [],
  breaths: [[0, 2400, 6000, 10]],
  rows: [row(0), row(20), row(40)],
  gyro: [[0, 0.1, 0.2, 0.3]],
  ...over,
})

const appWith = (allow = true) => {
  const app = new Hono()
  registerTryRoutes(app, { allow: () => allow, asker: () => ({ via: 'public', src: 'abcd1234' }), tooMany: (c: any) => c.json({ error: 'too many' }, 429), isWorker: (c: any) => c.req.header('authorization') === 'Bearer test' })
  return app
}
const post = (app: Hono, body: unknown) => app.request('/api/try', { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) })

test('a try is checked: what was read is kept as it was, anything else is refused', () => {
  const ok = checkTryLog(one('try-aaaaaaaa'))
  expect(ok?.checks[0]).toEqual(check as any)
  expect(ok?.rows.length).toBe(3)
  expect(checkTryLog(one('short'))).toBeNull()
  expect(checkTryLog(one('try-aaaaaaaa', { rows: [[1, 2]] }))).toBeNull()
  expect(checkTryLog(one('try-aaaaaaaa', { checks: [{ ...check, by: 'guess' }] }))).toBeNull()
  expect(checkTryLog(one('try-aaaaaaaa', { sound: 'orchestra' }))).toBeNull()
  expect(checkTryLog(one('try-aaaaaaaa', { ended: 'exploded' }))).toBeNull()
  expect(checkTryLog(one('try-aaaaaaaa', { result: { from: 10, to: 8.5, checks: 1, followed: -1, byStill: 0, notFollowed: 0, moving: 0 } }))).toBeNull()
  expect(checkTryLog(null)).toBeNull()
  // a breath that could not be read is kept as null, not as a number
  expect(checkTryLog(one('try-aaaaaaaa', { checks: [{ ...check, follows: false, readable: false, perMin: null, moveDegS: null, by: 'held' }] }))?.checks[0]?.perMin).toBeNull()
})

test('tries are appended to one try.jsonl, one line each, with their rows', async () => {
  const app = appWith()
  const a = await post(app, one('try-aaaaaaaa'))
  expect(a.status).toBe(200)
  expect(await a.json()).toEqual({ id: 'try-aaaaaaaa', rows: 3, checks: 1 })
  expect((await post(app, one('try-bbbbbbbb', { sound: 'modal', pieces: [{ id: 'breathe-settle-10', t: 900, made: 'set' }] }))).status).toBe(200)
  const file = join(dir, 'try.jsonl')
  expect(existsSync(file)).toBe(true)
  const lines = readFileSync(file, 'utf8').trim().split('\n')
  expect(lines.length).toBe(2)
  const first = JSON.parse(lines[0]!)
  expect(first.id).toBe('try-aaaaaaaa')
  expect(first.rows).toEqual([row(0), row(20), row(40)])
  expect(first.via).toBe('public')
  expect(typeof first.saved).toBe('string')
  // nothing else is written: no file per try, no session, no recording
  expect(readdirSync(dir)).toEqual(['try.jsonl'])
})

test('a body that is not a try, too large, or one too many is refused and nothing is written', async () => {
  const app = appWith()
  const before = readFileSync(join(dir, 'try.jsonl'), 'utf8')
  expect((await post(app, '{nope')).status).toBe(400)
  expect((await post(app, { v: 1 })).status).toBe(400)
  const big = one('try-cccccccc', { ua: 'x'.repeat(TRY_MAX_BYTES + 10) })
  expect((await post(app, big)).status).toBe(413)
  expect((await post(appWith(false), one('try-dddddddd'))).status).toBe(429)
  expect(readFileSync(join(dir, 'try.jsonl'), 'utf8')).toBe(before)
})

test('only a worker can list them: the count and the last ones, without rows', async () => {
  const app = appWith()
  expect((await app.request('/api/try')).status).toBe(401)
  // left mid-way, then finished: two lines, one try
  await post(app, one('try-eeeeeeee', { ended: 'left', rowsLeftOut: true, rows: [] }))
  await post(app, one('try-eeeeeeee'))
  const res = await app.request('/api/try', { headers: { authorization: 'Bearer test' } })
  expect(res.status).toBe(200)
  const got = (await res.json()) as { count: number; lines: number; last: any[] }
  expect(got.count).toBe(3)
  expect(got.lines).toBe(4)
  expect(got.last[0].id).toBe('try-eeeeeeee')
  expect(got.last[0].ended).toBe('time')
  expect(got.last[0].rows).toBe(3)
  expect(got.last[0].checks[0].by).toBe('breath')
  expect(got.last.map((x) => x.id)).toEqual(['try-eeeeeeee', 'try-bbbbbbbb', 'try-aaaaaaaa'])
  expect(JSON.stringify(got)).not.toContain('-76.1')
})
