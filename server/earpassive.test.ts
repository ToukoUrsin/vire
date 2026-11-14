import { beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { SLOTS } from '../shared/earpassive'
import type { PassiveBin } from '../shared/earpassive'

let dir: string
let app: Hono
const KEY = 'ab'.repeat(16)
const OTHER = 'cd'.repeat(16)
const T0 = Date.UTC(2026, 10, 10, 8, 0, 0)

const bin = (at: number, day: string, o: Partial<PassiveBin> = {}): PassiveBin => ({
  v: 1, at, ms: 60_000, day, shell: 'ios', samples: 3000, wornS: SLOTS, pitch: new Array(SLOTS).fill(0), walk: [], stepsPerMin: null,
  call: [], practice: [], moveDegS: 3, nods: null, smiles: null, hr: null, hrN: 0, ...o,
})
const minutes = (day: string, start: number, n: number, o: Partial<PassiveBin> = {}) => Array.from({ length: n }, (_, i) => bin(start + i * 60_000, day, o))
const post = (body: unknown) => app.request('/api/ear/passive', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const mine = (key: string, today?: string) => app.request(`/api/ear/passive/mine${today ? `?today=${today}` : ''}`, { headers: { authorization: `Bearer ${key}` } })

beforeEach(async () => {
  dir = `${await mkdtemp(join(tmpdir(), 'vire-passive-'))}/`
  process.env.VIRE_EAR_DIR = dir
  const mod = await import(`./earpassive.ts?test=${Date.now()}-${Math.random()}`)
  app = new Hono()
  mod.registerPassiveRoutes(app, {
    asker: () => ({}),
    allow: () => true,
    tooMany: (c: Context) => c.json({ error: 'too many' }, 429),
    isWorker: (c: Context) => c.req.header('authorization') === 'Bearer worker',
  })
})

describe('passive minutes API', () => {
  test('kept once per minute and device; the fuller copy wins', async () => {
    const first = await post({ key: KEY, bins: [bin(T0, '2026-11-10', { samples: 100 })] })
    expect(await first.json()).toEqual({ kept: 1, minutes: 1 })
    const again = await post({ key: KEY, bins: [bin(T0, '2026-11-10', { samples: 100 }), bin(T0 + 60_000, '2026-11-10')] })
    expect(await again.json()).toEqual({ kept: 1, minutes: 2 })
    const fuller = await post({ key: KEY, bins: [bin(T0, '2026-11-10', { samples: 3000 })] })
    expect(await fuller.json()).toEqual({ kept: 1, minutes: 2 })
  })

  test('the key never touches the disk', async () => {
    await post({ key: KEY, bins: [bin(T0, '2026-11-10')] })
    const owners = await readdir(join(dir, 'passive'))
    expect(owners).toHaveLength(1)
    expect(owners[0]).not.toContain(KEY)
    const text = await readFile(join(dir, 'passive', owners[0], '2026-11-10.json'), 'utf8')
    expect(text).not.toContain(KEY)
  })

  test('bad bins and missing keys are refused', async () => {
    expect((await post({ key: KEY, bins: [{ ...bin(T0, '2026-11-10'), pitch: [1] }] })).status).toBe(400)
    expect((await post({ key: 'nope', bins: [bin(T0, '2026-11-10')] })).status).toBe(401)
    expect((await post({ key: KEY, bins: 'x' })).status).toBe(400)
  })

  test('a device reads its own days and usual; a stand-in never enters it', async () => {
    const day = 86_400_000
    for (const [i, d] of ['2026-11-07', '2026-11-08', '2026-11-09'].entries()) {
      await post({ key: KEY, bins: minutes(d, T0 - (3 - i) * day, 40, { pitch: Array.from({ length: SLOTS }, (_, s) => (s < 20 + i ? -30 : 0)) }) })
    }
    await post({ key: KEY, bins: minutes('2026-11-08', T0 - 2 * day + 3600_000, 40, { shell: 'sim', pitch: new Array(SLOTS).fill(-40) }) })
    await post({ key: KEY, bins: minutes('2026-11-10', T0, 40) })
    const res = await mine(KEY, '2026-11-10')
    expect(res.status).toBe(200)
    const got = await res.json()
    expect(got.days.filter((d: { sim: boolean }) => !d.sim).map((d: { day: string }) => d.day)).toEqual(['2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10'])
    expect(got.days.filter((d: { sim: boolean }) => d.sim)).toHaveLength(1)
    expect(got.usual.days).toBe(3)
    expect(got.usual.band).toBe(true)
    expect(got.usual.sim).toBe(false)
    expect(got.simUsual.days).toBe(1)
    const other = await (await mine(OTHER)).json()
    expect(other.days).toEqual([])
    expect(other.usual.note).toBe('too early for a band')
    expect((await mine('')).status).toBe(401)
  })

  test('the list needs the worker token and names no key', async () => {
    await post({ key: KEY, bins: [bin(T0, '2026-11-10'), bin(T0 + 60_000, '2026-11-10', { shell: 'sim' })] })
    expect((await app.request('/api/ear/passive')).status).toBe(401)
    const list = await (await app.request('/api/ear/passive', { headers: { authorization: 'Bearer worker' } })).json()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ days: 1, minutes: 2, sim: 1, last: '2026-11-10' })
    expect(JSON.stringify(list)).not.toContain(KEY)
  })

  test('two posts at once lose nothing', async () => {
    await Promise.all(Array.from({ length: 8 }, (_, i) => post({ key: KEY, bins: [bin(T0 + i * 60_000, '2026-11-10')] })))
    const got = await (await mine(KEY)).json()
    expect(got.days[0].wornMin).toBe(8)
  })
})
