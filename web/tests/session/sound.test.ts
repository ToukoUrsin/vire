import { afterEach, describe, expect, test } from 'bun:test'
import { loadManifest, nextSegment, resetForTests, warm } from '../../src/tune/session/sound'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
  resetForTests()
})

describe('session sound client', () => {
  test('warms and caches the manifest, then decodes the selected clip', async () => {
    const calls: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      calls.push(`${init?.method ?? 'GET'} ${path}`)
      if (path.endsWith('/warm')) return new Response('{}', { status: 200 })
      if (path.endsWith('/manifest')) return Response.json({ live: true, beds: [{ id: 'bed', url: '/api/sound/clip/bed', seconds: 20, made: 'set', model: 'musicgen', input: { kind: 'breathe', stage: 'deep', pace: 6, calm: 0.8 } }], cues: [] })
      if (path.endsWith('/segment')) return Response.json({ id: 'bed', url: '/api/sound/clip/bed', seconds: 20, made: 'set', model: 'musicgen' })
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
    }) as typeof fetch
    await warm()
    const first = await loadManifest()
    const second = await loadManifest()
    expect(first).toBe(second)
    const decoded: ArrayBuffer[] = []
    const context = { decodeAudioData: async (bytes: ArrayBuffer) => { decoded.push(bytes); return { duration: 20 } as AudioBuffer } }
    const result = await nextSegment({ kind: 'breathe', stage: 'deep', pace: 6, calm: 0.8 }, context)
    expect(result.info.made).toBe('set')
    expect(result.buffer.duration).toBe(20)
    expect(decoded).toHaveLength(1)
    expect(calls.filter((call) => call.endsWith('/manifest')).length).toBe(1)
  })

  test('a missing clip falls back to the nearest cached bed', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path.endsWith('/manifest')) return Response.json({ live: false, beds: [{ id: 'walk', url: '/api/sound/clip/walk', seconds: 20, made: 'set', model: 'musicgen', input: { kind: 'walk', stage: 'rest', pace: 5, calm: 0.9 } }], cues: [] })
      if (path.endsWith('/segment')) return Response.json({ id: 'missing', url: '/api/sound/clip/missing', seconds: 20, made: 'set', model: 'musicgen' })
      if (path.endsWith('/missing')) return new Response('no', { status: 404 })
      return new Response(new Uint8Array([4]), { status: 200 })
    }) as typeof fetch
    const context = { decodeAudioData: async () => ({ duration: 20 } as AudioBuffer) }
    const result = await nextSegment({ kind: 'walk', stage: 'rest', pace: 5, calm: 0.9 }, context)
    expect(result.info.id).toBe('walk')
    expect(result.info.made).toBe('set')
  })
})
