import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Channel, Echo, PatientRow, WallState } from '../shared/types'
import { CHANNELS } from './engine'
import { HARD_MAX, MIN_GAP_H, WALL_T0, absurd, buildWall, cleanNick, demoWall, deviceFamily, isTestUa, percentile, quantile, simulateHall, stat } from './wall'
import type { WallPing, WallUser } from './wall'

// the API tests make a few hundred requests to a spawned instance: on a busy machine that outlasts bun's 5 s default
setDefaultTimeout(60_000)

const HOUR = 3600_000
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1'
const PIXEL = 'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36'
const HEADLESS = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/142.0.0.0 Safari/537.36'

const user = (id: string, label = `guest ${id}`): WallUser => ({ id, label, key: `k${id}` })
const vals = (smile: number | null, voice: number | null = 2, heart: number | null = 9, move: number | null = 60): Record<Channel, number | null> => ({ smile, voice, heart, move })
const ping = (userId: string, h: number, values: Record<Channel, number | null>, o: Partial<WallPing> = {}): WallPing => ({
  userId,
  t: WALL_T0 + h * HOUR,
  values,
  family: 'ios',
  counted: true,
  ...o,
})
const wall = (pings: WallPing[], o: { now?: number; me?: string; started?: number } = {}) =>
  buildWall({ users: [...new Set(pings.map((p) => p.userId))].map((id) => user(id)), pings, started: o.started ?? 0, now: o.now ?? WALL_T0 + 30 * HOUR, me: o.me })
const chan = (w: WallState, ch: Channel) => w.channels.find((c) => c.channel === ch)!

describe('wall: statistics', () => {
  test('quantiles interpolate; a stat of nothing is null, not zero', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5)
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2)
    expect(stat([])).toEqual({ n: 0, median: null, q1: null, q3: null })
    expect(stat([3, 1, 2])).toEqual({ n: 3, median: 2, q1: 1.5, q3: 2.5 })
  })

  test('a percentile needs three other people', () => {
    expect(percentile(2, [1, 3])).toBeNull()
    expect(percentile(null, [1, 2, 3])).toBeNull()
    expect(percentile(2.5, [1, 2, 3, 4])).toBe(50)
    expect(percentile(2, [1, 2, 3, 4])).toBe(38) // a tie counts half
    expect(percentile(9, [1, 2, 3])).toBe(100)
  })
})

describe('wall: the empty hall and the first three', () => {
  test('nobody yet: counts are zero and nothing is invented', () => {
    const w = wall([], { now: WALL_T0 + 5.94 * HOUR })
    expect(w).toMatchObject({ visitors: 0, pings: 0, returning: 0, started: 0, simulated: false, hoursIn: 5.9, me: null, latest: [], devices: [] })
    expect(w.since).toBe('2026-11-13T16:00:00.000Z') // Friday 18:00 in Helsinki
    expect(w.until).toBe('2026-11-15T12:00:00.000Z')
    expect(w.channels.map((c) => c.channel)).toEqual(CHANNELS)
    for (const c of w.channels) {
      expect(c).toMatchObject({ readRate: null, quantiles: [], hist: null, hours: [] })
      expect(c.now.n).toBe(0)
      expect(c.domain[0]).toBe(0)
    }
    expect(w.readRates).toEqual({ smile: null, voice: null, heart: null, move: null })
  })

  test('two visitors: dots, but no distribution and no percentile', () => {
    const w = wall([ping('a', 1, vals(1.2)), ping('b', 2, vals(1.8))])
    expect(w).toMatchObject({ visitors: 2, pings: 2 })
    expect(chan(w, 'smile').quantiles).toEqual([])
    expect(chan(w, 'smile').hist).toBeNull()
    expect(w.latest.map((d) => d.pct.smile)).toEqual([null, null])
    expect(w.points.h).toEqual([1, 2])
    expect(w.points.who).toEqual([1, 2])
  })

  test('hour buckets carry their n, so a bucket of one is never drawn as a reading', () => {
    const w = wall([ping('a', 1.1, vals(1)), ping('b', 1.5, vals(2)), ping('c', 1.9, vals(3, null)), ping('d', 4.2, vals(1.4))])
    expect(chan(w, 'smile').hours).toEqual([
      { h: 1, n: 3, median: 2, q1: 1.5, q3: 2.5 },
      { h: 4, n: 1, median: 1.4, q1: 1.4, q3: 1.4 },
    ])
    expect(chan(w, 'voice').hours[0]).toMatchObject({ h: 1, n: 2 }) // one phone could not hear the voice
    expect(chan(w, 'voice').readRate).toBe(0.75)
    expect(w.readRates.voice).toBe(0.75)
  })
})

describe('wall: where a visitor sits and how they moved', () => {
  const pings = [
    ping('a', 1, vals(1.0)),
    ping('b', 2, vals(2.0)),
    ping('c', 3, vals(3.0)),
    ping('d', 4, vals(4.0, 3, null)),
    ping('a', 2, vals(0.9)), // an hour later: not a return yet
    ping('b', 9, vals(1.5, 1.5, 8)), // seven hours later
    ping('d', 20, vals(2.0, 2, 7)), // heart was unreadable the first time
  ]

  test('returning = two pings at least three hours apart; change is latest minus first', () => {
    const w = wall(pings)
    expect(MIN_GAP_H).toBe(3)
    expect(w).toMatchObject({ visitors: 4, pings: 7, returning: 2, minGapH: 3 })
    expect(chan(w, 'smile').change).toEqual({ n: 2, median: -1.25, q1: -1.62, q3: -0.87, up: 0, down: 2 })
    expect(chan(w, 'heart').change).toMatchObject({ n: 1, median: -1, down: 1 }) // only b had a heart reading both times
    expect(w.latest[0]).toMatchObject({ key: 'kd', label: 'guest d', nth: 2, returning: true, h: 20 })
    expect(w.latest.find((d) => d.key === 'ka' && d.nth === 2)!.returning).toBe(false)
  })

  test('the hall "now" is each person once, at their latest readable value', () => {
    const w = wall(pings)
    expect(chan(w, 'smile').now).toMatchObject({ n: 4, median: 1.75 }) // 0.9, 1.5, 3, 2
    expect(chan(w, 'heart').now.n).toBe(4)
    expect(chan(w, 'smile').quantiles).toHaveLength(21)
    expect(chan(w, 'smile').quantiles[0]).toBe(0.9)
    expect(chan(w, 'smile').quantiles[20]).toBe(3)
    expect(chan(w, 'smile').hist!.counts.reduce((x, y) => x + y)).toBe(4)
  })

  test('me: percentile among the others, first and latest, and the change between them', () => {
    const me = wall(pings, { me: 'b' }).me!
    expect(me).toMatchObject({ key: 'kb', label: 'guest b', pings: 2, counted: true, hoursBetween: 7, nth: 2, returning: true })
    expect(me.pct.smile).toBe(33) // 1.5 is above one of the three others (0.9, 3, 2)
    expect(me.first!.values.smile).toBe(2)
    expect(me.change).toEqual({ smile: -0.5, voice: -0.5, heart: -1, move: 0 })
    expect(me.trail.map((p) => p.h)).toEqual([2, 9])
    expect(wall(pings, { me: 'nobody' }).me).toBeNull()
    const once = wall(pings, { me: 'c' }).me!
    expect(once).toMatchObject({ pings: 1, first: null, change: null, hoursBetween: null, returning: false })
  })

  test('test traffic is kept out of the hall but still gets its own page', () => {
    const w = wall([...pings, ping('t', 5, vals(3.5), { counted: false })], { me: 't' })
    expect(w).toMatchObject({ visitors: 4, pings: 7 })
    expect(w.points.h).toHaveLength(7)
    expect(w.latest.some((d) => d.key === 'kt')).toBe(false)
    expect(w.me).toMatchObject({ key: 'kt', counted: false, pings: 1 })
    expect(w.me!.pct.smile).toBe(100)
  })

  test('pings from before Friday 18:00 are not part of the weekend', () => {
    expect(wall([ping('a', -2, vals(1)), ping('b', 1, vals(2))])).toMatchObject({ visitors: 1, pings: 1 })
  })

  test('read rates split by device family', () => {
    const w = wall([
      ping('a', 1, vals(1, 2, null), { family: 'android' }),
      ping('b', 2, vals(2, 2, 9), { family: 'android' }),
      ping('c', 3, vals(3), { family: 'ios' }),
      ping('c', 8, vals(null), { family: 'ios' }),
    ])
    expect(w.readRates).toEqual({ smile: 0.75, voice: 1, heart: 0.75, move: 1 })
    expect(w.devices).toEqual([
      { family: 'ios', label: 'iOS Safari', visitors: 1, pings: 2, readRates: { smile: 0.5, voice: 1, heart: 1, move: 1 } },
      { family: 'android', label: 'Android Chrome', visitors: 2, pings: 2, readRates: { smile: 1, voice: 1, heart: 0.5, move: 1 } },
    ])
  })

  test('nothing on the wall names a person or diagnoses anyone', () => {
    const json = JSON.stringify(wall(pings, { me: 'b' }))
    expect(json).not.toMatch(/depress|diagnos|symptom|disorder/i)
    expect(json).not.toContain('"userId"')
    expect(json).not.toContain('"id"')
  })
})

describe('wall: what a public endpoint lets in', () => {
  test('nicknames: 16 characters, letters and digits, nothing crude, no fake guest numbers', () => {
    expect(cleanNick('  Mika  ')).toBe('Mika')
    expect(cleanNick('Mika 🚀 <script>')).toBe('Mika script')
    expect(cleanNick('a very long nickname indeed')).toBe('a very long nick')
    expect(cleanNick('Äiti & Öljy')).toBe('Äiti & Öljy')
    expect(cleanNick('')).toBeNull()
    expect(cleanNick('🚀🚀')).toBeNull()
    expect(cleanNick('--')).toBeNull()
    expect(cleanNick(42)).toBeNull()
    expect(cleanNick('guest 3')).toBeNull()
    for (const bad of ['f u c k', 'Sh1t', 'V1TTU', 'xx_n4zi_xx']) expect(cleanNick(bad)).toBeNull()
  })

  test('values no phone can produce are refused, odd ones are kept', () => {
    expect(absurd(vals(1.2))).toBe(false)
    expect(absurd(vals(0, 0, null, 0))).toBe(false)
    expect(absurd(vals(-0.1))).toBe(true)
    expect(absurd(vals(1, 2, 9, HARD_MAX.move + 1))).toBe(true)
    expect(absurd(vals(1e9))).toBe(true)
  })

  test('device family and automated agents', () => {
    expect(deviceFamily(IPHONE, false)).toBe('ios')
    expect(deviceFamily(IPHONE.replace('Version/26.1', 'CriOS/142.0'), false)).toBe('ios') // Chrome on iPhone is WebKit too
    expect(deviceFamily(PIXEL, false)).toBe('android')
    expect(deviceFamily(IPHONE, true)).toBe('native')
    expect(deviceFamily('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', false)).toBe('desktop')
    expect(deviceFamily('', false)).toBe('other')
    expect(isTestUa('Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/142.0.0.0 Safari/537.36')).toBe(true)
    expect(isTestUa('curl/8.5.0')).toBe(true)
    expect(isTestUa('smoke')).toBe(true)
    expect(isTestUa(IPHONE)).toBe(false)
    expect(isTestUa(PIXEL)).toBe(false)
  })
})

describe('wall: simulated hall (only ever shown with a "simulated" tag)', () => {
  test('deterministic, inside the hours so far, with some people coming back', () => {
    const a = simulateHall(120, 30)
    expect(JSON.stringify(simulateHall(120, 30))).toBe(JSON.stringify(a))
    expect(a).toHaveLength(120)
    const all = a.flatMap((v) => v.pings)
    expect(Math.min(...all.map((p) => p.h))).toBeGreaterThanOrEqual(0)
    expect(Math.max(...all.map((p) => p.h))).toBeLessThanOrEqual(30)
    const back = a.filter((v) => v.pings.length >= 2)
    expect(back.length).toBeGreaterThan(10)
    for (const v of back) expect(v.pings.at(-1)!.h - v.pings[0]!.h).toBeGreaterThanOrEqual(MIN_GAP_H)
    for (const p of all) expect(absurd(p.values)).toBe(false)
  })

  test('demoWall is flagged simulated and scales from nobody to a full hall', () => {
    const now = WALL_T0 + 30 * HOUR
    expect(demoWall(0, now)).toMatchObject({ simulated: true, visitors: 0, pings: 0 })
    expect(demoWall(3, now)).toMatchObject({ simulated: true, visitors: 3 })
    const full = demoWall(300, now, { me: true })
    expect(full).toMatchObject({ simulated: true, visitors: 300, hoursIn: 30 })
    expect(full.returning).toBeGreaterThan(30)
    expect(full.me!.pings).toBeGreaterThanOrEqual(2)
    expect(full.latest).toHaveLength(12)
    expect(full.readRates.heart!).toBeLessThan(full.readRates.move!)
  })
})

// ---------- the API, on its own instance with a temp database ----------

interface Instance {
  base: string
  stop(): void
}
async function boot(env: Record<string, string>): Promise<Instance> {
  const port = 20000 + Math.floor(Math.random() * 20000)
  const dir = mkdtempSync(join(tmpdir(), 'vire-wall-'))
  const proc = Bun.spawn(['bun', 'index.ts'], {
    cwd: import.meta.dir,
    env: { ...process.env, PORT: String(port), VIRE_DB: join(dir, 'test.sqlite'), VIRE_LLM: 'off', VIRE_DIST: dir, ...env },
    stdout: 'ignore',
    stderr: 'ignore',
  })
  const base = `http://127.0.0.1:${port}`
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return { base, stop: () => proc.kill() }
    } catch {
      /* not up yet */
    }
    await Bun.sleep(100)
  }
  proc.kill()
  throw new Error('test instance did not start')
}

/** a request as the hall sees it: through the funnel (X-Forwarded-For) from a real phone */
const hall = (ip = '203.0.113.7', ua = IPHONE) => ({ 'content-type': 'application/json', 'user-agent': ua, 'x-forwarded-for': ip })
const dev = (ua = IPHONE) => ({ 'content-type': 'application/json', 'user-agent': ua })
const post = async (base: string, path: string, body: unknown, headers: Record<string, string>) => {
  const res = await fetch(`${base}/api/${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}
const get = async <T,>(base: string, path: string) => (await (await fetch(`${base}/api/${path}`)).json()) as T
function upload(userId: string, v: Record<Channel, number | null>, o: Record<string, unknown> = {}) {
  return {
    userId,
    kind: 'full',
    setting: 'home',
    startedAt: new Date().toISOString(),
    features: {
      smile: { latencyMs: 600, peak: 0.5, auc: v.smile, duchenne: 0.3, durationMs: 2400, baseline: 0.1 },
      voice: { speechFraction: 0.6, pauseCount: 3, meanPauseMs: 400, f0MedianHz: 180, f0SdSemitones: v.voice, loudnessSdDb: 5, syllableRateHz: 3.8 },
      heart: { restBpm: 66, swingBpm: v.heart, quality: 0.8, source: 'camera' },
      move: { nodAmplitudeDeg: 14, nodPeakVelDegS: v.move, nodCount: 2, restlessness: 1.2, source: 'camera' },
    },
    device: { ua: IPHONE, native: false, airpodsMotion: false, airpodsHr: false },
    ...o,
  }
}

describe('wall API as it runs in the hall', () => {
  let s: Instance
  beforeAll(async () => {
    s = await boot({})
  })
  afterAll(() => s?.stop())

  test('a visitor gets a guest number or a clean nickname, and stays out of the clinic', async () => {
    const g1 = await post(s.base, 'users', { visitor: true }, hall())
    const g2 = await post(s.base, 'users', { visitor: true, name: '  Mika 🚀 the very long one ' }, hall())
    const g3 = await post(s.base, 'users', { visitor: true, name: 'sh1t' }, hall())
    const patient = await post(s.base, 'users', { name: 'Real Patient' }, hall())
    expect(g1.body.name).toBe('guest 1')
    expect(g2.body.name).toBe('Mika the very lo')
    expect(g3.body.name).toBe('guest 3')
    expect(patient.body.name).toBe('Real Patient')
    expect(String(g1.body.userId)).toMatch(/^[0-9a-f]{12}$/)
    await post(s.base, 'pings', upload(g1.body.userId as string, vals(1.4)), hall())
    await post(s.base, 'pings', upload(patient.body.userId as string, vals(1.4)), hall())
    const rows = await get<PatientRow[]>(s.base, 'clinic/patients')
    expect(rows.filter((r) => r.synthetic)).toHaveLength(50)
    expect(rows.filter((r) => !r.synthetic).map((r) => r.name)).toEqual(['Real Patient'])
    const w = await get<WallState>(s.base, 'wall')
    expect(w).toMatchObject({ visitors: 1, pings: 1, started: 3, simulated: false })
    expect(w.latest[0]).toMatchObject({ label: 'guest 1', nth: 1 })
    expect(JSON.stringify(w)).not.toContain(g1.body.userId as string)
  })

  test('unreadable channels are stored as null and show up in the read rate', async () => {
    const u = (await post(s.base, 'users', { visitor: true }, hall())).body.userId as string
    const r = await post(s.base, 'pings', upload(u, vals(1.1, 2.2, 9.5, 55), { unreadable: ['heart', 'nonsense'] }), hall())
    const echo = r.body as unknown as Echo
    expect(r.status).toBe(200)
    expect(echo.components.find((c) => c.channel === 'heart')!.value).toBeNull()
    expect(echo.components.find((c) => c.channel === 'smile')!.value).toBe(1.1)
    expect(echo.message).toContain('hall wall')
    const w = await get<WallState>(s.base, `wall?u=${u}`)
    expect(w.me).toMatchObject({ counted: true, pings: 1 })
    expect(w.me!.values).toEqual({ smile: 1.1, voice: 2.2, heart: null, move: 55 })
    expect(w.readRates.heart!).toBeLessThan(1)
    expect(w.readRates.smile).toBe(1)
    expect(w.devices[0]).toMatchObject({ family: 'ios', label: 'iOS Safari' })
  })

  test('absurd values are refused', async () => {
    const u = (await post(s.base, 'users', { visitor: true }, hall())).body.userId as string
    const before = (await get<WallState>(s.base, 'wall')).pings
    expect((await post(s.base, 'pings', upload(u, vals(1e6)), hall())).status).toBe(400)
    expect((await post(s.base, 'pings', upload(u, vals(1, 2, 9, -5)), hall())).status).toBe(400)
    expect((await post(s.base, 'pings', { ...upload(u, vals(1)), features: { junk: 'x'.repeat(30_000) } }, hall())).status).toBe(400)
    expect((await get<WallState>(s.base, 'wall')).pings).toBe(before)
  })

  test("the team's own machines and automated agents are stored but kept off the wall", async () => {
    const before = await get<WallState>(s.base, 'wall')
    const local = (await post(s.base, 'users', { visitor: true }, dev())).body.userId as string
    await post(s.base, 'pings', upload(local, vals(2.2)), dev())
    const bot = (await post(s.base, 'users', { visitor: true }, hall('203.0.113.9', HEADLESS))).body.userId as string
    await post(s.base, 'pings', upload(bot, vals(2.4)), hall('203.0.113.9', HEADLESS))
    const after = await get<WallState>(s.base, `wall?u=${local}`)
    expect(after).toMatchObject({ visitors: before.visitors, pings: before.pings, started: before.started })
    expect(after.me).toMatchObject({ counted: false, pings: 1 })
    expect((await get<WallState>(s.base, `wall?u=${bot}`)).me).toMatchObject({ counted: false })
  })

  test('a backdated ping lands when it arrived, not when it claims', async () => {
    const u = (await post(s.base, 'users', { visitor: true }, hall())).body.userId as string
    await post(s.base, 'pings', upload(u, vals(1.3), { startedAt: new Date(Date.now() - 20 * HOUR).toISOString() }), hall())
    const me = (await get<WallState>(s.base, `wall?u=${u}`)).me!
    expect(Date.now() - Date.parse(me.at)).toBeLessThan(60_000)
  })

  test('a phone that could not create its user first still lands on the wall as a guest', async () => {
    const r = await post(s.base, 'pings', upload('localab12cd34', vals(1.7), { visitor: true }), hall())
    expect(r.status).toBe(200)
    expect((await get<WallState>(s.base, 'wall?u=localab12cd34')).me).toMatchObject({ counted: true })
    expect((await get<PatientRow[]>(s.base, 'clinic/patients')).some((p) => p.id === 'localab12cd34')).toBe(false)
  })

  test('one address cannot flood user creation; this machine is never limited', async () => {
    const codes: number[] = []
    for (let i = 0; i < 64; i++) codes.push((await post(s.base, 'users', { visitor: true }, hall('198.51.100.23'))).status)
    expect(codes.slice(0, 60).every((c) => c === 200)).toBe(true)
    expect(codes.slice(60)).toEqual([429, 429, 429, 429])
    expect((await post(s.base, 'users', { visitor: true }, hall('198.51.100.24'))).status).toBe(200)
    for (let i = 0; i < 70; i++) expect((await post(s.base, 'users', {}, dev())).status).toBe(200)
  })

  test('?demo= is made-up data and says so', async () => {
    const d = await get<WallState>(s.base, 'wall?demo=30&h=30&u=x')
    expect(d).toMatchObject({ simulated: true, visitors: 30, hoursIn: 30 })
    expect(d.me).not.toBeNull()
    expect((await get<WallState>(s.base, 'wall?demo=1')).visitors).toBe(60)
    expect((await get<WallState>(s.base, 'wall')).simulated).toBe(false)
  })
})

describe('wall API on a test instance (VIRE_WALL_LOCAL=1): a weekend seeded through the API', () => {
  let s: Instance
  const t0 = Date.now() - 30 * HOUR
  beforeAll(async () => {
    s = await boot({ VIRE_WALL_LOCAL: '1', VIRE_WALL_T0: new Date(t0).toISOString() })
  })
  afterAll(() => s?.stop())

  test('returning visitors and the hall by hour', async () => {
    const at = (h: number) => new Date(t0 + h * HOUR).toISOString()
    const ids: string[] = []
    for (let i = 0; i < 5; i++) ids.push((await post(s.base, 'users', { visitor: true }, dev(i % 2 ? PIXEL : IPHONE))).body.userId as string)
    for (const [i, id] of ids.entries()) await post(s.base, 'pings', upload(id, vals(2 + i * 0.1, 2.5, 10, 70), { startedAt: at(2 + i * 0.1) }), dev())
    for (const id of ids.slice(0, 3)) await post(s.base, 'pings', upload(id, vals(1.2, 2.0, 8, 50), { startedAt: at(26.5) }), dev())
    const w = await get<WallState>(s.base, `wall?u=${ids[0]}`)
    expect(w).toMatchObject({ visitors: 5, pings: 8, returning: 3, started: 5 })
    expect(w.hoursIn).toBeCloseTo(30, 0)
    expect(chan(w, 'smile').hours).toEqual([
      { h: 2, n: 5, median: 2.2, q1: 2.1, q3: 2.3 },
      { h: 26, n: 3, median: 1.2, q1: 1.2, q3: 1.2 },
    ])
    expect(chan(w, 'smile').change).toMatchObject({ n: 3, median: -0.9, up: 0, down: 3 })
    expect(chan(w, 'move').change.median).toBe(-20)
    expect(w.me).toMatchObject({ label: 'guest 1', pings: 2, hoursBetween: 24.5, returning: true, counted: true })
    expect(w.me!.change).toEqual({ smile: -0.8, voice: -0.5, heart: -2, move: -20 })
    expect(w.latest[0]!.returning).toBe(true)
  })
})
