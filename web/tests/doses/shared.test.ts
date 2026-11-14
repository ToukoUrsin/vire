import { describe, expect, test } from 'bun:test'
import { END_HOLD_MS, endHoldMs } from '../../src/app/doses/shared'

describe('how long an end line is held', () => {
  test('a short line gets the shortest hold', () => {
    expect(endHoldMs('One quiet minute. Nothing was measured.')).toBe(END_HOLD_MS)
  })

  test('the longest line a dose says can be read once, slowly', () => {
    const line = 'Your heart swung most at 5.5 breaths a minute: 12 beats, give or take 1. Tomorrow starts there.'
    expect(endHoldMs(line)).toBe(5400)
  })

  test('and no line holds the mini ping back for more than six seconds', () => {
    expect(endHoldMs('word '.repeat(60))).toBe(6000)
  })
})
