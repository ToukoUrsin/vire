import { describe, expect, test } from 'bun:test'
import { acceptable } from './llm'

describe('LLM polish guard', () => {
  test('rejects a mocked reply that adds a number and keeps the draft', () => {
    const draft = 'Your echo is 50 today.'
    const mockedReply = 'Your echo is 50 today, after 3 pings.'
    expect(acceptable('patient', mockedReply, draft)).toBe(false)
    expect(draft).toBe('Your echo is 50 today.')
  })
  test('keeps every figure from a valid reply', () => {
    expect(acceptable('patient', 'Your echo is 50 today.', 'Your echo is 50 today.')).toBe(true)
  })
  test('a clinic line may not bring back the camera-check words the draft did not use', () => {
    const draft = 'Below their usual for 12 days; head down longer and less head movement; AirPods in today'
    const input = JSON.stringify({ facts: {}, draft })
    expect(acceptable('reason', 'Below their usual for 12 days, with head down longer and less head movement; AirPods in today', input)).toBe(true)
    expect(acceptable('reason', 'Echo below the well signature for 12 days, head down longer; AirPods in today', input)).toBe(false)
    const cam = JSON.stringify({ facts: {}, draft: 'Below their usual for 6 days; smile and voice both below their usual; last camera check yesterday' })
    expect(acceptable('reason', 'Smile and voice below their usual for 6 days; last camera check yesterday', cam)).toBe(true)
  })
})
