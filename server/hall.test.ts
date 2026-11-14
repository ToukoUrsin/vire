import { describe, expect, test } from 'bun:test'
import { countHallPeople } from './hall'
import type { HallRow } from './db'

const row = (id: string, at: string, via = 'public', vals = '{"smile":1,"voice":null,"heart":8,"move":null}'): HallRow => ({
  id, user_id: id, name: `guest ${id}`, started_at: at, created_at: at, vals, features: '{}', device: JSON.stringify({ ua: 'iPhone' }), via, unreadable: null, step_readings: null,
})

describe('hall count', () => {
  test('counts unique real devices today with one readable channel', () => {
    const now = Date.parse('2026-11-14T12:00:00Z')
    expect(countHallPeople([
      row('a', '2026-11-14T05:00:00Z'),
      row('a', '2026-11-14T05:01:00Z'),
      row('b', '2026-11-14T05:02:00Z', 'test'),
      row('c', '2026-11-14T03:00:00Z'),
      row('d', '2026-11-14T06:00:00Z', 'public', '{"smile":null,"voice":null,"heart":null,"move":null}'),
    ], now)).toBe(1)
  })
})
