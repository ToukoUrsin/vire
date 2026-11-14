import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Hono } from 'hono'

export type SoundKind = 'breathe' | 'scan' | 'walk'
export type SoundStage = 'settle' | 'deep' | 'rest'
export interface SoundRequest {
  kind: SoundKind
  stage: SoundStage
  pace: number
  calm: number
  person?: string
  waitMs?: number
  seed?: number
}

interface BedMeta {
  id: string
  input: Pick<SoundRequest, 'kind' | 'stage' | 'pace' | 'calm'> & { seed?: number }
  model: string
  prompt: string
  seconds: number
  made: 'live' | 'set'
  when: string
  url?: string
}
interface CueMeta {
  id: string
  text: string
  model: string
  when: string
  url?: string
}

export const CUES = [
  { id: 'settle', text: 'Sit comfortably. Follow the sound.' },
  { id: 'in', text: 'Breathe in as the sound rises.' },
  { id: 'out', text: 'And out as it falls.' },
  { id: 'shoulders', text: 'Let your shoulders drop.' },
  { id: 'rest', text: 'Now just sit. Breathe as you like.' },
  { id: 'feet', text: 'Notice your feet.' },
  { id: 'hands', text: 'Notice your hands.' },
  { id: 'face', text: 'Notice your face. Let it soften.' },
  { id: 'walk', text: 'Stand up, and walk at your own pace.' },
  { id: 'done', text: "That's it. Well done." },
] as const

const KINDS: SoundKind[] = ['breathe', 'scan', 'walk']
const STAGES: SoundStage[] = ['settle', 'deep', 'rest']
const dir = resolve(process.env.VIRE_SOUND_DIR || '/bulk3/runs/depression/sound/')
const setDir = join(dir, 'set')
const liveUrl = () => process.env.VIRE_SOUND_URL?.replace(/\/$/, '') || ''
const token = () => process.env.VIRE_SOUND_TOKEN || ''
const day = () => new Date().toISOString().slice(0, 10)
const countFile = () => join(dir, 'live-count.json')

async function ensureDirs() {
  await mkdir(setDir, { recursive: true })
}
async function json<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T } catch { return null }
}
function safeNum(value: unknown, low: number, high: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.max(low, Math.min(high, n))
}
function validInput(value: unknown): SoundRequest | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (!KINDS.includes(v.kind as SoundKind) || !STAGES.includes(v.stage as SoundStage)) return null
  return {
    kind: v.kind as SoundKind,
    stage: v.stage as SoundStage,
    pace: safeNum(v.pace, 4.5, 14, 6),
    calm: safeNum(v.calm, 0, 1, 0.7),
    person: typeof v.person === 'string' ? v.person.slice(0, 80) : undefined,
    waitMs: safeNum(v.waitMs, 0, 30_000, 9_000),
    seed: typeof v.seed === 'number' && Number.isFinite(v.seed) ? Math.trunc(v.seed) : undefined,
  }
}

async function beds(): Promise<BedMeta[]> {
  await ensureDirs()
  const names = (await readdir(setDir)).filter((name) => name.endsWith('.json'))
  const out: BedMeta[] = []
  for (const name of names) {
    const meta = await json<BedMeta>(join(setDir, name))
    if (!meta || !meta.id || !meta.input || !existsSync(join(setDir, `${meta.id}.mp3`))) continue
    out.push({ ...meta, made: meta.made === 'live' ? 'live' : 'set', url: `/api/sound/clip/${meta.id}` })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}
async function cues(): Promise<CueMeta[]> {
  await ensureDirs()
  const out: CueMeta[] = []
  for (const c of CUES) {
    const meta = await json<CueMeta>(join(setDir, `cue-${c.id}.json`))
    if (meta && existsSync(join(setDir, `cue-${c.id}.mp3`))) out.push({ ...meta, url: `/api/sound/clip/cue-${c.id}` })
  }
  return out
}
function distance(a: SoundRequest, b: BedMeta['input']): number {
  return (a.kind === b.kind ? 0 : 10) + (a.stage === b.stage ? 0 : 4) + Math.abs(a.pace - b.pace) + Math.abs(a.calm - b.calm) * 3
}
function nearest(input: SoundRequest, all: BedMeta[]): BedMeta | null {
  const matching = all.filter((b) => b.input.kind === input.kind)
  const pool = matching.length ? matching : all
  return pool.slice().sort((a, b) => distance(input, a.input) - distance(input, b.input))[0] ?? null
}
async function liveAllowed(): Promise<boolean> {
  const max = Math.max(0, Number(process.env.VIRE_SOUND_MAX_LIVE ?? 300) || 300)
  const saved = await json<{ day: string; count: number }>(countFile())
  return !saved || saved.day !== day() || saved.count < max
}
async function noteLive() {
  const saved = await json<{ day: string; count: number }>(countFile())
  const next = saved?.day === day() ? saved.count + 1 : 1
  await writeFile(countFile(), JSON.stringify({ day: day(), count: next }))
}
function authHeaders(): Record<string, string> {
  const value = token()
  return value ? { authorization: `Bearer ${value}`, 'x-vire-sound-token': value } : {}
}
function requestId(input: SoundRequest): string {
  return createHash('sha256').update(JSON.stringify({ ...input, seed: input.seed ?? randomUUID() })).digest('hex').slice(0, 20)
}

async function saveLive(input: SoundRequest, response: Response): Promise<BedMeta | null> {
  try {
    const type = response.headers.get('content-type') || ''
    let audio: Uint8Array
    let extra: Partial<BedMeta> = {}
    if (type.includes('application/json')) {
      const body = await response.json() as { audio_base64?: string; mp3_base64?: string; model?: string; prompt?: string; seconds?: number }
      const b64 = body.audio_base64 || body.mp3_base64
      if (!b64) return null
      audio = Uint8Array.from(Buffer.from(b64, 'base64'))
      extra = body
    } else {
      audio = new Uint8Array(await response.arrayBuffer())
      extra = { model: response.headers.get('x-model') || 'modal-open-model', prompt: response.headers.get('x-prompt') || '' }
    }
    if (!audio.byteLength) return null
    const id = requestId(input)
    const meta: BedMeta = {
      id,
      input: { kind: input.kind, stage: input.stage, pace: input.pace, calm: input.calm, ...(input.seed == null ? {} : { seed: input.seed }) },
      model: extra.model || 'modal-open-model', prompt: extra.prompt || '', seconds: Number(extra.seconds) || 20,
      made: 'live', when: new Date().toISOString(), url: `/api/sound/clip/${id}`,
    }
    await ensureDirs()
    await writeFile(join(setDir, `${id}.mp3`), audio)
    await writeFile(join(setDir, `${id}.json`), JSON.stringify(meta, null, 2))
    return meta
  } catch (error) {
    console.warn('[sound] late live segment failed', error)
    return null
  }
}
async function askLive(input: SoundRequest): Promise<BedMeta | null> {
  const url = liveUrl()
  if (!url || !(await liveAllowed())) return null
  await noteLive()
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify({ ...input, waitMs: undefined }) })
    if (!response.ok) return null
    return await saveLive(input, response)
  } catch { return null }
}
async function askLiveWithTimeout(input: SoundRequest, waitMs: number): Promise<BedMeta | null> {
  const url = liveUrl()
  if (!url || !(await liveAllowed())) return null
  await noteLive()
  const work = fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify({ ...input, waitMs: undefined }) }).then((response) => response.ok ? saveLive(input, response) : null).catch(() => null)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), waitMs) })
  const result = await Promise.race([work, timeout])
  if (timer) clearTimeout(timer)
  if (result === null) void work
  return result
}
function clipPath(id: string): string | null {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) return null
  const path = join(setDir, `${id}.mp3`)
  return resolve(path).startsWith(resolve(setDir) + '/') ? path : null
}

export function registerSoundRoutes(app: Hono) {
  app.get('/api/sound/manifest', async (c) => c.json({ live: Boolean(liveUrl()), beds: await beds(), cues: await cues() }))
  app.get('/api/sound/clip/:id', async (c) => {
    const path = clipPath(c.req.param('id'))
    if (!path || !existsSync(path)) return c.text('not found', 404)
    return new Response(Bun.file(path), { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'public, max-age=31536000, immutable' } })
  })
  app.post('/api/sound/warm', (c) => {
    const url = liveUrl()
    if (url) void fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify({ kind: 'breathe', stage: 'settle', pace: 8, calm: 0.7, seed: 0 }) }).catch(() => {})
    return c.json({ ok: true, live: Boolean(url) })
  })
  app.post('/api/sound/segment', async (c) => {
    const started = Date.now()
    const input = validInput(await c.req.json().catch(() => null))
    if (!input) return c.json({ error: 'invalid sound request' }, 400)
    const cached = await beds()
    const fallback = nearest(input, cached)
    const live = await askLiveWithTimeout(input, input.waitMs ?? 9_000)
    if (live) return c.json({ id: live.id, url: live.url, seconds: live.seconds, made: 'live', model: live.model, ms: Date.now() - started })
    if (!fallback) return c.json({ error: 'no sound set yet' }, 503)
    return c.json({ id: fallback.id, url: fallback.url, seconds: fallback.seconds, made: 'set', model: fallback.model, ms: Date.now() - started, live: false })
  })
  app.post('/api/sound/cue', async (c) => {
    const body = await c.req.json().catch(() => null) as { id?: string; text?: string } | null
    const cue = CUES.find((item) => item.id === body?.id) || CUES.find((item) => item.text === body?.text)
    if (!cue || !liveUrl()) return c.json({ error: 'cue unavailable' }, 404)
    const url = liveUrl()
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify({ kind: 'cue', id: cue.id, text: cue.text }) })
      if (!response.ok) return c.json({ error: 'cue generation failed' }, 502)
      const bytes = new Uint8Array(await response.arrayBuffer())
      await ensureDirs()
      const id = `cue-${cue.id}`
      await writeFile(join(setDir, `${id}.mp3`), bytes)
      await writeFile(join(setDir, `${id}.json`), JSON.stringify({ id, text: cue.text, model: response.headers.get('x-model') || 'kokoro-82m', when: new Date().toISOString() }))
      return c.json({ id, url: `/api/sound/clip/${id}`, model: response.headers.get('x-model') || 'kokoro-82m' })
    } catch { return c.json({ error: 'cue generation failed' }, 502) }
  })
}
