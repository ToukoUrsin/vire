// One AudioContext for the whole app, created inside the Start gesture and reused.
// Clips are fetched early, decoded once, and every clip has a synthesized stand-in so a missing file never breaks the flow.

/** what the ping itself plays: fetched first, so a slow network spends itself on these */
const PING_CLIPS = [
  'laugh-1',
  'laugh-2',
  'laugh-3',
  'vo-settle',
  'vo-nod',
  'vo-listen',
  'vo-speak-1',
  'vo-speak-2',
  'vo-speak-3',
  'vo-breathe',
  'vo-in',
  'vo-out',
  'vo-done',
  'chime',
  'breath-in',
  'breath-out',
] as const
/** doses and the mini ping: fetched once the ping's clips are in */
const LATER_CLIPS = [
  'vo-mini',
  'found',
  'forest-bed',
  'stream',
  'bird-1',
  'bird-2',
  'bird-3',
  'bird-4',
  'bird-5',
  'bird-6',
  'vo-dose-breathe',
  'vo-dose-forest',
  'vo-dose-walk',
  'vo-dose-reach',
] as const
export const CLIPS = [...PING_CLIPS, ...LATER_CLIPS] as const
export type Clip = (typeof CLIPS)[number]

export interface Handle {
  stop(fadeMs?: number): void
  /** seconds */
  duration: number
}

interface PlayOpts {
  gain?: number
  /** seconds from now */
  delay?: number
  loop?: boolean
  fadeIn?: number
  /** connect here instead of the master bus (e.g. a PannerNode) */
  dest?: AudioNode
}

type Ctor = typeof AudioContext

class AudioEngine {
  ctx: AudioContext | null = null
  private master: GainNode | null = null
  private raw = new Map<string, Promise<ArrayBuffer | null>>()
  private buffers = new Map<string, AudioBuffer | null>()
  private decoding = new Map<string, Promise<AudioBuffer | null>>()
  private noiseBuf: AudioBuffer | null = null
  private wired = false

  /** start downloading clips; safe before any gesture. The ping's own clips go first. */
  prefetch() {
    const first = PING_CLIPS.map((name) => this.fetchRaw(name))
    const later = () => {
      for (const name of LATER_CLIPS) this.fetchRaw(name)
    }
    // on a slow network the rest waits its turn, but never for long
    void Promise.race([Promise.all(first), new Promise((r) => setTimeout(r, 6000))]).then(later)
  }

  private fetchRaw(name: string): Promise<ArrayBuffer | null> {
    let p = this.raw.get(name)
    if (!p) {
      p = fetch(new URL(`audio/${name}.mp3`, document.baseURI))
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .catch(() => null)
        .then((ab) => {
          // a download that failed is tried again the next time someone asks
          if (!ab) this.raw.delete(name)
          return ab
        })
      this.raw.set(name, p)
    }
    return p
  }

  /** decode every clip that is not in yet (again after a failed download) */
  private loadMissing() {
    for (const name of PING_CLIPS) if (!this.buffers.get(name)) void this.load(name)
    for (const name of LATER_CLIPS) if (!this.buffers.get(name)) void this.load(name)
  }

  /** resolves true as soon as one of `names` can play, false after `ms` */
  async ready(names: string[], ms: number): Promise<boolean> {
    if (!this.ctx) return false
    if (names.some((n) => this.has(n))) return true
    const any = new Promise<boolean>((res) => {
      let left = names.length
      for (const n of names) {
        void this.load(n).then((b) => {
          if (b) res(true)
          else if (--left === 0) res(false)
        })
      }
    })
    return Promise.race([any, new Promise<boolean>((r) => setTimeout(() => r(false), ms))])
  }

  /** call inside a user gesture. Creates (or resumes) the context and decodes everything. */
  init(): AudioContext | null {
    if (!this.ctx) {
      const AC: Ctor | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext
      if (!AC) return null
      try {
        this.ctx = new AC({ latencyHint: 'interactive' })
      } catch {
        return null
      }
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.9
      this.master.connect(this.ctx.destination)
    }
    this.loadMissing()
    if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => {})
    if (!this.wired) {
      this.wired = true
      const wake = () => {
        if (document.visibilityState === 'visible' && this.ctx && this.ctx.state !== 'running') {
          void this.ctx.resume().catch(() => {})
        }
      }
      document.addEventListener('visibilitychange', wake)
      window.addEventListener('pageshow', wake)
      // iOS interrupts the context for calls and Siri; pick it up again on the next touch
      window.addEventListener('pointerdown', wake, { passive: true })
      window.addEventListener('touchend', wake, { passive: true })
      // and straight away when the interruption ends while the page is still up
      this.ctx.addEventListener('statechange', wake)
    }
    return this.ctx
  }

  /** false while iOS has the context suspended or interrupted (a call, Siri, the lock screen) */
  get running(): boolean {
    return !!this.ctx && this.ctx.state === 'running'
  }

  get out(): AudioNode | null {
    return this.master
  }
  get now(): number {
    return this.ctx ? this.ctx.currentTime : 0
  }

  load(name: string): Promise<AudioBuffer | null> {
    let p = this.decoding.get(name)
    if (!p) {
      p = this.fetchRaw(name)
        .then((ab) => {
          if (!ab || !this.ctx) return null
          // decodeAudioData detaches the buffer; decode a copy so a later context could reuse the bytes
          return this.ctx.decodeAudioData(ab.slice(0))
        })
        .catch(() => null)
        .then((buf) => {
          this.buffers.set(name, buf)
          // not in: let the next ask start over
          if (!buf) this.decoding.delete(name)
          return buf
        })
      this.decoding.set(name, p)
    }
    return p
  }

  has(name: string): boolean {
    return !!this.buffers.get(name)
  }
  buffer(name: string): AudioBuffer | null {
    return this.buffers.get(name) ?? null
  }
  /** the subset of `names` that decoded */
  available<T extends string>(names: T[]): T[] {
    return names.filter((n) => this.has(n))
  }

  play(name: string, o: PlayOpts = {}): Handle | null {
    const buf = this.buffers.get(name)
    if (!buf) return null
    return this.playBuffer(buf, o)
  }

  playUrl(url: string, o: Pick<PlayOpts, 'gain'> = {}): Handle | null {
    try {
      const el = new Audio(url)
      el.volume = o.gain ?? 1
      void el.play().catch(() => {})
      return {
        duration: Number.isFinite(el.duration) ? el.duration : 7,
        stop: () => { el.pause(); el.currentTime = 0 },
      }
    } catch {
      return null
    }
  }

  /** like play, but waits a moment for a clip that is still decoding (voice lines right after the gesture) */
  async playSoon(name: string, o: PlayOpts = {}, waitMs = 900): Promise<Handle | null> {
    if (!this.buffers.get(name) && this.ctx) {
      await Promise.race([this.load(name), new Promise((r) => setTimeout(r, waitMs))])
    }
    return this.play(name, o)
  }

  playBuffer(buf: AudioBuffer, o: PlayOpts = {}): Handle | null {
    const ctx = this.ctx
    if (!ctx || !this.master) return null
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = !!o.loop
    const g = ctx.createGain()
    const t0 = ctx.currentTime + (o.delay ?? 0)
    const level = o.gain ?? 1
    if (o.fadeIn) {
      g.gain.setValueAtTime(0.0001, t0)
      g.gain.linearRampToValueAtTime(level, t0 + o.fadeIn)
    } else {
      g.gain.setValueAtTime(level, t0)
    }
    src.connect(g).connect(o.dest ?? this.master)
    src.start(t0)
    let stopped = false
    return {
      duration: buf.duration,
      stop: (fadeMs = 250) => {
        if (stopped) return
        stopped = true
        const t = ctx.currentTime
        try {
          g.gain.cancelScheduledValues(t)
          g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t)
          g.gain.exponentialRampToValueAtTime(0.0001, t + fadeMs / 1000)
          src.stop(t + fadeMs / 1000 + 0.02)
        } catch {
          /* already stopped */
        }
      },
    }
  }

  // ---- synthesized stand-ins ----

  private noise(): AudioBuffer | null {
    const ctx = this.ctx
    if (!ctx) return null
    if (!this.noiseBuf) {
      const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
      const d = b.getChannelData(0)
      let last = 0
      for (let i = 0; i < d.length; i++) {
        // slightly pink: smoother than raw white noise
        last = 0.85 * last + 0.15 * (Math.random() * 2 - 1)
        d[i] = last * 2.4
      }
      this.noiseBuf = b
    }
    return this.noiseBuf
  }

  /** two sine partials with a soft decay */
  chime(gain = 0.5, base = 660): void {
    if (this.play('chime', { gain: gain * 1.4 })) return
    this.bell(gain, base)
  }

  bell(gain = 0.5, base = 660, dest?: AudioNode): void {
    const ctx = this.ctx
    if (!ctx || !this.master) return
    const t = ctx.currentTime
    for (const [mult, amp, dur] of [
      [1, 1, 1.6],
      [1.5, 0.45, 1.1],
    ] as const) {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = base * mult
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(gain * amp * 0.5, t + 0.012)
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
      o.connect(g).connect(dest ?? this.master)
      o.start(t)
      o.stop(t + dur + 0.05)
    }
  }

  /** filtered-noise swell: one inhale or exhale lasting `sec` */
  breath(dir: 'in' | 'out', sec: number, gain = 0.5): Handle | null {
    const clip = this.play(dir === 'in' ? 'breath-in' : 'breath-out', { gain: gain * 1.6 })
    if (clip) return clip
    const ctx = this.ctx
    const nb = this.noise()
    if (!ctx || !nb || !this.master) return null
    const t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = nb
    src.loop = true
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.Q.value = 0.9
    const [f0, f1] = dir === 'in' ? [280, 1300] : [1300, 240]
    f.frequency.setValueAtTime(f0, t)
    f.frequency.exponentialRampToValueAtTime(f1, t + sec)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(gain * 0.5, t + sec * (dir === 'in' ? 0.75 : 0.2))
    g.gain.linearRampToValueAtTime(0.0001, t + sec)
    src.connect(f).connect(g).connect(this.master)
    src.start(t)
    src.stop(t + sec + 0.05)
    return { duration: sec, stop: () => g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.08) }
  }

  /** looped soft noise, for a forest bed when the clip is missing */
  wind(gain = 0.12, dest?: AudioNode): Handle | null {
    const ctx = this.ctx
    const nb = this.noise()
    if (!ctx || !nb || !this.master) return null
    const src = ctx.createBufferSource()
    src.buffer = nb
    src.loop = true
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 700
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, ctx.currentTime)
    g.gain.linearRampToValueAtTime(gain, ctx.currentTime + 2)
    src.connect(f).connect(g).connect(dest ?? this.master)
    src.start()
    return {
      duration: Infinity,
      stop: (fadeMs = 400) => {
        g.gain.setTargetAtTime(0.0001, ctx.currentTime, fadeMs / 3000)
        try {
          src.stop(ctx.currentTime + fadeMs / 1000 + 0.3)
        } catch {
          /* ignore */
        }
      },
    }
  }

  /** a short synthesized bird phrase, used only when bird-N.mp3 is missing */
  birdBuffer(seed: number): AudioBuffer | null {
    const ctx = this.ctx
    if (!ctx) return null
    const sr = ctx.sampleRate
    const b = ctx.createBuffer(1, Math.floor(sr * 1.6), sr)
    const d = b.getChannelData(0)
    const notes = 3 + (seed % 3)
    let ph = 0
    for (let n = 0; n < notes; n++) {
      const start = Math.floor(sr * (0.05 + n * 0.3))
      const len = Math.floor(sr * 0.2)
      const fA = 2400 + ((seed * 311 + n * 173) % 1400)
      const fB = fA + (n % 2 ? -600 : 700)
      for (let i = 0; i < len && start + i < d.length; i++) {
        const u = i / len
        const f = fA + (fB - fA) * u + 60 * Math.sin(u * 40)
        ph += (2 * Math.PI * f) / sr
        d[start + i] += Math.sin(ph) * Math.sin(Math.PI * u) ** 2 * 0.5
      }
    }
    return b
  }

  /** soft low thump for the walking beat, at an exact context time */
  thump(when: number, gain = 0.5): void {
    const ctx = this.ctx
    if (!ctx || !this.master) return
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(128, when)
    o.frequency.exponentialRampToValueAtTime(52, when + 0.14)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, when)
    g.gain.exponentialRampToValueAtTime(gain, when + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.24)
    o.connect(g).connect(this.master)
    o.start(when)
    o.stop(when + 0.3)
  }

  /** soft plucked note for the walking beat */
  pluck(when: number, freq: number, gain = 0.2): void {
    const ctx = this.ctx
    if (!ctx || !this.master) return
    const o = ctx.createOscillator()
    o.type = 'triangle'
    o.frequency.value = freq
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.setValueAtTime(2400, when)
    f.frequency.exponentialRampToValueAtTime(500, when + 0.5)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, when)
    g.gain.exponentialRampToValueAtTime(gain, when + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.7)
    o.connect(f).connect(g).connect(this.master)
    o.start(when)
    o.stop(when + 0.75)
  }
}

export const audio = new AudioEngine()

export function pick<T>(xs: T[]): T | null {
  return xs.length ? xs[Math.floor(Math.random() * xs.length)] : null
}
