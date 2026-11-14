import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Channel, HallToday, HallPersonRow, HallChannelSummary } from '../shared/types'
import { CHANNELS } from '../shared/types'
import { UNITS } from './engine'
import { deviceFamily } from './wall'
import type { HallRow } from './db'

const HELSINKI_OFFSET = 2 * 3600_000
const DAY = 86400_000
const todayStart = (now: number) => Math.floor((now + HELSINKI_OFFSET) / DAY) * DAY - HELSINKI_OFFSET + 6 * 3600_000

export function hallDayStart(now = Date.now()): number {
  return todayStart(now)
}

export function hallRowValues(row: HallRow): Record<Channel, number | null> {
  const raw = JSON.parse(row.vals) as Partial<Record<Channel, number | null>>
  return Object.fromEntries(CHANNELS.map((ch) => [ch, typeof raw[ch] === 'number' && Number.isFinite(raw[ch]) ? raw[ch]! : null])) as Record<Channel, number | null>
}

export function hallIsCounted(row: HallRow, now = Date.now()): boolean {
  const t = Date.parse(row.started_at)
  if (row.via !== 'public' || !Number.isFinite(t) || t < todayStart(now) || t > now + 300_000) return false
  return CHANNELS.some((ch) => hallRowValues(row)[ch] != null)
}

const reasonFor = (row: HallRow, ch: Channel): string | undefined => {
  const unread = row.unreadable ? JSON.parse(row.unreadable) as Channel[] : []
  if (!unread.includes(ch)) return undefined
  if (ch === 'voice') return 'the hall is too loud'
  if (ch === 'heart') return 'pulse not read through one breath'
  if (ch === 'smile') return 'face not read'
  return 'nod not read'
}

function personRows(rows: HallRow[], now: number): HallPersonRow[] {
  const eligible = rows.filter((r) => hallIsCounted(r, now))
  const firstByUser = new Map<string, HallRow>()
  for (const row of eligible) if (!firstByUser.has(row.user_id)) firstByUser.set(row.user_id, row)
  return [...firstByUser.values()].map((row, i) => {
    const values = hallRowValues(row)
    const device = row.device ? JSON.parse(row.device) as { ua?: string; native?: boolean } : {}
    const family = deviceFamily(device.ua ?? '', device.native === true)
    const readings = Object.fromEntries(CHANNELS.map((ch) => [ch, {
      value: values[ch], unit: UNITS[ch], readable: values[ch] != null, reason: reasonFor(row, ch),
    }])) as HallPersonRow['readings']
    const seconds = Math.max(0, Math.round((Date.parse(row.created_at) - Date.parse(row.started_at)) / 1000))
    return { guest: i + 1, at: row.started_at, family: family === 'ios' ? 'iPhone Safari' : family === 'android' ? 'Android Chrome' : family === 'desktop' ? 'laptop' : family === 'native' ? 'iPhone app' : 'other', tune: hasTune(row), readings, seconds }
  })
}

function hasTune(row: HallRow): boolean {
  try {
    const f = JSON.parse(row.features) as { muscles?: unknown; faces?: unknown }
    return Array.isArray(f.muscles) || !!f.faces
  } catch { return false }
}

export function buildHallToday(rows: HallRow[], now = Date.now()): HallToday {
  const people = personRows(rows, now)
  const latest = new Map<string, HallRow>()
  for (const row of rows.filter((r) => hallIsCounted(r, now))) latest.set(row.user_id, row)
  const channels: HallChannelSummary[] = CHANNELS.map((channel) => {
    const values = [...latest.values()].map((row) => hallRowValues(row)[channel])
    const read = values.filter((v): v is number => v != null).sort((a, b) => a - b)
    const median = read.length ? read[Math.floor((read.length - 1) / 2)]! + (read.length % 2 ? 0 : read[read.length / 2]! - read[Math.floor((read.length - 1) / 2)]!) / 2 : null
    return { channel, unit: UNITS[channel], read: read.length, total: latest.size, median, min: read[0] ?? null, max: read.at(-1) ?? null, values: people.map((p) => p.readings[channel].value) }
  })
  return { count: people.length, generatedAt: new Date(now).toISOString(), channels, people }
}

export function countHallPeople(rows: HallRow[], now = Date.now()): number {
  return buildHallToday(rows, now).count
}

export function appendHallLog(row: HallRow, guest: number, now = Date.now()): void {
  const path = process.env.VIRE_HALL_LOG ?? '/bulk2/runs/depression/hall/hall.jsonl'
  const values = hallRowValues(row)
  const device = row.device ? JSON.parse(row.device) as { ua?: string; native?: boolean } : {}
  const family = deviceFamily(device.ua ?? '', device.native === true)
  let tune = false
  try { const f = JSON.parse(row.features) as { muscles?: unknown; faces?: unknown }; tune = Array.isArray(f.muscles) || !!f.faces } catch {}
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify({ time: row.created_at, guest, phone: family, tune, values, units: UNITS, unreadable: row.unreadable ? JSON.parse(row.unreadable) : [], seconds: Math.max(0, Math.round((Date.parse(row.created_at) - Date.parse(row.started_at)) / 1000)) })}\n`)
}
