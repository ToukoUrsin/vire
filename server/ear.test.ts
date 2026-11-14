// bun test server/ear.test.ts: a device reads back its own teaching minutes and nobody else's.
import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'vire-ear-')) + '/'
process.env.VIRE_EAR_DIR = dir
const { saveEar, mineEar, readMine, ownerOf, listEar, minutesWith } = await import('./ear')

const minute = (at: string) => ({
  v: 1 as const,
  at,
  userId: null,
  device: { shell: 'ios' as const, gyro: true, hz: 50, ua: 'test' },
  head: [[0, 1, 2, 3, 0, 0, 1, 0, 0, 0]],
  face: [[0, 1, 0.1, 0, 0, 0, 0, 0, 0]],
  voice: [[0, -50, 0]],
  steps: [{ ask: 'rest' as const, t0: 0, t1: 1000 }],
})
const A = 'a'.repeat(32)
const B = 'b'.repeat(32)

test('a key is hex made on the device, and only its hash is kept', async () => {
  expect(ownerOf('short')).toBeNull()
  expect(ownerOf('../../etc/passwd')).toBeNull()
  expect(ownerOf(A)).toMatch(/^[a-f0-9]{40}$/)
  const kept = await saveEar({ recording: minute('2026-11-14T10:00:00.000Z'), key: A })
  expect(kept).not.toBeNull()
  const file = readFileSync(join(dir, `${kept!.id}.json`), 'utf8')
  expect(file).not.toContain(A)
  expect(file).toContain(ownerOf(A)!)
})

test('a device gets its own minutes back, oldest first, and nobody else\'s', async () => {
  const mine2 = await saveEar({ recording: minute('2026-11-14T11:00:00.000Z'), key: A })
  const theirs = await saveEar({ recording: minute('2026-11-14T11:30:00.000Z'), key: B })
  const nobody = await saveEar({ recording: minute('2026-11-14T11:40:00.000Z') })
  const a = await mineEar(A)
  expect(a!.map((m) => m.at)).toEqual(['2026-11-14T10:00:00.000Z', '2026-11-14T11:00:00.000Z'])
  expect((await mineEar(B))!.length).toBe(1)
  expect(await mineEar('not a key')).toBeNull()
  expect(JSON.parse((await readMine(A, mine2!.id))!).recording.at).toBe('2026-11-14T11:00:00.000Z')
  expect(await readMine(A, theirs!.id)).toBeNull()
  expect(await readMine(A, nobody!.id)).toBeNull()
  expect(await readMine(B, mine2!.id)).toBeNull()
  expect(await readMine(A, '../by/seen')).toBeNull()
})

test('a new key has nothing yet, is noted once, and the worker listing still works', async () => {
  const C = 'c'.repeat(40)
  expect(await mineEar(C, 'VireShell/1')).toEqual([])
  expect(await mineEar(C, 'VireShell/1')).toEqual([])
  const seen = readFileSync(join(dir, 'by', 'seen.log'), 'utf8').split('\n').filter((l) => l.includes(ownerOf(C)!))
  expect(seen.length).toBe(1)
  expect(seen[0]).not.toContain(C)
  expect((await listEar()).length).toBe(4)
  expect(readdirSync(dir).filter((n) => n.endsWith('.json')).length).toBe(4)
})

test('a minute where the AirPods sent too few samples is left out once a full one arrives, and kept with what the phone said', async () => {
  const C = 'c'.repeat(32)
  const thinOne = { ...minute('2026-11-14T17:11:35.000Z'), device: { shell: 'ios' as const, gyro: true, hz: 6, ua: 'test', idleHz: 50, route: 'Bluetooth: AirPods' } }
  const first = await saveEar({ recording: thinOne, key: C })
  // alone, the thin minute is what there is
  expect((await minutesWith(first!.id)).map((m) => m.device.hz)).toEqual([6])
  expect((await minutesWith(first!.id))[0]!.device).toMatchObject({ idleHz: 50, route: 'Bluetooth: AirPods' })
  const full = await saveEar({ recording: minute('2026-11-14T17:40:00.000Z'), key: C })
  expect((await minutesWith(full!.id)).map((m) => m.device.hz)).toEqual([50])
  // and a later thin one still takes the full one with it
  const later = await saveEar({ recording: { ...thinOne, at: '2026-11-14T17:50:00.000Z' }, key: C })
  expect((await minutesWith(later!.id)).map((m) => m.device.hz)).toEqual([6, 50, 6])
})
