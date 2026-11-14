// The teaching minutes people send in (AirPods motion next to what the camera saw: numbers only, no picture or sound).
// Kept as one JSON file each, so a person's own model can be searched for outside the browser.
import { createHash } from 'node:crypto'
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fullMinutes } from '../shared/ear'
import type { EarRecording, EarStored, EarUpload } from '../shared/ear'

const DIR = process.env.VIRE_EAR_DIR || '/bulk2/runs/depression/ear/recordings/'
const MAX_ROWS = 6000
const ASKS = new Set(['rest', 'smile', 'relax', 'nod', 'shake', 'laugh', 'talk'])

const rows = (v: unknown, width: number): v is number[][] =>
  Array.isArray(v) && v.length <= MAX_ROWS && v.every((r) => Array.isArray(r) && r.length === width && r.every((n) => typeof n === 'number' && Number.isFinite(n)))

/** null when it is not a teaching minute */
export function checkEarRecording(x: unknown): EarRecording | null {
  const r = x as EarRecording | null
  if (!r || typeof r !== 'object' || r.v !== 1) return null
  if (!rows(r.head, 10) || !rows(r.face, 9) || !rows(r.voice, 3)) return null
  if (!Array.isArray(r.steps) || r.steps.length > 60 || !r.steps.every((s) => s && ASKS.has(s.ask) && Number.isFinite(s.t0) && Number.isFinite(s.t1) && s.t0 >= 0 && s.t1 > s.t0 && s.t1 <= 300_000)) return null
  const d = r.device
  if (!d || !['mac', 'ios', 'sim'].includes(d.shell)) return null
  if (!Number.isFinite(d.hz) || d.hz < 0 || d.hz > 200 || typeof d.gyro !== 'boolean') return null
  return {
    v: 1,
    at: typeof r.at === 'string' ? r.at.slice(0, 40) : new Date().toISOString(),
    userId: typeof r.userId === 'string' ? r.userId.slice(0, 64) : null,
    device: {
      shell: d.shell, gyro: !!d.gyro, hz: Number.isFinite(d.hz) ? d.hz : 0, ua: String(d.ua ?? '').slice(0, 200),
      ...(typeof d.idleHz === 'number' && Number.isFinite(d.idleHz) && d.idleHz >= 0 && d.idleHz <= 200 ? { idleHz: d.idleHz } : {}),
      ...(typeof d.route === 'string' && d.route ? { route: d.route.slice(0, 160) } : {}),
    },
    head: r.head,
    face: r.face,
    voice: r.voice,
    steps: r.steps.map((s) => ({ ask: s.ask, t0: s.t0, t1: s.t1 })),
    ...(r.kind === 'daily' ? { kind: 'daily' as const } : {}),
  }
}

function describe(id: string, r: EarRecording): EarStored {
  const last = r.steps.length ? r.steps[r.steps.length - 1]!.t1 : r.head.length ? r.head[r.head.length - 1]![0]! : 0
  return { id, at: r.at, userId: r.userId, shell: r.device.shell, seconds: Math.round(last / 100) / 10, headRows: r.head.length, hz: r.device.hz, ...(r.kind === 'daily' ? { daily: true as const } : {}) }
}

/**
 * Who a minute belongs to: a hash of the key the device made for itself. The key never touches the disk, so
 * the files and the worker that reads them cannot be used to read anyone's minutes back.
 */
export function ownerOf(key: unknown): string | null {
  return typeof key === 'string' && /^[a-f0-9]{32,64}$/.test(key) ? createHash('sha256').update(`vire-ear:${key}`).digest('hex').slice(0, 40) : null
}
const BY = () => join(DIR, 'by')
const MAX_MINE = 40

async function idsOf(owner: string): Promise<string[]> {
  try {
    const ids = (await readFile(join(BY(), `${owner}.txt`), 'utf8')).split('\n').filter((x) => /^[\w-]+$/.test(x))
    return [...new Set(ids)].slice(-MAX_MINE)
  } catch {
    return []
  }
}

export async function saveEar(up: EarUpload): Promise<EarStored | null> {
  const rec = checkEarRecording(up?.recording)
  if (!rec) return null
  const owner = ownerOf(up.key)
  const id = `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomUUID().slice(0, 8)}`
  await mkdir(DIR, { recursive: true })
  await writeFile(join(DIR, `${id}.json`), JSON.stringify({ id, recording: rec, quick: up.quick ?? null, owner }))
  if (owner) {
    await mkdir(BY(), { recursive: true })
    await appendFile(join(BY(), `${owner}.txt`), `${id}\n`)
  }
  return describe(id, rec)
}

/**
 * The minutes one device has sent, oldest first. The first time a key is seen it is noted (hash, time, the
 * kind of device), so minutes sent before the device had a key can be handed to it by hand.
 */
export async function mineEar(key: unknown, ua = ''): Promise<EarStored[] | null> {
  const owner = ownerOf(key)
  if (!owner) return null
  await mkdir(BY(), { recursive: true })
  try {
    await writeFile(join(BY(), `${owner}.txt`), '', { flag: 'wx' })
    await appendFile(join(BY(), 'seen.log'), `${new Date().toISOString()}\t${owner}\t${ua.replace(/\s+/g, ' ').slice(0, 120)}\n`)
  } catch {
    /* seen before */
  }
  const out: EarStored[] = []
  for (const id of await idsOf(owner)) {
    try {
      const j = JSON.parse(await readFile(join(DIR, `${id}.json`), 'utf8')) as { id: string; recording: EarRecording }
      out.push(describe(j.id, j.recording))
    } catch {
      /* gone or half-written: skip */
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at))
}

/** one of the device's own minutes: the recording, or null when it is not theirs */
export async function readMine(key: unknown, id: string): Promise<string | null> {
  const owner = ownerOf(key)
  if (!owner || !/^[\w-]+$/.test(id) || !(await idsOf(owner)).includes(id)) return null
  try {
    const j = JSON.parse(await readFile(join(DIR, `${id}.json`), 'utf8')) as { id: string; recording: EarRecording }
    return JSON.stringify({ id: j.id, recording: j.recording })
  } catch {
    return null
  }
}

/** the most minutes one search learns from */
const MAX_SEARCH = 12

/**
 * Every minute of the person a stored minute belongs to, oldest first, for the search that learns from all of
 * them: only minutes read the same way as that one (same kind of device). A minute sent without a key stands alone.
 * The camera-off daily minutes teach nothing and are left out, unless `daily` asks for them too (for "today
 * against the usual", which is read from the AirPods alone in every kind of minute).
 */
export async function minutesWith(id: string, daily = false): Promise<EarRecording[]> {
  const text = await readEar(id)
  if (!text) return []
  let own: EarRecording | null = null
  let owner: string | null = null
  try {
    const j = JSON.parse(text) as { recording?: unknown; owner?: unknown }
    own = checkEarRecording(j.recording)
    owner = typeof j.owner === 'string' && /^[a-f0-9]{40}$/.test(j.owner) ? j.owner : null
  } catch {
    return []
  }
  if (!own) return []
  const out: EarRecording[] = []
  if (owner) {
    for (const other of await idsOf(owner)) {
      if (other === id) continue
      try {
        const r = checkEarRecording((JSON.parse((await readEar(other)) ?? 'null') as { recording?: unknown } | null)?.recording)
        if (r && r.device.shell === own.device.shell && r.device.gyro === own.device.gyro && r.at !== own.at && (daily || r.kind !== 'daily')) out.push(r)
      } catch {
        /* gone or half-written: skip */
      }
    }
  }
  out.push(own)
  // a minute with most of its AirPods samples missing is left out once a full one has arrived
  return fullMinutes(out, own).sort((a, b) => a.at.localeCompare(b.at)).slice(-MAX_SEARCH)
}

export async function listEar(): Promise<EarStored[]> {
  let names: string[]
  try {
    names = (await readdir(DIR)).filter((n) => /^[\w-]+\.json$/.test(n)).sort()
  } catch {
    return []
  }
  const out: EarStored[] = []
  for (const n of names.slice(-200)) {
    try {
      const j = JSON.parse(await readFile(join(DIR, n), 'utf8')) as { id: string; recording: EarRecording }
      out.push(describe(j.id, j.recording))
    } catch {
      /* a half-written file: skip */
    }
  }
  return out
}

export async function readEar(id: string): Promise<string | null> {
  if (!/^[\w-]+$/.test(id)) return null
  try {
    return await readFile(join(DIR, `${id}.json`), 'utf8')
  } catch {
    return null
  }
}
