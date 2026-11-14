// The ear model and, more to the point, its check: what it passes and what it must not pass.
import { describe, expect, test } from 'bun:test'
import type { EarEvent, EarRecording } from '@shared/ear'
import { MAX_MINUTES, TEACH_ROUNDS, createEarReader, roundsOf, scoreModelOn, simulateTeach, trainEarModel } from '../../src/tune/ear'

const TAUGHT: EarEvent[] = ['smile', 'nod', 'shake']
let seed = 11
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296 - 0.5
}
/** the camera and the microphone stay as they were; the AirPods are swapped for something that cannot know */
const withHead = (rec: EarRecording, head: number[][]): EarRecording => ({ ...rec, head })
const passed = (rec: EarRecording) => {
  const m = trainEarModel(rec)
  return TAUGHT.filter((e) => m.events[e]?.score.ok)
}

describe('the teaching minute', () => {
  test('is the same round three times', () => {
    const rec = simulateTeach({ seed: 1 })
    const rounds = roundsOf(rec.steps)
    expect(rounds.length).toBe(TEACH_ROUNDS)
    for (const r of rounds) {
      expect(r.bouts.smile?.length).toBe(2)
      expect(r.bouts.nod?.length).toBe(1)
      expect(r.bouts.shake?.length).toBe(1)
    }
  })
})

describe('the check', () => {
  test('passes smile, nod and shake when the AirPods really felt them', () => {
    for (const s of [1, 2, 3]) {
      const m = trainEarModel(simulateTeach({ seed: s }))
      for (const e of TAUGHT) {
        expect(m.events[e]?.score.ok).toBe(true)
        expect(m.events[e]!.score.auc).toBeGreaterThan(0.9)
        expect(m.events[e]!.score.times).toBeGreaterThanOrEqual(3)
      }
      // never asked for, so never claimed
      expect(m.events.laugh).toBeUndefined()
      expect(m.events.talk).toBeUndefined()
    }
  })

  test('passes nothing when the AirPods are only sensor noise', () => {
    for (const s of [1, 2, 3]) {
      const rec = simulateTeach({ seed: s })
      expect(passed(withHead(rec, rec.head.map((r) => [r[0], rnd() * 0.2, rnd() * 0.2, rnd() * 0.2, rnd() * 0.01, rnd() * 0.01, 1 + rnd() * 0.01, 0, 0, 0])))).toEqual([])
    }
  })

  test('passes nothing when the AirPods drift on their own', () => {
    for (const s of [1, 2, 3]) {
      const rec = simulateTeach({ seed: s })
      let a = 0
      let b = 0
      let c = 0
      const head = rec.head.map((r) => {
        a = a * 0.995 + rnd() * 0.4
        b = b * 0.995 + rnd() * 0.4
        c = c * 0.995 + rnd() * 0.4
        return [r[0], a, b, c, rnd() * 0.01, rnd() * 0.01, 1 + rnd() * 0.01, 0, 0, 0]
      })
      expect(passed(withHead(rec, head))).toEqual([])
    }
  })

  test('passes nothing when each round of real movement is slid by a different amount', () => {
    // real smiles, nods and shakes are in the stream, but never at the same place in a round twice
    for (const s of [1, 2, 3]) {
      const rec = simulateTeach({ seed: s })
      const rounds = roundsOf(rec.steps)
      const slide = [4300, 9100, 13700]
      const head = rec.head.map((r) => {
        const k = rounds.findIndex((x) => r[0] >= x.t0 && r[0] < x.t1)
        if (k < 0) return r
        const len = rounds[k].t1 - rounds[k].t0
        const from = rounds[k].t0 + ((r[0] - rounds[k].t0 + slide[k]) % len)
        const src = rec.head.reduce((best, x) => (Math.abs(x[0] - from) < Math.abs(best[0] - from) ? x : best))
        return [r[0], ...src.slice(1)]
      })
      expect(passed(withHead(rec, head))).toEqual([])
    }
  })

  test('has nothing to say about a minute without rounds', () => {
    const rec = simulateTeach({ seed: 1 })
    // one long go at each thing, as the first version of the minute was
    const first = roundsOf(rec.steps)[0]
    const m = trainEarModel({ ...rec, steps: rec.steps.filter((x) => x.t1 <= first.t1) })
    for (const e of TAUGHT) expect(m.events[e]?.score.ok ?? false).toBe(false)
  })
})

describe('a second minute', () => {
  test('is a plain test of the first minute\'s model', () => {
    const model = trainEarModel(simulateTeach({ seed: 1 }))
    const again = scoreModelOn(model, simulateTeach({ seed: 2 }))
    for (const e of TAUGHT) expect(again[e]!.auc).toBeGreaterThan(0.9)
    // and the same model asked about AirPods that only drift scores a coin
    const rec = simulateTeach({ seed: 3 })
    const noise = scoreModelOn(model, withHead(rec, rec.head.map((r) => [r[0], rnd() * 0.2, rnd() * 0.2, rnd() * 0.2, rnd() * 0.01, rnd() * 0.01, 1, 0, 0, 0])))
    for (const e of TAUGHT) expect(noise[e]!.ok).toBe(false)
  })
})

describe('every minute', () => {
  const at = (k: number) => new Date(Date.UTC(2026, 10, 14, 12, k)).toISOString()
  const minutes = (n: number) => Array.from({ length: n }, (_, k) => simulateTeach({ seed: k + 1, at: at(k) }))

  test('is learned from, and the check holds a whole minute back', () => {
    for (const n of [2, 3]) {
      const m = trainEarModel(minutes(n))
      expect(m.minutes).toBe(n)
      expect(m.held).toBe('minute')
      expect(m.at).toBe(at(n - 1))
      for (const e of TAUGHT) {
        expect(m.events[e]?.score.ok).toBe(true)
        expect(m.events[e]!.score.auc).toBeGreaterThan(0.9)
        // each asked bout of every minute was held back once
        expect(m.events[e]!.score.times).toBeGreaterThanOrEqual(3 * n)
      }
      expect(m.events.laugh).toBeUndefined()
      expect(m.events.talk).toBeUndefined()
    }
    // one minute on its own is still checked round by round
    expect(trainEarModel(minutes(1)).held).toBe('round')
    expect(trainEarModel(minutes(1)).minutes).toBe(1)
  })

  test('passes nothing when the AirPods in every minute are only noise or drift', () => {
    const noise = minutes(3).map((rec) => withHead(rec, rec.head.map((r) => [r[0], rnd() * 0.2, rnd() * 0.2, rnd() * 0.2, rnd() * 0.01, rnd() * 0.01, 1 + rnd() * 0.01, 0, 0, 0])))
    expect(TAUGHT.filter((e) => trainEarModel(noise).events[e]?.score.ok)).toEqual([])
    const drift = minutes(3).map((rec) => {
      let a = 0
      let b = 0
      let c = 0
      return withHead(rec, rec.head.map((r) => {
        a = a * 0.995 + rnd() * 0.4
        b = b * 0.995 + rnd() * 0.4
        c = c * 0.995 + rnd() * 0.4
        return [r[0], a, b, c, rnd() * 0.01, rnd() * 0.01, 1 + rnd() * 0.01, 0, 0, 0]
      }))
    })
    expect(TAUGHT.filter((e) => trainEarModel(drift).events[e]?.score.ok)).toEqual([])
  })

  test('passes nothing when real movement sits somewhere else in every round of every minute', () => {
    const slides = [[4300, 9100, 13700], [6100, 11900, 2900], [8300, 3700, 15100]]
    const slid = minutes(3).map((rec, n) => {
      const rounds = roundsOf(rec.steps)
      return withHead(rec, rec.head.map((r) => {
        const k = rounds.findIndex((x) => r[0] >= x.t0 && r[0] < x.t1)
        if (k < 0) return r
        const len = rounds[k].t1 - rounds[k].t0
        const from = rounds[k].t0 + ((r[0] - rounds[k].t0 + slides[n][k]) % len)
        const src = rec.head.reduce((best, x) => (Math.abs(x[0] - from) < Math.abs(best[0] - from) ? x : best))
        return [r[0], ...src.slice(1)]
      }))
    })
    expect(TAUGHT.filter((e) => trainEarModel(slid).events[e]?.score.ok)).toEqual([])
  })

  test('a thing the camera saw in one minute only is still checked, round by round', () => {
    const [a, b] = minutes(2)
    // in the second minute the camera never saw a smile
    const blind: EarRecording = { ...b, face: b.face.map((f) => [f[0], f[1], 0.02, ...f.slice(3)]) }
    const m = trainEarModel([a, blind])
    expect(m.minutes).toBe(2)
    expect(m.events.smile?.score.held).toBe('round')
    expect(m.events.smile?.score.ok).toBe(true)
    expect(m.events.nod?.score.held).toBe('minute')
    expect(m.held).toBe('minute')
  })

  test('a minute read on another kind of device, or by a script, is not mixed in', () => {
    const [a, b] = minutes(2)
    const phone: EarRecording = { ...b, device: { ...b.device, shell: 'ios' } }
    const m = trainEarModel([a, phone])
    expect(m.minutes).toBe(1)
    expect(m.shell).toBe('ios')
  })

  test('only the newest few are used, so the phone still answers quickly', () => {
    const m = trainEarModel(minutes(MAX_MINUTES + 2))
    expect(m.minutes).toBe(MAX_MINUTES)
  })
})

describe('the reader', () => {
  test('counts each smile, nod and shake of a new minute from the AirPods alone', () => {
    const model = trainEarModel(simulateTeach({ seed: 1 }))
    const rec = simulateTeach({ seed: 4 })
    const reader = createEarReader(model)
    const starts: Record<string, number> = {}
    const wrong: Record<string, number> = {}
    let was = new Set<string>()
    for (const h of rec.head) {
      const now = reader.push({ t: h[0] + 5000, source: 'airpods', pitch: h[1], yaw: h[2], roll: h[3], ax: h[4], ay: h[5], az: h[6] })
      if (!now) continue
      const ask = rec.steps.find((x) => h[0] >= x.t0 && h[0] < x.t1)?.ask
      for (const e of now.on) {
        if (was.has(e)) continue
        starts[e] = (starts[e] ?? 0) + 1
        if (ask !== e) wrong[e] = (wrong[e] ?? 0) + 1
      }
      was = new Set(now.on)
    }
    expect(starts.smile).toBeGreaterThanOrEqual(5)
    expect(starts.nod).toBeGreaterThanOrEqual(3)
    expect(starts.shake).toBeGreaterThanOrEqual(3)
    for (const e of TAUGHT) expect(wrong[e] ?? 0).toBe(0)
  })
})
