import { describe, expect, test } from 'bun:test'
import { breathRate, createBreathTracker, followsPace, stillness } from '../../src/tune/session/breath'
import { simulateSession } from '../../src/tune/session/simSession'

function noiseRows(seconds = 30, hz = 50): number[][] {
  let state = 17
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return ((state >>> 0) % 1_000_000) / 1_000_000 - 0.5 }
  const rows: number[][] = []
  for (let i = 0; i <= seconds * hz; i++) {
    const t = i * 1000 / hz
    rows.push([t, random() * 0.16, random() * 0.16, random() * 0.16, random() * 0.04, random() * 0.04, 1 + random() * 0.04, random() * 0.2, random() * 0.2, random() * 0.2])
  }
  return rows
}

describe('AirPods breathing reader', () => {
  test('reads 6 through 15 breaths/min at both supported demo rates', () => {
    for (const hz of [50, 25]) for (const pace of [6, 8, 10, 12, 15]) {
      const session = simulateSession({ seed: 10, durationMs: 30_000, hz, pace })
      const read = breathRate(session.head, 0, 30_000)
      expect(read.perMin).not.toBeNull()
      expect(Math.abs(read.perMin! - pace)).toBeLessThanOrEqual(1)
      expect(read.conf).toBeGreaterThan(0.3)
      expect(followsPace(session.head, 0, 30_000, pace).follows).toBe(true)
    }
  })

  test('returns null for noise, walking and too-short windows', () => {
    expect(breathRate(noiseRows(), 0, 30_000).perMin).toBeNull()
    const walking = simulateSession({ seed: 2, durationMs: 30_000, walking: true })
    expect(breathRate(walking.head, 0, 30_000).perMin).toBeNull()
    const short = simulateSession({ seed: 2, durationMs: 15_000 })
    expect(breathRate(short.head, 0, 15_000).perMin).toBeNull()
  })

  test('lock-in rejects a different pace and a still head', () => {
    const other = simulateSession({ seed: 3, durationMs: 30_000, pace: 13, follow: false, actualPace: 13 })
    expect(followsPace(other.head, 0, 30_000, 8).follows).toBe(false)
    expect(followsPace(noiseRows(), 0, 30_000, 8).follows).toBe(false)
  })

  test('live tracker converges after the twenty second minimum and emits a wave', () => {
    const session = simulateSession({ seed: 4, durationMs: 30_000, hz: 50, pace: 8 })
    const tracker = createBreathTracker()
    let last = { perMin: null as number | null, conf: 0, wave: 0, moveDegS: null as number | null }
    for (let i = 0; i < session.head.length; i++) { const row = session.head[i]!; tracker.push(row); if (i % 10 === 0) last = tracker.read(row[0]!) }
    expect(last.perMin).not.toBeNull()
    expect(Math.abs(last.perMin! - 8)).toBeLessThanOrEqual(1)
    expect(Math.abs(last.wave)).toBeLessThanOrEqual(1)
  })

  test('stillness is the mean angular speed, with gaps ignored', () => {
    const rows = [
      [0, 0, 0, 0, 0, 0, 1, 1, 0, 0],
      [100, 0, 0, 0, 0, 0, 1, 2, 0, 0],
      [200, 0, 0, 0, 0, 0, 1, 3, 0, 0],
      [1000, 0, 0, 0, 0, 0, 1, 100, 0, 0],
      [1100, 0, 0, 0, 0, 0, 1, 4, 0, 0],
    ]
    expect(stillness(rows, 0, 1100)).toBe(3)
  })
})
