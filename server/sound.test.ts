import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Hono } from 'hono'

let dir: string
let app: Hono
let registerSoundRoutes: (app: Hono) => void
const originalFetch = globalThis.fetch

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vire-sound-'))
  process.env.VIRE_SOUND_DIR = dir
  delete process.env.VIRE_SOUND_URL
  delete process.env.VIRE_SOUND_TOKEN
  const mod = await import(`./sound.ts?test=${Date.now()}-${Math.random()}`)
  registerSoundRoutes = mod.registerSoundRoutes
  app = new Hono()
  registerSoundRoutes(app)
})
afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('sound cache API', () => {
  test('manifest and segment use the nearest cached set clip', async () => {
    await mkdir(join(dir, 'set'))
    await writeFile(join(dir, 'set', 'calm.mp3'), new Uint8Array([1, 2, 3]))
    await writeFile(join(dir, 'set', 'calm.json'), JSON.stringify({ id: 'calm', input: { kind: 'breathe', stage: 'deep', pace: 6, calm: 0.9 }, model: 'musicgen-small', prompt: 'quiet', seconds: 20, made: 'set', when: new Date().toISOString() }))
    const manifest = await app.request('/api/sound/manifest')
    expect(manifest.status).toBe(200)
    expect((await manifest.json()).beds[0].id).toBe('calm')
    const response = await app.request('/api/sound/segment', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'breathe', stage: 'deep', pace: 6, calm: 0.8, waitMs: 1 }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: 'calm', made: 'set', live: false })
    const clip = await app.request('/api/sound/clip/calm')
    expect(clip.headers.get('cache-control')).toContain('immutable')
    expect(new Uint8Array(await clip.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })

  test('live responses are cached with live metadata and bearer auth', async () => {
    process.env.VIRE_SOUND_URL = 'https://sound.example/generate'
    process.env.VIRE_SOUND_TOKEN = 'secret-for-test'
    const calls: Request[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(new Request(input, init))
      return Response.json({ audio_base64: Buffer.from([9, 8, 7]).toString('base64'), model: 'facebook/musicgen-small', prompt: '6 BPM calm drone', seconds: 20 })
    }) as typeof fetch
    const response = await app.request('/api/sound/segment', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'scan', stage: 'rest', pace: 5, calm: 0.95, waitMs: 500 }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ made: 'live', model: 'facebook/musicgen-small' })
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer secret-for-test')
    const manifest = await (await app.request('/api/sound/manifest')).json()
    expect(manifest.beds).toHaveLength(1)
  })
})
