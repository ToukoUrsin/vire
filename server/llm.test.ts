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
})
