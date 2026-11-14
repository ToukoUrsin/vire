// Seeds a TEST instance with a simulated hall, through the same API a phone uses. It refuses the live server.
//   PORT=8872 VIRE_DB=/tmp/wall.sqlite VIRE_WALL_LOCAL=1 VIRE_WALL_T0=<ISO, e.g. 30 h ago> VIRE_RATE=off VIRE_LLM=off bun index.ts &
//   bun wall-seed.ts http://127.0.0.1:8872 30        # 30 visitors spread over the hours since VIRE_WALL_T0
import type { Channel, WallState } from '../shared/types'
import { SIM_UA, simulateHall } from './wall'

const base = (process.argv[2] ?? '').replace(/\/$/, '')
const n = Number(process.argv[3] ?? 30)
const url = new URL(base || 'http://invalid')
if (!base || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.port === '8871' || url.port === '') {
  console.error('usage: bun wall-seed.ts http://127.0.0.1:<test port> <visitors>   (never the live server on 8871)')
  process.exit(1)
}

const before = (await (await fetch(`${base}/api/wall`)).json()) as WallState
const t0 = Date.parse(before.since)
const people = simulateHall(n, before.hoursIn)
const events = people.flatMap((v) => v.pings.map((p, i) => ({ v, p, first: i === 0 }))).sort((a, b) => a.p.h - b.p.h)
const ids = new Map<number, string>()

async function post<T>(path: string, body: unknown, ua: string): Promise<T> {
  const res = await fetch(`${base}/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': ua }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`)
  return (await res.json()) as T
}

for (const { v, p, first } of events) {
  const ua = SIM_UA[v.family]
  if (first) ids.set(v.n, (await post<{ userId: string }>('users', { visitor: true, name: v.nick ?? undefined }, ua)).userId)
  const val = (ch: Channel, missing: number) => p.values[ch] ?? missing
  await post(
    'pings',
    {
      userId: ids.get(v.n),
      kind: 'full',
      setting: 'home',
      startedAt: new Date(t0 + p.h * 3600_000).toISOString(),
      features: {
        smile: { latencyMs: 700, peak: 0.5, auc: val('smile', 0), duchenne: 0.3, durationMs: 2400, baseline: 0.1 },
        voice: { speechFraction: 0.6, pauseCount: 3, meanPauseMs: 420, f0MedianHz: 170, f0SdSemitones: val('voice', 0), loudnessSdDb: 5, syllableRateHz: 3.8 },
        heart: { restBpm: 70, swingBpm: val('heart', 0), quality: 0.8, source: v.family === 'native' ? 'airpods' : 'camera' },
        move: { nodAmplitudeDeg: 14, nodPeakVelDegS: val('move', 0), nodCount: 2, restlessness: 1.2, source: v.family === 'native' ? 'airpods' : 'camera' },
      },
      device: { ua, native: v.family === 'native', airpodsMotion: v.family === 'native', airpodsHr: v.family === 'native' },
      unreadable: (['smile', 'voice', 'heart', 'move'] as Channel[]).filter((ch) => p.values[ch] == null),
    },
    ua,
  )
}
const after = (await (await fetch(`${base}/api/wall`)).json()) as WallState
console.log(`seeded ${people.length} visitors, ${events.length} pings -> wall: ${after.visitors} visitors, ${after.pings} pings, ${after.returning} returning, ${after.hoursIn} h in`)
if (after.visitors - before.visitors !== people.length) console.error('the wall did not count them: is the instance running with VIRE_WALL_LOCAL=1?')
