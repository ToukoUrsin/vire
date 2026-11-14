// "Watch a run" (#/watch): one stored session as a replay bundle (shared/earreplay.ts). The numbers come from the
// readers the phone and the clinic already use (readSession, earMeasures, learn); this file only picks rows and
// thins them out for drawing. Which session is public is the worker's choice, kept in a small file next to the
// sessions (on a volume in production). Until one is picked, the scripted run in replay-scripted.json is served.
//
// Making replay-scripted.json again: run the real Today flow with the stand-in AirPods on a test stack
// (`node web/tests/e2e/watch.mjs --make ...`, see its header), then
//   cd server && VIRE_EAR_DIR=<that stack's ear dir> bun earreplay.ts <session id>
import { readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { earMeasures } from '../shared/earday'
import type { EarRecording } from '../shared/ear'
import { learn } from '../shared/earlearn'
import { REPLAY_REAL, REPLAY_RECORDED, REPLAY_SCRIPTED } from '../shared/earreplay'
import type { ReplayBundle } from '../shared/earreplay'
import type { EarSessionRec } from '../shared/earsession'
import { readSession } from '../shared/earsessionread'
import type { SessionRead } from '../shared/earsessionread'
import { plainSource, readSessionFile } from './earsessions'
import type { SessionKept } from './earsessions'

const DIR = () => join(process.env.VIRE_EAR_DIR || '/bulk2/runs/depression/ear/recordings/', 'sessions')
/** not `.json`: the sessions folder's `.json` files are sessions, and the newest of them is the clinic's practice */
const PICK = () => join(DIR(), 'replay.pick')
const SCRIPTED = join(import.meta.dir, 'replay-scripted.json')

/** head movement over time: how much the head moved (degrees a second, as the checks read it) in a 1.5 s window, twice a second */
function moveOf(s: EarSessionRec, t0: number, t1: number): [number, number][] {
  const out: [number, number][] = []
  let i0 = 0
  for (let t = t0; t <= t1; t += 500) {
    while (i0 < s.head.length && s.head[i0][0] < t - 750) i0++
    let i1 = i0
    while (i1 < s.head.length && s.head[i1][0] < t + 750) i1++
    if (i1 - i0 < 10) continue
    const part: EarRecording = {
      v: 1,
      at: s.at,
      userId: null,
      device: { shell: s.device.shell, gyro: s.device.gyro, hz: s.device.hz, ua: '' },
      head: s.head.slice(i0, i1),
      face: [],
      voice: [],
      steps: [],
    }
    out.push([t, Math.round(earMeasures(part).moveDegS * 100) / 100])
  }
  return out
}

/** at most `perS` rows a second: the first row of each slot */
export function thin<T extends number[]>(rows: T[], perS: number): T[] {
  const slot = 1000 / perS
  const out: T[] = []
  let last = -Infinity
  for (const r of rows) {
    const k = Math.floor(r[0] / slot)
    if (k === last) continue
    last = k
    out.push(r)
  }
  return out
}

/** the person's practices up to and including this one, as the server keeps them (by/<owner>.jsonl) */
async function keptUpTo(owner: string | null, at: string, self: SessionKept): Promise<SessionKept[]> {
  if (!owner || !/^[\w-]+$/.test(owner)) return [self]
  try {
    const lines = (await readFile(join(DIR(), 'by', `${owner}.jsonl`), 'utf8')).split('\n').filter(Boolean)
    const all = lines.map((l) => JSON.parse(l) as SessionKept).filter((s) => s.heartSources !== undefined && s.at <= at && s.id !== self.id)
    return [...all, self].sort((a, b) => a.at.localeCompare(b.at)).slice(-200)
  } catch {
    return [self]
  }
}

export function buildReplay(file: { id: string; session: EarSessionRec; owner?: string | null }, how: { real: boolean; scripted: boolean }, history?: SessionKept[]): ReplayBundle {
  const s = file.session
  const r: SessionRead = readSession(s)
  const read: SessionRead & { id: string } = { id: file.id, ...r, heartSources: how.scripted ? ['a stand-in'] : r.heartSources.map(plainSource) }
  const sessions = history ?? [read]
  const learned = learn(sessions.map((x) => ({ kind: x.kind, settle: x.happened === false ? null : x.settle, at: x.at })))
  const before = s.phases.find((p) => p.name === 'before')
  const after = s.phases.find((p) => p.name === 'after')
  const t0 = before?.t0 ?? 0
  const t1 = after?.t1 ?? (s.head.length ? s.head[s.head.length - 1][0] : 0)
  const heartRows: number[][] = r.heartFrom === 'airpods' ? s.airHr.filter((x) => x[1] > 0) : r.heartFrom === 'camera' ? s.pulse.filter((x) => x[2] >= 0.5 && x[1] > 0).map((x) => [x[0], x[1]]) : []
  const m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)/.exec(file.id)
  return {
    v: 1,
    real: how.real,
    scripted: how.scripted,
    label: how.real ? REPLAY_REAL : how.scripted ? REPLAY_SCRIPTED : REPLAY_RECORDED,
    id: file.id,
    at: s.at,
    kind: s.kind,
    phases: s.phases,
    steps: s.steps,
    breaths: s.breaths,
    checks: (s.adapt ?? []).map((a) => ({ t: a.t, from: a.from, to: a.to, follows: a.follows, by: a.by })),
    heart: { from: r.heartFrom, rows: thin(heartRows, 10).map((x) => [x[0], x[1]] as [number, number]) },
    move: moveOf(s, t0, t1),
    sound: s.sound,
    read,
    seen: {
      id: file.id,
      arrivedAt: m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : Date.parse(s.at) || 0,
      // the scripted run is the clinic screen's demo: it says "demo signals, a script made this practice"
      shell: how.scripted ? 'sim' : s.device.shell,
      read,
      learned,
      practices: sessions.length,
      pieces: { set: s.sound.filter((x) => x.made === 'set').length, live: s.sound.filter((x) => x.made === 'live').length },
    },
  }
}

let scripted: ReplayBundle | null = null
async function scriptedBundle(): Promise<ReplayBundle | null> {
  if (scripted) return scripted
  try {
    scripted = JSON.parse(await readFile(SCRIPTED, 'utf8')) as ReplayBundle
    return scripted
  } catch {
    return null
  }
}

/** the public replay: the worker's pick, or the scripted run */
export async function currentReplay(): Promise<ReplayBundle | null> {
  try {
    const pick = JSON.parse(await readFile(PICK(), 'utf8')) as { id: string; real: boolean }
    const got = await replayOf(pick.id, pick.real === true)
    if (got) return got
  } catch {
    /* nothing picked */
  }
  return scriptedBundle()
}

async function replayOf(id: string, real: boolean): Promise<ReplayBundle | null> {
  const text = await readSessionFile(id)
  if (!text) return null
  const file = JSON.parse(text) as { id: string; session: EarSessionRec; owner: string | null }
  const self: SessionKept = { id: file.id, ...readSession(file.session), heartSources: [] }
  return buildReplay(file, { real, scripted: false }, await keptUpTo(file.owner, file.session.at, self))
}

/** the worker picks a stored session; `real` only because the worker says so */
export async function pickReplay(body: { id?: unknown; real?: unknown } | null): Promise<ReplayBundle | null> {
  const id = typeof body?.id === 'string' ? body.id : ''
  const got = id ? await replayOf(id, body?.real === true) : null
  if (!got) return null
  await mkdir(DIR(), { recursive: true })
  await writeFile(PICK(), JSON.stringify({ id, real: body?.real === true, at: new Date().toISOString() }))
  return got
}

export async function clearReplay(): Promise<void> {
  await rm(PICK(), { force: true })
}

if (import.meta.main) {
  const id = process.argv[2]
  const text = id ? await readSessionFile(id) : null
  if (!text) throw new Error(`no stored session ${id}`)
  const file = JSON.parse(text) as { id: string; session: EarSessionRec }
  const b = buildReplay(file, { real: false, scripted: true })
  await writeFile(SCRIPTED, JSON.stringify(b))
  console.log(`wrote ${SCRIPTED}: ${JSON.stringify(b).length} bytes, ${b.breaths.length} breaths, ${b.checks.length} checks`)
}
