// Small pure DSP helpers shared by the live pipeline and the feature math. No DOM, no imports.

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

export function smoothstep(lo: number, hi: number, x: number): number {
  const u = clamp((x - lo) / (hi - lo), 0, 1)
  return u * u * (3 - 2 * u)
}

export function mean(a: ArrayLike<number>): number {
  if (a.length === 0) return NaN
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i]
  return s / a.length
}

/** population standard deviation */
export function std(a: ArrayLike<number>): number {
  if (a.length === 0) return NaN
  const m = mean(a)
  let s = 0
  for (let i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m)
  return Math.sqrt(s / a.length)
}

/** linear-interpolated percentile, p in 0..1. NaN for an empty array. */
export function percentile(a: ArrayLike<number>, p: number): number {
  if (a.length === 0) return NaN
  const s = Array.from(a).sort((x, y) => x - y)
  const i = clamp(p, 0, 1) * (s.length - 1)
  const lo = Math.floor(i)
  const hi = Math.min(s.length - 1, lo + 1)
  return s[lo] + (s[hi] - s[lo]) * (i - lo)
}

export function median(a: ArrayLike<number>): number {
  return percentile(a, 0.5)
}

// ---- biquad filters (RBJ cookbook, Butterworth when q = 1/sqrt 2) ----

export interface Biquad {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

export function biquadLowpass(fc: number, fs: number, q = Math.SQRT1_2): Biquad {
  const w = (2 * Math.PI * fc) / fs
  const c = Math.cos(w)
  const al = Math.sin(w) / (2 * q)
  const a0 = 1 + al
  return { b0: (1 - c) / 2 / a0, b1: (1 - c) / a0, b2: (1 - c) / 2 / a0, a1: (-2 * c) / a0, a2: (1 - al) / a0 }
}

export function biquadHighpass(fc: number, fs: number, q = Math.SQRT1_2): Biquad {
  const w = (2 * Math.PI * fc) / fs
  const c = Math.cos(w)
  const al = Math.sin(w) / (2 * q)
  const a0 = 1 + al
  return { b0: (1 + c) / 2 / a0, b1: -(1 + c) / a0, b2: (1 + c) / 2 / a0, a1: (-2 * c) / a0, a2: (1 - al) / a0 }
}

/** streaming biquad (direct form II transposed) */
export class BiquadState {
  private z1 = 0
  private z2 = 0
  private primed = false
  private readonly c: Biquad
  constructor(c: Biquad) {
    this.c = c
  }
  reset(): void {
    this.z1 = 0
    this.z2 = 0
    this.primed = false
  }
  step(x: number): number {
    const c = this.c
    if (!this.primed) {
      // start in the steady state for a constant input so there is no step transient
      const g = (c.b0 + c.b1 + c.b2) / (1 + c.a1 + c.a2)
      this.z1 = (g - c.b0) * x
      this.z2 = (c.b2 - c.a2 * g) * x
      this.primed = true
    }
    const y = c.b0 * x + this.z1
    this.z1 = c.b1 * x - c.a1 * y + this.z2
    this.z2 = c.b2 * x - c.a2 * y
    return y
  }
}

function runSections(x: Float64Array, sections: Biquad[]): Float64Array {
  let cur = x
  for (const c of sections) {
    const st = new BiquadState(c)
    const out = new Float64Array(cur.length)
    for (let i = 0; i < cur.length; i++) out[i] = st.step(cur[i])
    cur = out
  }
  return cur
}

/** zero-phase forward-backward filtering with odd-reflection padding */
export function filtfilt(x: ArrayLike<number>, sections: Biquad[], pad = 90): Float64Array {
  const n = x.length
  if (n === 0) return new Float64Array(0)
  const p = Math.min(pad, n - 1)
  const ext = new Float64Array(n + 2 * p)
  for (let i = 0; i < p; i++) ext[i] = 2 * x[0] - x[p - i]
  for (let i = 0; i < n; i++) ext[p + i] = x[i]
  for (let i = 0; i < p; i++) ext[p + n + i] = 2 * x[n - 1] - x[n - 2 - i]
  let y = runSections(ext, sections)
  y.reverse()
  y = runSections(y, sections)
  y.reverse()
  return y.slice(p, p + n)
}

export function bandpassZeroPhase(x: ArrayLike<number>, fs: number, lo: number, hi: number): Float64Array {
  return filtfilt(x, [biquadHighpass(lo, fs), biquadLowpass(hi, fs)], Math.round(fs * 3))
}

export function lowpassZeroPhase(x: ArrayLike<number>, fs: number, fc: number): Float64Array {
  return filtfilt(x, [biquadLowpass(fc, fs)], Math.round(fs))
}

// ---- resampling ----

/**
 * Linear resample of an irregular series (t in ms, ascending) onto a uniform grid at fs Hz
 * covering [t[0], t[last]]. Returns the grid start time and the values.
 */
export function resampleUniform(t: ArrayLike<number>, v: ArrayLike<number>, fs: number): { t0: number; fs: number; v: Float64Array } {
  const n = t.length
  if (n === 0) return { t0: 0, fs, v: new Float64Array(0) }
  const dt = 1000 / fs
  const m = Math.max(1, Math.floor((t[n - 1] - t[0]) / dt) + 1)
  const out = new Float64Array(m)
  let j = 0
  for (let k = 0; k < m; k++) {
    const tk = t[0] + k * dt
    while (j < n - 2 && t[j + 1] < tk) j++
    if (n === 1) {
      out[k] = v[0]
      continue
    }
    const t0 = t[j]
    const t1 = t[j + 1]
    const u = t1 > t0 ? clamp((tk - t0) / (t1 - t0), 0, 1) : 0
    out[k] = v[j] + (v[j + 1] - v[j]) * u
  }
  return { t0: t[0], fs, v: out }
}

/** split indices into runs where consecutive timestamps are closer than maxGapMs */
export function contiguousRuns(t: ArrayLike<number>, maxGapMs: number): [number, number][] {
  const runs: [number, number][] = []
  if (t.length === 0) return runs
  let s = 0
  for (let i = 1; i < t.length; i++) {
    if (t[i] - t[i - 1] > maxGapMs) {
      runs.push([s, i])
      s = i
    }
  }
  runs.push([s, t.length])
  return runs
}

// ---- spectrum ----

/** in-place radix-2 FFT; length must be a power of two */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]
      re[i] = re[j]
      re[j] = tr
      const ti = im[i]
      im[i] = im[j]
      im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = a + len / 2
        const xr = re[b] * cr - im[b] * ci
        const xi = re[b] * ci + im[b] * cr
        re[b] = re[a] - xr
        im[b] = im[a] - xi
        re[a] += xr
        im[a] += xi
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
}

export interface SpectralPeak {
  /** Hz, parabolic-interpolated */
  freq: number
  /** power near the peak vs the rest of the band, dB */
  snrDb: number
}

/**
 * Dominant frequency of x in [lo, hi] Hz from a Hann-windowed, zero-padded periodogram.
 * SNR = power within +-0.2 Hz of the peak over the remaining power in [lo-0.1, hi+1] Hz,
 * leaving the first harmonic out of both sides. Null when there is no interior peak.
 */
export function spectralPeak(x: ArrayLike<number>, fs: number, lo: number, hi: number, minFft = 1024): SpectralPeak | null {
  const n = x.length
  if (n < 16) return null
  let nfft = minFft
  while (nfft < n * 2) nfft <<= 1
  const re = new Float64Array(nfft)
  const im = new Float64Array(nfft)
  // remove the linear trend, then window
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  for (let i = 0; i < n; i++) {
    sx += i
    sy += x[i]
    sxx += i * i
    sxy += i * x[i]
  }
  const den = n * sxx - sx * sx
  const slope = den !== 0 ? (n * sxy - sx * sy) / den : 0
  const icpt = (sy - slope * sx) / n
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
    re[i] = (x[i] - (icpt + slope * i)) * w
  }
  fft(re, im)
  const df = fs / nfft
  const half = nfft >> 1
  const p = new Float64Array(half)
  for (let k = 0; k < half; k++) p[k] = re[k] * re[k] + im[k] * im[k]
  const kLo = Math.max(1, Math.ceil(lo / df))
  const kHi = Math.min(half - 2, Math.floor(hi / df))
  if (kHi <= kLo) return null
  let kp = -1
  let best = 0
  for (let k = kLo; k <= kHi; k++) {
    if (p[k] > best && p[k] >= p[k - 1] && p[k] >= p[k + 1]) {
      best = p[k]
      kp = k
    }
  }
  if (kp < 0 || best <= 0) return null
  const a = p[kp - 1]
  const b = p[kp]
  const c = p[kp + 1]
  const d = a - 2 * b + c
  const off = d !== 0 ? clamp((0.5 * (a - c)) / d, -0.5, 0.5) : 0
  const freq = (kp + off) * df
  const band = (f0: number, f1: number) => {
    let s = 0
    const k0 = Math.max(1, Math.ceil(f0 / df))
    const k1 = Math.min(half - 1, Math.floor(f1 / df))
    for (let k = k0; k <= k1; k++) s += p[k]
    return s
  }
  const tLo = Math.max(0.3, lo - 0.1)
  const tHi = Math.min(fs / 2, hi + 1)
  const total = band(tLo, tHi)
  const sig = band(Math.max(tLo, freq - 0.2), Math.min(tHi, freq + 0.2))
  const harm = 2 * freq - 0.2 < tHi ? band(Math.max(freq + 0.2 + df, 2 * freq - 0.2), Math.min(tHi, 2 * freq + 0.2)) : 0
  const noise = Math.max(total - sig - harm, 1e-30)
  return { freq, snrDb: 10 * Math.log10(sig / noise) }
}

/** map a pulse-band SNR to 0..1. Calibrated so band-limited noise lands near 0 and a clean pulse near 1. */
export function snrToQuality(snrDb: number): number {
  return clamp((snrDb + 1) / 8, 0, 1)
}

// ---- POS (Wang, den Brinker, Stuijk, de Haan 2017: "Algorithmic principles of remote PPG") ----

/**
 * Streaming plane-orthogonal-to-skin. Feed uniformly sampled mean skin RGB; each push returns the
 * finished pulse sample that is `delay` samples old (overlap-add over a 1.6 s window), or null while filling.
 */
export class PosStream {
  readonly l: number
  private r: Float64Array
  private g: Float64Array
  private b: Float64Array
  private acc: Float64Array
  private h: Float64Array
  private n = 0

  constructor(fs: number, windowS = 1.6) {
    this.l = Math.max(8, Math.round(fs * windowS))
    this.r = new Float64Array(this.l)
    this.g = new Float64Array(this.l)
    this.b = new Float64Array(this.l)
    this.acc = new Float64Array(this.l)
    this.h = new Float64Array(this.l)
  }

  /** samples between an input and its finished output */
  get delay(): number {
    return this.l - 1
  }

  reset(): void {
    this.n = 0
    this.acc.fill(0)
  }

  push(r: number, g: number, b: number): number | null {
    const l = this.l
    const w = this.n % l
    this.r[w] = r
    this.g[w] = g
    this.b[w] = b
    this.n++
    if (this.n < l) return null
    let mr = 0
    let mg = 0
    let mb = 0
    for (let i = 0; i < l; i++) {
      mr += this.r[i]
      mg += this.g[i]
      mb += this.b[i]
    }
    mr = mr / l || 1
    mg = mg / l || 1
    mb = mb / l || 1
    const start = this.n % l // oldest sample in the ring
    const h = this.h
    let m1 = 0
    let m2 = 0
    let q1 = 0
    let q2 = 0
    // projections onto the plane orthogonal to skin tone (s1 kept in h, s2 in scratch), then alpha tuning
    const s2buf = scratch(l)
    for (let i = 0; i < l; i++) {
      const j = (start + i) % l
      const cr = this.r[j] / mr
      const cg = this.g[j] / mg
      const cb = this.b[j] / mb
      const s1 = cg - cb
      const s2 = -2 * cr + cg + cb
      h[i] = s1
      s2buf[i] = s2
      m1 += s1
      m2 += s2
    }
    m1 /= l
    m2 /= l
    for (let i = 0; i < l; i++) {
      q1 += (h[i] - m1) * (h[i] - m1)
      q2 += (s2buf[i] - m2) * (s2buf[i] - m2)
    }
    const alpha = q2 > 0 ? Math.sqrt(q1 / q2) : 0
    const mh = m1 + alpha * m2
    const acc = this.acc
    for (let i = 0; i < l; i++) acc[i] += h[i] + alpha * s2buf[i] - mh
    const out = acc[0] / Math.min(this.n - l + 1, l)
    acc.copyWithin(0, 1)
    acc[l - 1] = 0
    return out
  }

  /**
   * Provisional values for the newest `delay` samples that have not been emitted yet
   * (fewer overlapping windows, so noisier). Oldest first.
   */
  tail(): number[] {
    if (this.n < this.l) return []
    const out: number[] = []
    const windows = this.n - this.l + 1
    for (let i = 0; i < this.l - 1; i++) out.push(this.acc[i] / Math.min(this.l - 1 - i, windows))
    return out
  }
}

let scratchBuf = new Float64Array(0)
function scratch(n: number): Float64Array {
  if (scratchBuf.length < n) scratchBuf = new Float64Array(n)
  return scratchBuf
}

/** offline POS over whole arrays; output is aligned with the input (same length) */
export function posOffline(r: ArrayLike<number>, g: ArrayLike<number>, b: ArrayLike<number>, fs: number): Float64Array {
  const p = new PosStream(fs)
  const out = new Float64Array(r.length)
  let k = 0
  for (let i = 0; i < r.length; i++) {
    const y = p.push(r[i], g[i], b[i])
    if (y !== null) out[k++] = y
  }
  for (const y of p.tail()) if (k < out.length) out[k++] = y
  return out
}
