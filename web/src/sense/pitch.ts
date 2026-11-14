// Voice frame analysis: RMS level, voicing and f0 (YIN) at 50 Hz.
//
// createVoiceAnalyzer is stringified into the AudioWorklet (see voice.ts), so it must stay
// self-contained: no imports, no references to anything outside its own body.

export interface RawVoiceFrame {
  /** input sample index (at the context sample rate) where this frame's window ends */
  frame: number
  /** dBFS */
  rms: number
  voiced: boolean
  f0: number | null
}

export interface VoiceAnalyzer {
  /** feed consecutive mono samples; frame0 = index of block[0] in the input stream */
  push(block: Float32Array, frame0: number, emit: (f: RawVoiceFrame) => void): void
}

export function createVoiceAnalyzer(sampleRate: number): VoiceAnalyzer {
  // work at ~16 kHz: plenty for 70-400 Hz pitch, and 9x cheaper than 48 kHz
  const dec = Math.max(1, Math.round(sampleRate / 16000))
  const fs = sampleRate / dec
  const hop = Math.max(1, Math.round(fs / 50))
  const tauMin = Math.max(2, Math.floor(fs / 400))
  const tauMax = Math.ceil(fs / 70)
  const win = Math.round(fs * 0.025) // YIN integration window
  const size = win + tauMax + 2
  const ring = new Float32Array(size)
  const buf = new Float32Array(size)
  const d = new Float32Array(tauMax + 2)
  let wr = 0
  let filled = 0
  let sinceHop = 0
  let decAcc = 0
  let decN = 0
  // one-pole DC / rumble blocker at ~60 Hz
  const hpA = Math.exp((-2 * Math.PI * 60) / fs)
  let hpX = 0
  let hpY = 0
  // slow noise-floor tracker (dB): drops at once, creeps up 0.25 dB/s
  let floorDb = -70
  let prevF0 = 0
  // YIN aperiodicity under VOICED_MAX = voiced (0.45 matches a 0.5 normalised-autocorrelation voicing threshold
  // on real speech). A pitch value is only reported under F0_MAX: weakly voiced frames give octave errors.
  const VOICED_MAX = 0.45
  const F0_MAX = 0.3

  function analyze(frame: number): RawVoiceFrame {
    // linearise the ring: buf[0] is the oldest sample
    buf.set(ring.subarray(wr), 0)
    buf.set(ring.subarray(0, wr), size - wr)
    // level over the newest 2 hops (40 ms)
    const nR = Math.min(size, hop * 2)
    let e = 0
    for (let i = size - nR; i < size; i++) e += buf[i] * buf[i]
    const rms = Math.max(-90, 10 * Math.log10(e / nR + 1e-12))
    if (rms < floorDb) floorDb = rms
    else floorDb += 0.005
    if (floorDb < -85) floorDb = -85
    const loud = rms > -58 && rms > floorDb + 8

    let f0: number | null = null
    let voiced = false
    if (loud) {
      // YIN: difference function, cumulative mean normalised
      let run = 0
      let best = -1
      let bestV = 1e9
      let found = -1
      d[0] = 1
      for (let tau = 1; tau <= tauMax + 1; tau++) {
        let s = 0
        for (let j = 0; j < win; j++) {
          const x = buf[j] - buf[j + tau]
          s += x * x
        }
        run += s
        d[tau] = run > 0 ? (s * tau) / run : 1
      }
      for (let tau = tauMin; tau <= tauMax; tau++) {
        const v = d[tau]
        if (v < bestV) {
          bestV = v
          best = tau
        }
        if (found < 0 && v < 0.15 && v <= d[tau + 1]) {
          // first dip under the absolute threshold: walk to its local minimum
          found = tau
          break
        }
      }
      let tau = found >= 0 ? found : best
      const v = tau >= 0 ? d[tau] : 1
      if (tau > 0 && v < VOICED_MAX) {
        // octave guard: if the previous frame was voiced, prefer a candidate near it
        if (prevF0 > 0) {
          const want = Math.round(fs / prevF0)
          if (want >= tauMin && want <= tauMax && Math.abs(want - tau) > 0.2 * tau) {
            let near = want
            for (let k = Math.max(tauMin, want - 3); k <= Math.min(tauMax, want + 3); k++) if (d[k] < d[near]) near = k
            if (d[near] < v + 0.1 && d[near] < VOICED_MAX) tau = near
          }
        }
        const a = d[tau - 1]
        const b = d[tau]
        const c = d[tau + 1]
        const den = a - 2 * b + c
        let off = den !== 0 ? (0.5 * (a - c)) / den : 0
        if (off > 0.5) off = 0.5
        if (off < -0.5) off = -0.5
        const f = fs / (tau + off)
        if (f >= 70 && f <= 400) {
          voiced = true
          if (d[tau] < F0_MAX) f0 = f
        }
      }
    }
    prevF0 = f0 === null ? 0 : f0
    return { frame, rms, voiced, f0 }
  }

  return {
    push(block, frame0, emit) {
      for (let i = 0; i < block.length; i++) {
        decAcc += block[i]
        if (++decN < dec) continue
        const x = decAcc / dec
        decAcc = 0
        decN = 0
        const y = hpA * (hpY + x - hpX)
        hpX = x
        hpY = y
        ring[wr] = y
        wr = (wr + 1) % size
        if (filled < size) filled++
        if (++sinceHop >= hop) {
          sinceHop = 0
          if (filled >= size) emit(analyze(frame0 + i + 1))
        }
      }
    },
  }
}
