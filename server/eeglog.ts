import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from 'hono'
import type { Hono } from 'hono'

const DIR = () => join(process.env.VIRE_EAR_DIR || '/bulk2/runs/depression/ear/recordings/', 'eeg')
const MAX_BYTES = 8_000_000
const MAX_ROWS = 400_000

export type EegSource = 'AirPods' | 'Apple Watch' | 'iPhone' | 'another device'
export interface EegStep { name: string; t0: number; t1: number }
export interface EegLog {
  v: 1
  id?: string
  at: string
  ua: string
  clock: { start: { dateNow: number; timeOriginNow: number; deltaMs: number }; end?: { dateNow: number; timeOriginNow: number; deltaMs: number } }
  sampleRateHz: number
  samplesPerSecond?: number
  sampleEveryMs: number
  motion: number[][]
  heart: Array<{ t: number; bpm: number; source: EegSource }>
  steps: EegStep[]
  sync: Array<{ n: number; t: number }>
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const motionRows = (x: unknown): x is number[][] => Array.isArray(x) && x.length <= MAX_ROWS && x.every((r) => Array.isArray(r) && r.length === 10 && r.every(finite))
const source = (x: unknown): EegSource => x === 'AirPods' || x === 'Apple Watch' || x === 'iPhone' ? x : 'another device'

export function checkEegLog(x: unknown): EegLog | null {
  if (!x || typeof x !== 'object') return null
  const r = x as Partial<EegLog>
  if (r.v !== 1 || typeof r.at !== 'string' || typeof r.ua !== 'string' || !motionRows(r.motion) || !Array.isArray(r.heart) || !Array.isArray(r.steps) || !Array.isArray(r.sync)) return null
  if (r.motion.length > MAX_ROWS || r.heart.length > MAX_ROWS || r.steps.length > 100 || r.sync.length > 20) return null
  if (!finite(r.sampleRateHz) || r.sampleRateHz < 0 || r.sampleRateHz > 200 || (r.samplesPerSecond !== undefined && (!finite(r.samplesPerSecond) || r.samplesPerSecond < 0 || r.samplesPerSecond > 200)) || r.sampleEveryMs !== 1000) return null
  const c = r.clock
  if (!c || !c.start || !finite(c.start.dateNow) || !finite(c.start.timeOriginNow) || !finite(c.start.deltaMs)) return null
  if (c.end && (!finite(c.end.dateNow) || !finite(c.end.timeOriginNow) || !finite(c.end.deltaMs))) return null
  const steps = r.steps.filter((s): s is EegStep => !!s && typeof s.name === 'string' && s.name.length <= 80 && finite(s.t0) && finite(s.t1) && s.t0 >= 0 && s.t1 >= s.t0)
  if (steps.length !== r.steps.length) return null
  const heart = r.heart.filter((h) => !!h && finite(h.t) && finite(h.bpm) && h.bpm >= 0 && h.bpm <= 300 && (h.source === 'AirPods' || h.source === 'Apple Watch' || h.source === 'iPhone' || h.source === 'another device')).map((h) => ({ t: h.t, bpm: h.bpm, source: source(h.source) }))
  if (heart.length !== r.heart.length) return null
  const sync = r.sync.filter((s) => !!s && Number.isInteger(s.n) && s.n > 0 && s.n <= 20 && finite(s.t)).map((s) => ({ n: s.n, t: s.t }))
  if (sync.length !== r.sync.length) return null
  return {
    v: 1,
    at: r.at.slice(0, 40),
    ua: r.ua.slice(0, 300),
    clock: { start: { dateNow: c.start.dateNow, timeOriginNow: c.start.timeOriginNow, deltaMs: c.start.deltaMs }, ...(c.end ? { end: { dateNow: c.end.dateNow, timeOriginNow: c.end.timeOriginNow, deltaMs: c.end.deltaMs } } : {}), },
    sampleRateHz: r.sampleRateHz,
    ...(r.samplesPerSecond !== undefined ? { samplesPerSecond: r.samplesPerSecond } : {}),
    sampleEveryMs: 1000,
    motion: r.motion,
    heart,
    steps,
    sync,
  }
}

const safeId = (id: string) => /^[A-Za-z0-9_-]{8,80}$/.test(id)
const idFor = () => `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomUUID().slice(0, 8)}`
const codeFor = (id: string) => {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  let n = 0
  for (const c of id) n = (n * 33 + c.charCodeAt(0)) >>> 0
  return Array.from({ length: 4 }, () => letters[(n = Math.imul(n ^ (n >>> 13), 0x45d9f3b) >>> 0) % letters.length]).join('')
}

async function listIds(): Promise<string[]> {
  try { return (await readdir(DIR())).filter((n) => safeId(n.replace(/\.json$/, '')) && n.endsWith('.json')).map((n) => n.slice(0, -5)).sort().slice(-200) } catch { return [] }
}
async function read(id: string): Promise<string | null> {
  if (!safeId(id)) return null
  try { return await readFile(join(DIR(), `${id}.json`), 'utf8') } catch { return null }
}

const csv = (v: unknown) => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}
function motionCsv(r: EegLog): string {
  const lines = ['t,pitchDeg,yawDeg,rollDeg,ax,ay,az,rxDegS,ryDegS,rzDegS']
  for (const x of r.motion) lines.push(x.map(csv).join(','))
  return `${lines.join('\n')}\n`
}
function eventsCsv(r: EegLog): string {
  const lines = ['type,name,n,t,t0,t1,bpm,source']
  for (const s of r.steps) lines.push(['step', s.name, '', '', s.t0, s.t1, '', ''].map(csv).join(','))
  for (const s of r.sync) lines.push(['sync', 'sync-beep', s.n, s.t, '', '', '', ''].map(csv).join(','))
  for (const h of r.heart) lines.push(['heart', 'heart-rate', '', h.t, '', '', h.bpm, h.source].map(csv).join(','))
  return `${lines.join('\n')}\n`
}

export interface EegRouteDeps {
  allow: (a: unknown, bucket: string, max: number) => boolean
  asker: (c: Context, bodyUa?: unknown) => unknown
  tooMany: (c: Context) => Response
  isWorker: (c: Context) => boolean
}

export function registerEegRoutes(app: Hono, deps: EegRouteDeps): void {
  app.post('/api/ear/eeg', async (c) => {
    if (!deps.allow(deps.asker(c), 'ear-eeg', 30)) return deps.tooMany(c)
    if (Number(c.req.header('content-length') ?? 0) > MAX_BYTES) return c.json({ error: 'too large' }, 413)
    const bytes = await c.req.arrayBuffer().catch(() => new ArrayBuffer(MAX_BYTES + 1))
    if (bytes.byteLength > MAX_BYTES) return c.json({ error: 'too large' }, 413)
    const body = (() => { try { return JSON.parse(new TextDecoder().decode(bytes)) } catch { return null } })()
    const log = checkEegLog(body)
    if (!log) return c.json({ error: 'not an EEG log' }, 400)
    const id = idFor()
    await mkdir(DIR(), { recursive: true })
    await writeFile(join(DIR(), `${id}.json`), JSON.stringify({ id, ...log }))
    return c.json({ id, code: codeFor(id), at: log.at, motionRows: log.motion.length, heartRows: log.heart.length })
  })
  app.get('/api/ear/eeg', async (c) => {
    if (!deps.isWorker(c)) return c.json({ error: 'not allowed' }, 401)
    const out: Array<{ id: string; at: string; motionRows: number; heartRows: number }> = []
    for (const id of await listIds()) {
      const text = await read(id)
      try { const r = JSON.parse(text ?? 'null') as EegLog; if (r?.v === 1) out.push({ id, at: r.at, motionRows: r.motion?.length ?? 0, heartRows: r.heart?.length ?? 0 }) } catch { /* half-written file */ }
    }
    return c.json(out)
  })
  app.get('/api/ear/eeg/:id/motion.csv', async (c) => {
    if (!deps.isWorker(c)) return c.json({ error: 'not allowed' }, 401)
    const text = await read(c.req.param('id')); if (!text) return c.text('not found', 404)
    try { const r = JSON.parse(text) as EegLog; return c.body(motionCsv(r), 200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${c.req.param('id')}-motion.csv"` }) } catch { return c.text('not found', 404) }
  })
  app.get('/api/ear/eeg/:id/events.csv', async (c) => {
    if (!deps.isWorker(c)) return c.json({ error: 'not allowed' }, 401)
    const text = await read(c.req.param('id')); if (!text) return c.text('not found', 404)
    try { const r = JSON.parse(text) as EegLog; return c.body(eventsCsv(r), 200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${c.req.param('id')}-events.csv"` }) } catch { return c.text('not found', 404) }
  })
  app.get('/api/ear/eeg/:id', async (c) => {
    if (!deps.isWorker(c)) return c.json({ error: 'not allowed' }, 401)
    const text = await read(c.req.param('id')); return text ? c.body(text, 200, { 'content-type': 'application/json' }) : c.json({ error: 'not found' }, 404)
  })
}
