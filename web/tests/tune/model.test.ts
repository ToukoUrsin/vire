// bun test tests/tune: the personal face model against synthetic faces and synthetic AirPods motion with known answers.
import { beforeEach, describe, expect, test } from 'bun:test'
import { MUSCLES, TUNE_FACES } from '../../../shared/types'
import type { HeadFrame } from '../../src/sense/types'
import { ND, Observer, createReader, trainModel } from '../../src/tune/model'
import type { PersonalModel, Sample, TuneRecording } from '../../src/tune/model'
import { clearModel, loadModel, saveModel } from '../../src/tune/store'
import { BLEND_NAMES, TIMELINE, TIMELINE_END, faceAt, synthFace, synthImu } from './synth'
import type { SynthOpts } from './synth'

/** runs the tune timeline at 30 fps through the same Observer the app uses */
function record(seed: number, opts: SynthOpts = {}, head: HeadFrame[] = [], only?: (lap: number, face: number) => boolean): TuneRecording {
  const face = synthFace(seed, opts)
  const obs = new Observer()
  const rec: TuneRecording = { samples: [], smile: { t: [], v: [] }, head }
  for (let t = 0; t <= TIMELINE_END; t += 33.3) {
    const at = faceAt(t)
    const f = face.frame(t, at.face, at.amount)
    const x = obs.observe(f, BLEND_NAMES)!
    rec.smile.t.push(t)
    rec.smile.v.push(f.smile)
    if (at.hold && (!only || only(at.lap, at.face))) rec.samples.push({ t, x: Float32Array.from(x), face: at.face, lap: at.lap })
  }
  rec.k = obs.aspect.k
  return rec
}

const M = (name: (typeof MUSCLES)[number]) => MUSCLES.indexOf(name)

describe('training', () => {
  test('learns the ranges and the five faces from 40 s of posed faces, fast', () => {
    const rec = record(1)
    const t0 = performance.now()
    const m = trainModel(rec)
    const ms = performance.now() - t0
    expect(ms).toBeLessThan(1000) // about 100 ms on an idle machine
    expect(m.kind).toBe('detail')
    expect(m.holdout).toBe('lap')
    expect(m.accuracy).toBeGreaterThan(0.95)
    for (const f of TUNE_FACES) expect(m.perFace![f]).toBeGreaterThan(0.9)
    // this person's biggest smile is only 0.24 on the model's scale: the range must say so
    expect(m.calibration.smile[0]).toBeCloseTo(0.02, 1)
    expect(m.calibration.smile[1]).toBeGreaterThan(0.2)
    expect(m.calibration.smile[1]).toBeLessThan(0.3)
    expect(m.calibration.brow[1]).toBeGreaterThan(0.4)
    expect(m.muscles!.length).toBe(MUSCLES.length)
    for (const r of m.muscles!.slice(0, 5)) expect(r.weak).toBeUndefined()
    expect(m.k).toBeCloseTo(4 / 3, 2)
    expect(JSON.stringify(m).length).toBeLessThan(50_000)
    console.log(`trained in ${ms.toFixed(0)} ms on ${m.frames} frames, ${JSON.stringify(m).length} bytes, held-out ${m.accuracy}`)
  })

  test('ranges are robust: one wild frame does not become the maximum', () => {
    const rec = record(2)
    const smile = rec.samples.find((s) => s.face === 1)!
    const idx = 7 // the smile pair in the observation
    const before = trainModel(rec).calibration.smile[1]
    smile.x[idx] = 0.95
    expect(trainModel(rec).calibration.smile[1]).toBeCloseTo(before, 1)
  })

  test('the reader gives 0 at rest and about 1 at the person own biggest, and reads the face', () => {
    const m = trainModel(record(3))
    const reader = createReader(m)
    const face = synthFace(99)
    const mean = (which: number, amount: number) => {
      const acc = new Array(MUSCLES.length).fill(0)
      let label = ''
      for (let i = 0; i < 30; i++) {
        const out = reader.face(face.frame(100000 + which * 5000 + i * 33, which, amount), BLEND_NAMES)
        out.muscles.forEach((v, j) => (acc[j] += v / 30))
        label = out.face?.label ?? 'none'
      }
      return { muscles: acc, label }
    }
    const rest = mean(0, 1)
    for (const v of rest.muscles) expect(v).toBeLessThan(0.2)
    expect(rest.label).toBe('rest')
    const smile = mean(1, 1)
    expect(smile.muscles[M('smile')]).toBeGreaterThan(0.8)
    expect(smile.muscles[M('cheek')]).toBeGreaterThan(0.7)
    expect(smile.muscles[M('browDown')]).toBeLessThan(0.2)
    expect(smile.label).toBe('smile')
    expect(mean(1, 0.5).muscles[M('smile')]).toBeGreaterThan(0.3)
    expect(mean(1, 0.5).muscles[M('smile')]).toBeLessThan(0.7)
    const sad = mean(2, 1)
    expect(sad.muscles[M('frown')]).toBeGreaterThan(0.7)
    expect(sad.label).toBe('sad')
    const angry = mean(3, 1)
    expect(angry.muscles[M('browDown')]).toBeGreaterThan(0.8)
    expect(angry.muscles[M('browUp')]).toBeLessThan(0.2)
    expect(angry.label).toBe('angry')
    const surprised = mean(4, 1)
    expect(surprised.muscles[M('browUp')]).toBeGreaterThan(0.8)
    expect(surprised.muscles[M('jaw')]).toBeGreaterThan(0.2)
    expect(surprised.label).toBe('surprised')
  })

  test('turning the head does not change what the landmarks say', () => {
    const m = trainModel(record(4))
    const reader = createReader(m)
    const turned = synthFace(5, { yawDeg: 14 })
    let frown = 0
    let label = ''
    for (let i = 0; i < 30; i++) {
      const out = reader.face(turned.frame(i * 33, 0), BLEND_NAMES)
      frown += out.muscles[M('frown')] / 30
      label = out.face?.label ?? 'none'
    }
    expect(frown).toBeLessThan(0.25)
    expect(label).toBe('rest')
  })
})

describe('honest hold-out', () => {
  test('a face the person only managed the first time is caught by the second take', () => {
    // second take: the "sad" face is not really made (0.1 of the first)
    const face = synthFace(6)
    const obs = new Observer()
    const samples: Sample[] = []
    for (let t = 0; t <= TIMELINE_END; t += 33.3) {
      const at = faceAt(t)
      const weak = at.face === 2 && at.lap > 0 ? 0.1 : 1
      const x = obs.observe(face.frame(t, at.face, at.amount * weak), BLEND_NAMES)!
      if (at.hold) samples.push({ t, x: Float32Array.from(x), face: at.face, lap: at.lap })
    }
    const m = trainModel({ samples, smile: { t: [], v: [] }, head: [] })
    expect(m.holdout).toBe('lap')
    expect(m.heldOut).toBe(samples.filter((s) => s.lap > 0).length)
    expect(m.perFace!.sad).toBeLessThan(0.3)
    expect(m.accuracy).toBeLessThan(0.9)
    expect(m.accuracy).toBeGreaterThan(0.6)

    // the same frames split at random would have looked fine: neighbours of every test frame are in the training set
    const shuffled = samples.map((s, i) => ({ ...s, lap: i % 3 === 0 ? 1 : 0 }))
    expect(trainModel({ samples: shuffled, smile: { t: [], v: [] }, head: [] }).accuracy).toBeGreaterThan(m.accuracy + 0.05)
  })

  test('a single take is checked on its last part, and says so', () => {
    const m = trainModel(record(7, {}, [], (lap) => lap === 0))
    expect(m.holdout).toBe('block')
    expect(m.heldOut).toBeGreaterThan(100)
    expect(m.accuracy).toBeGreaterThan(0.9)
  })

  test('a missing face is left out, not invented', () => {
    const m = trainModel(record(8, {}, [], (_lap, face) => face !== 2))
    expect(m.clf!.classes).toEqual([0, 1, 3, 4])
    expect(m.perFace!.sad).toBeUndefined()
    expect(m.muscles![M('frown')].weak).toBe(true)
    expect(m.accuracy).toBeGreaterThan(0.9)
  })

  test('a face that never showed is left out and named; one that showed on the first take only is not', () => {
    const m = trainModel(record(9, { strength: [1, 1, 0.05, 1, 1] }))
    expect(m.missed).toEqual(['sad'])
    expect(m.clf!.classes).toEqual([0, 1, 3, 4])
    expect(m.accuracy).toBeGreaterThan(0.95)
    expect(m.frames).toBeGreaterThan(m.heldOut! * 2)
    const out = createReader(m).face(synthFace(9).frame(0, 2), BLEND_NAMES)
    expect(out.face?.label).not.toBe('sad')
    expect(trainModel(record(10)).missed).toBeUndefined()
  })

  test('a read needs its own muscle group behind it: a left-out face is not read as the nearest learned one', () => {
    const m = trainModel(record(11, { strength: [1, 1, 1, 1, 0.05] }))
    expect(m.missed).toEqual(['surprised'])
    const reader = createReader(m)
    const face = synthFace(11)
    const seen: Record<string, number> = {}
    for (let t = 0; t < 2000; t += 33.3) {
      const out = reader.face(face.frame(t, 4, 1), BLEND_NAMES)
      const label = out.face?.label ?? 'unsure'
      seen[label] = (seen[label] ?? 0) + 1
      // never a smile with the smile group flat, never lowered brows with the brow group flat
      if (out.face?.label === 'smile') expect(out.muscles[M('smile')]).toBeGreaterThanOrEqual(0.15)
      if (out.face?.label === 'angry') expect(out.muscles[M('browDown')]).toBeGreaterThanOrEqual(0.15)
    }
    expect(seen.surprised).toBeUndefined()
    // and the faces it did learn still read
    const smile = createReader(m).face(face.frame(0, 1, 1), BLEND_NAMES)
    expect(smile.face?.label).toBe('smile')
  })

  test('no frames at all still gives a usable model object', () => {
    const m = trainModel({ samples: [], smile: { t: [], v: [] }, head: [] })
    expect(m.accuracy).toBe(0)
    expect(m.clf).toBeNull()
    expect(m.earAccuracy).toBeNull()
    const out = createReader(m).face(synthFace(1).frame(0, 1), BLEND_NAMES)
    expect(out.muscles.length).toBe(MUSCLES.length)
    expect(out.face).toBeNull()
  })
})

describe('ear model', () => {
  test('learns a smile-locked AirPods signal and reports it on later smiles', () => {
    const head = synthImu(11, { smile: 1 })
    const m = trainModel(record(11, {}, head))
    expect(m.earCheck).not.toBeNull()
    expect(m.earCheck!.smiles).toBe(3)
    expect(m.earAccuracy).not.toBeNull()
    expect(m.earAccuracy!).toBeGreaterThan(0.8)
    expect(m.earAccuracy!).toBeGreaterThan(m.earCheck!.chance)
    // the reader, on fresh motion: high while smiling, low otherwise
    const reader = createReader(m)
    let on = 0
    let nOn = 0
    let off = 0
    let nOff = 0
    for (const h of synthImu(12, { smile: 1 })) {
      const p = reader.head(h)
      if (p === null) continue
      const [, , from, to] = TIMELINE[1]
      if (h.t > from + 600 && h.t < to) {
        on += p
        nOn++
      } else if (h.t > 9000 && h.t < 20000) {
        off += p
        nOff++
      }
    }
    expect(on / nOn).toBeGreaterThan(0.7)
    expect(off / nOff).toBeLessThan(0.3)
    console.log(`ear: held-out ${m.earAccuracy}, chance level ${m.earCheck!.chance}, reader ${(on / nOn).toFixed(2)} smiling vs ${(off / nOff).toFixed(2)} not`)
  })

  test('works from attitude alone when the shell sends no rotation rate', () => {
    const m = trainModel(record(13, {}, synthImu(13, { smile: 1.5, gyro: false })))
    expect(m.ear?.gyro).toBe(false)
    expect(m.earAccuracy!).toBeGreaterThan(0.75)
  })

  test('comes out null when the motion carries no smile', () => {
    const got: string[] = []
    for (let seed = 20; seed < 32; seed++) {
      const m = trainModel(record(seed, {}, synthImu(seed, { smile: 0 })))
      got.push(`${m.earCheck?.accuracy ?? '-'}/${m.earCheck?.chance ?? '-'}`)
      expect(m.earAccuracy).toBeNull()
      expect(m.ear).toBeNull()
      expect(createReader(m).head(synthImu(seed, { smile: 0 })[100])).toBeNull()
    }
    console.log('no signal, accuracy/chance per seed:', got.join(' '))
  }, 30000)

  test('a faint signal is hidden rather than oversold', () => {
    const m = trainModel(record(40, {}, synthImu(40, { smile: 0.08 })))
    if (m.earAccuracy !== null) expect(m.earAccuracy).toBeGreaterThanOrEqual(0.7)
    else expect(m.ear).toBeNull()
  })

  test('camera head frames never train an ear model', () => {
    const m = trainModel(record(14, {}, synthImu(14, { smile: 1, source: 'camera' })))
    expect(m.earAccuracy).toBeNull()
    expect(m.earCheck).toBeNull()
  })
})

describe('storage', () => {
  beforeEach(() => {
    const mem = new Map<string, string>()
    ;(globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    }
  })

  test('save / load round trip keeps the model working', () => {
    const m = trainModel(record(15, {}, synthImu(15, { smile: 1 })))
    expect(loadModel()).toBeNull()
    saveModel(m)
    const back = loadModel()!
    expect(back).toEqual(JSON.parse(JSON.stringify(m)) as PersonalModel)
    expect((localStorage.getItem('vire.model') ?? '').length).toBeLessThan(50_000)
    const a = createReader(m)
    const b = createReader(back)
    const face = synthFace(16)
    for (let i = 0; i < 20; i++) {
      const f = face.frame(i * 33, i < 10 ? 1 : 3)
      expect(b.face(f, BLEND_NAMES)).toEqual(a.face(f, BLEND_NAMES))
    }
    for (const h of synthImu(17, { smile: 1 }).slice(0, 80)) expect(b.head(h)).toEqual(a.head(h))
    clearModel()
    expect(loadModel()).toBeNull()
  })

  test('junk in storage is ignored', () => {
    localStorage.setItem('vire.model', '{"version":2}')
    expect(loadModel()).toBeNull()
    localStorage.setItem('vire.model', 'not json')
    expect(loadModel()).toBeNull()
  })
})

describe('reader without detail', () => {
  const basic = (smile: number, brow = 0.03) => ({ t: 0, present: true, smile, cheek: 0.3, brow, jawOpen: 0.4, blink: 0.1, pitch: 0, yaw: 0, roll: 0 })

  test('no model: population ranges, MUSCLES order, no face read', () => {
    const r = createReader(null)
    const out = r.face(basic(0.31), [])
    expect(out.muscles.length).toBe(MUSCLES.length)
    expect(out.muscles[M('smile')]).toBeCloseTo(0.5, 1)
    expect(out.muscles[M('jaw')]).toBeGreaterThan(0.5)
    expect(out.muscles[M('browUp')]).toBe(0)
    for (const v of out.muscles) expect(v >= 0 && v <= 1).toBe(true)
    expect(out.face).toBeNull()
    expect(r.head({ t: 0, pitch: 0, yaw: 0, roll: 0, ax: 0, ay: 0, az: 0, source: 'airpods' })).toBeNull()
    expect(r.face({ ...basic(0.5), present: false }, []).muscles.every((v) => v === 0)).toBe(true)
  })

  test('with a model: sense already scales smile and brow to the own range, so they pass through', () => {
    const m = trainModel(record(18))
    const out = createReader(m).face(basic(0.8, 0.5), [])
    expect(out.muscles[M('smile')]).toBeCloseTo(0.8, 5)
    expect(out.muscles[M('browDown')]).toBeCloseTo(0.5, 5)
    expect(out.face).toBeNull()
    // told that sense is uncalibrated, the reader applies the range itself
    const raw = createReader(m, { calibrated: false }).face(basic(m.calibration.smile[1]), [])
    expect(raw.muscles[M('smile')]).toBeCloseTo(1, 1)
  })

  test('a model trained without detail (mock sense) still reads faces from the basic fields', () => {
    const rec = record(19, { detail: false })
    expect(rec.samples[0].x.length).toBeLessThan(ND)
    const m = trainModel(rec)
    expect(m.kind).toBe('basic')
    expect(m.clf).not.toBeNull()
    const reader = createReader(m, { calibrated: false })
    const face = synthFace(20, { detail: false })
    let label = ''
    for (let i = 0; i < 20; i++) label = reader.face(face.frame(i * 33, 3), [])?.face?.label ?? 'none'
    expect(label).toBe('angry')
  })

  test('is cheap enough for 30 Hz', () => {
    const m = trainModel(record(21, {}, synthImu(21, { smile: 1 })))
    const reader = createReader(m)
    const face = synthFace(22)
    const frames = Array.from({ length: 300 }, (_, i) => face.frame(i * 33, i % 5))
    const head = synthImu(23, { smile: 1 })
    const t0 = performance.now()
    for (const f of frames) reader.face(f, BLEND_NAMES)
    for (const h of head) reader.head(h)
    const per = (performance.now() - t0) / (frames.length + head.length)
    expect(per).toBeLessThan(0.5)
    console.log(`reader: ${(per * 1000).toFixed(0)} microseconds per call`)
  })
})
