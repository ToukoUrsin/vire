// bun test tests/tune: the tune step's engine (which face is asked for, when the count runs) driven by a synthetic person.
import { describe, expect, test } from 'bun:test'
import { TUNE_FACES } from '../../../shared/types'
import { FLOW_STEPS, TuneRun } from '../../src/tune/flow'
import { BLEND_NAMES, synthFace, synthImu } from './synth'
import type { SynthOpts } from './synth'

interface Person {
  /** ms between a new prompt and the face starting to change */
  react?: number
  /** faces this person never manages (TUNE_FACES index) */
  cannot?: number[]
  /** the camera loses the face between these times */
  away?: [number, number]
  synth?: SynthOpts
}

/** a person who reads each prompt, drops the old face, and makes the new one; returns what happened */
function play(seed: number, who: Person = {}, maxMs = 90_000) {
  const face = synthFace(seed, who.synth)
  const run = new TuneRun()
  const asked: string[] = []
  let ended = -1
  let changedAt = 0
  let from = 0
  let to = 0
  let t = 1000
  run.onStep = (_i, step) => {
    asked.push(step.face)
    from = to
    to = who.cannot?.includes(TUNE_FACES.indexOf(step.face)) ? 0 : TUNE_FACES.indexOf(step.face)
    changedAt = t
  }
  run.onEnd = () => {
    ended = t
  }
  run.begin()
  const react = who.react ?? 700
  const states: Record<string, number> = {}
  /** per step: the mean of what the map showed for the smile group while the face was held */
  const lit: number[] = []
  const held: number[] = []
  for (; t < maxMs && ended < 0; t += 33.3) {
    const since = t - changedAt - react
    // 250 ms to let go of the old face, 400 ms to make the new one
    const f = since < 0 ? face.frame(t, from, 1) : since < 250 ? face.frame(t, from, 1 - since / 250) : face.frame(t, to, Math.min(1, (since - 250) / 400))
    if (who.away && t >= who.away[0] && t < who.away[1]) f.present = false
    run.face(f, BLEND_NAMES)
    states[run.state] = (states[run.state] ?? 0) + 1
    if (run.state === 'hold' && run.muscles.length) {
      lit[run.index] = (lit[run.index] ?? 0) + run.muscles[0]
      held[run.index] = (held[run.index] ?? 0) + 1
    }
  }
  return { run, asked, took: ended < 0 ? Infinity : ended - 1000, states, lit: lit.map((v, i) => v / held[i]) }
}

describe('tune flow', () => {
  test('a person who follows the prompts is through in well under a minute, with a model that checks out', () => {
    const { run, asked, took } = play(1)
    expect(asked).toEqual(FLOW_STEPS.map((s) => s.face))
    expect(took).toBeLessThan(40_000)
    expect(run.state).toBe('done')
    // the first rest starts counting as soon as a face has been there for a moment (it once sat out the whole timeout)
    expect(run.rec.samples[0].t).toBeLessThan(2000)
    expect(run.late.filter(Boolean).length).toBe(0)
    const m = run.train()
    expect(m.holdout).toBe('lap')
    expect(m.accuracy).toBeGreaterThan(0.95)
    expect(m.clf!.classes).toEqual([0, 1, 2, 3, 4])
    // only frames with the face held were kept: the smile range is the person's real one (0.22 above rest)
    expect(m.calibration.smile[1]).toBeGreaterThan(0.2)
    expect(m.calibration.smile[1]).toBeLessThan(0.3)
    for (const r of m.muscles!.slice(0, 5)) expect(r.weak).toBeUndefined()
    console.log(`flow: ${(took / 1000).toFixed(1)} s for a person who reacts in 0.7 s, ${run.rec.samples.length} frames kept, held-out ${m.accuracy}`)
  })

  test('the count waits for the face: a slow person is not recorded while still resting', () => {
    const { run, took } = play(2, { react: 2200 })
    expect(took).toBeLessThan(60_000)
    const m = run.train()
    expect(m.accuracy).toBeGreaterThan(0.95)
    expect(run.late.filter(Boolean).length).toBe(0)
  })

  test('nothing counts while no face is in view', () => {
    const { run, states, took } = play(3, { away: [0, 8000] })
    expect(states.look).toBeGreaterThan(200)
    expect(took).toBeGreaterThan(8000)
    expect(run.rec.samples.every((s) => s.t >= 8000)).toBe(true)
    // and a face that leaves in the middle of a hold pauses it
    const mid = play(4, { away: [2000, 6000] })
    expect(mid.run.rec.samples.some((s) => s.t > 2000 && s.t < 6000)).toBe(false)
    expect(mid.run.state).toBe('done')
  })

  test('with no face at all the step never starts counting', () => {
    const { run, took } = play(5, { away: [0, Infinity] }, 20_000)
    expect(took).toBe(Infinity)
    expect(run.index).toBe(0)
    expect(run.progress).toBe(0)
    expect(run.rec.samples.length).toBe(0)
  })

  test('a face the person cannot make times out instead of trapping them, and the model says so', () => {
    const { run, took } = play(6, { cannot: [2] })
    expect(run.state).toBe('done')
    expect(took).toBeLessThan(60_000)
    expect(run.late[2]).toBe(true)
    expect(run.late[7]).toBe(true)
    const m = run.train()
    expect(m.muscles![4].weak).toBe(true)
    // the face that never showed is left out and named, not learned as a second word for the resting face
    expect(m.missed).toEqual(['sad'])
    expect(m.clf!.classes).toEqual([0, 1, 3, 4])
    expect(m.perFace!.sad).toBeUndefined()
    expect(m.accuracy).toBeGreaterThan(0.95)
  })

  test('a small smile lights the map fully on its first take, and stays dark at rest and on other faces', () => {
    // this person's biggest smile is 0.15 above rest (the real man in the clips: 0.17), a quarter of a typical range
    const { lit, run } = play(10, { synth: { strength: [1, 0.7, 1, 1, 1] } })
    expect(run.state).toBe('done')
    console.log(`small smile: the map showed ${lit.map((v) => v.toFixed(2)).join(' ')} for the smile group, step by step`)
    expect(lit[1]).toBeGreaterThan(0.8) // the first smile, drawn against its own biggest so far
    expect(lit[0]).toBeLessThan(0.15) // the first rest
    expect(lit[3]).toBeLessThan(0.3) // brows lowered: no smile shown
    expect(lit[6]).toBeGreaterThan(0.6) // the second smile, drawn against the range found on the first
  })

  test('works on frames without detail (the scripted demo sense)', () => {
    const { run, took } = play(7, { synth: { detail: false } })
    expect(run.state).toBe('done')
    expect(took).toBeLessThan(60_000)
    const m = run.train()
    expect(m.kind).toBe('basic')
    expect(m.calibration.smile[1]).toBeGreaterThan(0.2)
  })

  test('AirPods frames are kept for the ear model, camera head frames are not', () => {
    const run = new TuneRun()
    const face = synthFace(8)
    run.begin()
    const head = synthImu(8, { smile: 1 })
    let hi = 0
    for (let t = 0; t < 6000; t += 33.3) {
      run.face(face.frame(t, 0, 1), BLEND_NAMES)
      while (hi < head.length && head[hi].t <= t) run.head(head[hi++])
      run.head({ t, pitch: 0, yaw: 0, roll: 0, ax: 0, ay: 0, az: 0, source: 'camera' })
    }
    expect(run.hasAirpods).toBe(true)
    expect(run.rec.head.length).toBe(hi)
    expect(run.rec.head.every((h) => h.source === 'airpods')).toBe(true)
  })
})
