import { describe, expect, test } from 'bun:test'
import { unlink } from 'node:fs/promises'
import { DAILY_QUESTIONS, dailyForTest } from './daily'

describe('daily media checks', () => {
  test('questions avoid private health topics', () => {
    const banned = /mood|health|sleep|treatment|past year|depress|therapy|symptom/i
    expect(DAILY_QUESTIONS.length).toBeGreaterThanOrEqual(30)
    expect(DAILY_QUESTIONS.every((q) => !banned.test(q))).toBe(true)
  })

  test('rejects silence and wrong length', async () => {
    const silence = `/tmp/vire-silent-${process.pid}.mp3`
    const short = `/tmp/vire-short-${process.pid}.mp3`
    await Bun.spawn(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '10', silence]).exited
    await Bun.spawn(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', short]).exited
    await expect(dailyForTest.inspect(silence, 8, 12)).rejects.toThrow()
    await expect(dailyForTest.inspect(short, 8, 12)).rejects.toThrow()
    await unlink(silence).catch(() => {})
    await unlink(short).catch(() => {})
  })
})
