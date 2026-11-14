import { describe, expect, test } from 'bun:test'
import { readingText } from '../../src/app/echoText'

describe('patient data guards', () => {
  test('unknown channel is dropped and unknown status becomes calibrating', () => {
    expect(readingText({ channel: 'future-channel' as never, value: 3, unit: 'units', z: null, strength: 99, note: '' })).toBe('3 units.')
    expect(readingText({ channel: 'heart', value: null, unit: 'bpm', z: null, strength: 50, note: 'not read' })).toContain('not read')
  })

  test('known readings stay plain and bounded', () => {
    expect(readingText({ channel: 'smile', value: 3.54, unit: 'smile·s', z: null, strength: 50, note: '' })).toBe('A smile worth 3.5 s of a full smile.')
    expect(readingText({ channel: 'heart', value: 14.9, unit: 'bpm', z: null, strength: 50, note: '' })).toBe('Swung 15 beats a minute with your breath.')
  })
})
