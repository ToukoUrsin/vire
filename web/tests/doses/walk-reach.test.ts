// bun test: the beat that leads only while the person keeps up, and the voice note's pitch reading.
import { describe, expect, test } from 'bun:test'
import { createStepCounter, leadBeat, startBeat, walkEndLine } from '../../src/app/doses/steps'
import { againstPing, pingSpread, pitchSpread, reachEndLine } from '../../src/app/doses/voiceNote'
import type { VoiceFrame } from '../../src/sense/types'

describe('steps and the beat', () => {
  test('the step rate is read from the bob of a walk', () => {
    const steps = createStepCounter()
    const hz = 104 / 60
    for (let t = 0; t < 12000; t += 20) steps.feed(t, 0.26 * Math.max(0, Math.sin(2 * Math.PI * hz * (t / 1000))) ** 3)
    expect(steps.cadence(12000)!).toBeGreaterThan(101)
    expect(steps.cadence(12000)!).toBeLessThan(107)
    expect(steps.cadence(16000)).toBeNull()
  })

  test('the beat moves ahead only while the person keeps up', () => {
    const beat = startBeat(100)
    for (let i = 0; i < 100; i++) leadBeat(beat, beat.spm, 0.1)
    expect(beat.spm).toBe(104)
    expect(beat.keptS).toBeCloseTo(10, 1)
  })

  test('it stops at a few steps a minute ahead', () => {
    const beat = startBeat(100)
    for (let i = 0; i < 1000; i++) leadBeat(beat, beat.spm, 0.1)
    expect(beat.spm).toBe(108)
  })

  test('it comes back when the person does not follow', () => {
    const beat = startBeat(100)
    for (let i = 0; i < 90; i++) leadBeat(beat, beat.spm, 0.1)
    const ahead = beat.spm
    expect(ahead).toBeGreaterThan(100)
    const kept = beat.keptS
    for (let i = 0; i < 25; i++) leadBeat(beat, 92, 0.1)
    expect(beat.spm).toBe(ahead)
    expect(beat.keptS).toBeCloseTo(kept, 5)
    for (let i = 0; i < 10; i++) leadBeat(beat, 92, 0.1)
    expect(beat.spm).toBe(92)
  })

  test('the end line says only what was measured', () => {
    expect(walkEndLine([102, 104, 106], 48.2, true)).toBe('You walked at 104 steps a minute and kept the beat for 48 seconds.')
    expect(walkEndLine([], 0, true)).toBe('I couldn’t feel your steps, so this was a fixed beat.')
    expect(walkEndLine([], 0, false)).toBe('No motion sensor here, so this was a fixed beat.')
  })
})

/** fifty frames a second of a voice whose pitch moves `st` semitones each way around 180 Hz */
function voice(st: number, seconds = 8): VoiceFrame[] {
  const out: VoiceFrame[] = []
  for (let t = 0; t < seconds * 1000; t += 20) {
    const voiced = t % 3000 < 2300
    const f0 = voiced ? 180 * 2 ** ((st * Math.sin(t / 400)) / 12) : null
    out.push({ t, rms: voiced ? -24 : -60, voiced, f0 })
  }
  return out
}

describe('the voice note', () => {
  test('pitch variation is the spread in semitones, not the highest over the lowest', () => {
    const spread = pitchSpread(voice(4))!
    expect(spread).toBeGreaterThan(2.4)
    expect(spread).toBeLessThan(3.2)
    expect(pitchSpread(voice(0))!).toBeLessThan(0.05)
  })

  test('too little voice gives no reading', () => {
    expect(pitchSpread(voice(4, 0.1))).toBeNull()
    expect(pitchSpread(voice(4).map((f) => ({ ...f, voiced: false, f0: null })))).toBeNull()
    expect(reachEndLine(true, null, null)).toBe('I heard the note, but too little of your voice to read its pitch.')
  })

  test('nothing recorded, nothing claimed', () => {
    expect(reachEndLine(false, null, 2.5)).toBe('No voice note today, so nothing was read.')
  })

  test('the comparison with the ping appears only when the ping read the voice', () => {
    expect(reachEndLine(true, 3.1, null)).toBe('Your voice moved 3.1 semitones.')
    expect(reachEndLine(true, 3.1, 2.6)).toBe('Your voice moved 3.1 semitones, a touch more than in your ping.')
    expect(againstPing(3.1, 3.0)).toBe('about the same as in your ping')
    expect(againstPing(1.2, 3.0)).toBe('less than in your ping')
  })

  test('the ping\'s own trace gives the same kind of number, or none', () => {
    const f0 = voice(4, 6).filter((_, i) => i % 5 === 0).map((f) => f.f0)
    expect(pingSpread(f0)!).toBeGreaterThan(2.4)
    expect(pingSpread(f0)!).toBeLessThan(3.2)
    expect(pingSpread([null, 180, 190])).toBeNull()
  })
})

describe('a walker who keeps their own pace', () => {
  test('the beat tries ahead, comes back, and waits longer before it tries again', () => {
    const beat = startBeat(98)
    const seen: number[] = []
    for (let i = 0; i < 400; i++) {
      leadBeat(beat, 98, 0.1)
      seen.push(beat.spm)
    }
    expect(Math.max(...seen)).toBe(102)
    expect(seen[seen.length - 1]).toBeLessThanOrEqual(102)
    // first try after 4 s with the beat, the next only after 8 s
    const firstUp = seen.indexOf(100)
    const back = seen.indexOf(98, firstUp)
    const secondUp = seen.indexOf(100, back)
    expect(firstUp).toBeGreaterThanOrEqual(39)
    expect(firstUp).toBeLessThanOrEqual(41)
    expect(secondUp - back).toBeGreaterThanOrEqual(79)
    expect(beat.keptS).toBeGreaterThan(25)
    expect(beat.keptS).toBeLessThan(40)
  })

  test('no steps felt: the beat holds and nothing is counted as kept', () => {
    const beat = startBeat(100)
    for (let i = 0; i < 100; i++) leadBeat(beat, null, 0.1)
    expect(beat.spm).toBe(100)
    expect(beat.keptS).toBe(0)
  })
})
