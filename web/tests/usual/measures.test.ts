import { describe, expect, test } from 'bun:test'
import type { EarRecording } from '@shared/ear'
import { simulateTeach } from '../../src/tune/ear/sim'
import { earMeasures } from '../../src/tune/usual/measures'

describe('usual minute measures', () => {
  test('reads the scripted AirPods movement and scales smile size', () => {
    const small = earMeasures(simulateTeach({ seed: 1, smileSize: 0.5 }))
    const large = earMeasures(simulateTeach({ seed: 1, smileSize: 4 }))
    expect(small.asked).toBe(6)
    expect(large.asked).toBe(6)
    expect(large.smileDeg!).toBeGreaterThan(small.smileDeg!)
    expect(large.smiles).toBe(large.asked)
    expect(small.smiles).toBe(0)
    expect(large.nodHz).not.toBeNull()
    expect(large.nodDeg!).toBeGreaterThan(2)
    expect(large.shakeHz).not.toBeNull()
    expect(large.shakeDeg!).toBeGreaterThan(2)
  })

  test('does not turn sensor noise into smiles, nods or shakes', () => {
    const rec = simulateTeach({ seed: 4, noise: 0.12, smileSize: 0 })
    const head = rec.head.map((row, i) => [row[0], Math.sin(i * 2.7) * 0.12, Math.cos(i * 1.9) * 0.12, Math.sin(i * 3.1) * 0.12, 0, 0, 1, 0, 0, 0])
    const result = earMeasures({ ...rec, head })
    expect(result.smiles).toBe(0)
    expect(result.nodHz).toBeNull()
    expect(result.nodDeg).toBeNull()
    expect(result.shakeHz).toBeNull()
    expect(result.shakeDeg).toBeNull()
  })

  test('never reads camera or microphone rows', () => {
    const rec = simulateTeach({ seed: 2, smileSize: 3 })
    const blank: EarRecording = { ...rec, face: [], voice: [] }
    expect(earMeasures(blank)).toEqual(earMeasures(rec))
  })

  test('returns safe values for a short recording', () => {
    const rec = simulateTeach({ seed: 1 })
    const short: EarRecording = { ...rec, head: rec.head.slice(0, 2), steps: [] }
    const result = earMeasures(short)
    expect(result.at).toBe(rec.at)
    expect(result.smiles).toBe(0)
    expect(result.asked).toBe(0)
    expect(result.smileDeg).toBeNull()
    expect(result.nodHz).toBeNull()
    expect(result.shakeHz).toBeNull()
    expect(Number.isFinite(result.moveDegS)).toBe(true)
  })
})
