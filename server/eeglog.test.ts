import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dir = mkdtempSync(join(tmpdir(), 'vire-eeg-log-'))
process.env.VIRE_EAR_DIR = dir
const { checkEegLog, registerEegRoutes } = await import('./eeglog')

const row = (t: number) => [t, 1, 2, 3, 0, 0, 1, 0, 0, 0]
const log = { v: 1, at: '2026-11-15T07:00:00.000Z', ua: 'test', clock: { start: { dateNow: 1000, timeOriginNow: 999, deltaMs: 1 }, end: { dateNow: 2000, timeOriginNow: 1999, deltaMs: 1 } }, sampleRateHz: 2, sampleEveryMs: 1000, motion: [row(1000), row(1100)], heart: [{ t: 1050, bpm: 68, source: 'AirPods' }], steps: [{ name: 'eyes-open', t0: 1000, t1: 2000 }], sync: [{ n: 1, t: 1000 }, { n: 2, t: 1100 }] }

test('EEG log validation keeps source classes and rejects malformed rows', () => {
  expect(checkEegLog(log)?.heart[0]?.source).toBe('AirPods')
  expect(checkEegLog({ ...log, motion: [[1, 2]] })).toBeNull()
  expect(checkEegLog({ ...log, heart: [{ t: 1, bpm: 1, source: 'Somebody’s AirPods Pro' }] })).toBeNull()
})

test('EEG routes save JSON and expose worker CSV exports', async () => {
  const app = new Hono()
  const deps = { allow: () => true, asker: () => ({}), tooMany: (c: any) => c.json({ error: 'too many' }, 429), isWorker: (c: any) => c.req.header('authorization') === 'Bearer test' }
  registerEegRoutes(app, deps)
  const saved = await app.request('/api/ear/eeg', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(log) })
  expect(saved.status).toBe(200)
  const answer = await saved.json() as { id: string; code: string }
  expect(answer.id).toMatch(/^[\w-]+$/); expect(answer.code).toMatch(/^[A-Z]{4}$/)
  expect((await app.request(`/api/ear/eeg/${answer.id}`, { headers: { authorization: 'Bearer test' } })).status).toBe(200)
  const motion = await app.request(`/api/ear/eeg/${answer.id}/motion.csv`, { headers: { authorization: 'Bearer test' } })
  expect(motion.status).toBe(200); expect(await motion.text()).toContain('t,pitchDeg')
  const events = await app.request(`/api/ear/eeg/${answer.id}/events.csv`, { headers: { authorization: 'Bearer test' } })
  expect(await events.text()).toContain('sync,sync-beep')
  expect((await app.request('/api/ear/eeg')).status).toBe(401)
})
