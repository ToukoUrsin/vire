// The sound of a practice, made in the phone's own audio engine and placed around the head. A sea sits straight
// ahead and rises and falls with the breath the practice asks for; a second source sits to the left. Both are
// rendered for two ears (HRTF) and turned against the AirPods' own head angles, so they stay where they are in
// the room when the head turns. Until a generated piece is handed in (setStem), the sea is filtered noise made
// here and is marked as the phone's own tone.
export type StemId = 'sea' | 'left'

interface Source {
  az: number
  panner: PannerNode
  gain: GainNode
  node: AudioBufferSourceNode | null
  /** the gain of the piece playing now: pieces fade over each other through it */
  fade: GainNode | null
}

const DEG = Math.PI / 180
const turn = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180

function brownNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(1, n, ctx.sampleRate)
  const d = buf.getChannelData(0)
  let last = 0
  let peak = 0
  for (let i = 0; i < n; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02
    d[i] = last
    if (Math.abs(last) > peak) peak = Math.abs(last)
  }
  // the loop's two ends meet: the last quarter second fades into the first
  const fade = Math.floor(ctx.sampleRate * 0.25)
  for (let i = 0; i < fade; i++) {
    const k = i / fade
    d[n - fade + i] = d[n - fade + i] * (1 - k) + d[i] * k
  }
  for (let i = 0; i < n; i++) d[i] /= peak || 1
  return buf
}

/** one channel of a piece with its end blended into its start, so it can loop without a click */
function loopable(ctx: AudioContext, src: AudioBuffer): AudioBuffer {
  const fade = Math.min(Math.floor(src.sampleRate * 1.5), src.length >> 2)
  const n = src.length - fade
  if (n <= 0) return src
  const out = ctx.createBuffer(1, n, src.sampleRate)
  const d = out.getChannelData(0)
  const a = src.getChannelData(0)
  d.set(a.subarray(0, n))
  for (let i = 0; i < fade; i++) {
    const k = i / fade
    d[i] = a[i] * k + a[n + i] * (1 - k)
  }
  return out
}
function rms(b: AudioBuffer): number {
  const d = b.getChannelData(0)
  let sum = 0
  let n = 0
  for (let i = 0; i < d.length; i += 7) {
    sum += d[i] * d[i]
    n++
  }
  return n ? Math.sqrt(sum / n) : 0
}

export class Swell {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private filter: BiquadFilterNode | null = null
  private breathGain: GainNode | null = null
  private sea: Source | null = null
  private left: Source | null = null
  private ahead: { yaw: number; pitch: number } | null = null
  private headAt = 0
  /** which stems are generated pieces, not the phone's own noise */
  readonly made: Partial<Record<StemId, string>> = {}

  get context(): AudioContext | null {
    return this.ctx
  }

  /** call inside a tap: a phone only lets sound start from one */
  async start(): Promise<boolean> {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return false
      const ctx = this.ctx ?? new AC()
      this.ctx = ctx
      if (ctx.state !== 'running') await ctx.resume()
      if (this.master) return true
      const master = ctx.createGain()
      master.gain.value = 0
      master.connect(ctx.destination)
      this.master = master
      // the sea: noise through a filter that opens on the in-breath, then the breath's own rise and fall
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 500
      filter.Q.value = 0.6
      const breathGain = ctx.createGain()
      breathGain.gain.value = 0.3
      this.filter = filter
      this.breathGain = breathGain
      this.sea = this.source(0, 1)
      this.left = this.source(-75, 0)
      filter.connect(breathGain)
      breathGain.connect(this.sea.panner)
      this.play(this.sea, brownNoise(ctx, 6), filter)
      return true
    } catch (e) {
      console.warn('[swell] sound did not start', e)
      return false
    }
  }

  private source(az: number, gain: number): Source {
    const ctx = this.ctx!
    const panner = ctx.createPanner()
    panner.panningModel = 'HRTF'
    panner.distanceModel = 'linear'
    panner.refDistance = 1
    panner.maxDistance = 100
    panner.rolloffFactor = 0
    const g = ctx.createGain()
    g.gain.value = gain
    panner.connect(g)
    g.connect(this.master!)
    const s: Source = { az, panner, gain: g, node: null, fade: null }
    this.place(s, 0, 0)
    return s
  }

  /** start a looping piece on a stem; the piece before it fades out as this one fades in */
  private play(s: Source, buffer: AudioBuffer, into: AudioNode, level = 1, seconds = 0.05): void {
    const ctx = this.ctx!
    const node = ctx.createBufferSource()
    node.buffer = buffer
    node.loop = true
    const fade = ctx.createGain()
    const t = ctx.currentTime
    fade.gain.setValueAtTime(0, t)
    fade.gain.linearRampToValueAtTime(level, t + seconds)
    node.connect(fade)
    fade.connect(into)
    node.start()
    const old = s.node
    const oldFade = s.fade
    s.node = node
    s.fade = fade
    if (old && oldFade) {
      oldFade.gain.cancelScheduledValues(t)
      oldFade.gain.setValueAtTime(oldFade.gain.value, t)
      oldFade.gain.linearRampToValueAtTime(0, t + seconds)
      try {
        old.stop(t + seconds + 0.1)
      } catch {
        /* already stopped */
      }
    }
  }

  /**
   * A generated piece takes a stem's place: the sea ahead (it keeps the breath's rise and fall) or the one to the
   * left. It is made to loop without a seam and brought to the stem's own loudness, then faded in over four seconds.
   */
  setStem(id: StemId, buffer: AudioBuffer, name: string): void {
    if (!this.ctx || !this.sea || !this.left || !this.filter) return
    const loop = loopable(this.ctx, buffer)
    const level = Math.min(12, (id === 'sea' ? 0.3 : 0.09) / (rms(loop) || 1))
    if (id === 'sea') this.play(this.sea, loop, this.filter, level, 4)
    else {
      this.play(this.left, loop, this.left.panner, level, 4)
      this.left.gain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.5)
    }
    this.made[id] = name
  }

  private place(s: Source, yaw: number, pitch: number): void {
    // a head turned left by `yaw` hears what was ahead on its right
    const az = (s.az + yaw) * DEG
    const el = -pitch * DEG
    const x = Math.sin(az) * Math.cos(el)
    const y = Math.sin(el)
    const z = -Math.cos(az) * Math.cos(el)
    const p = s.panner
    if (p.positionX && this.ctx) {
      const t = this.ctx.currentTime
      p.positionX.setTargetAtTime(x, t, 0.04)
      p.positionY.setTargetAtTime(y, t, 0.04)
      p.positionZ.setTargetAtTime(z, t, 0.04)
    } else p.setPosition(x, y, z)
  }

  /** where the head points now, from the AirPods. "Ahead" is where it pointed when centre() was last called, and follows a head that stays turned, slowly. */
  head(yawDeg: number, pitchDeg: number): void {
    if (!this.sea || !this.left) return
    const now = performance.now()
    if (now - this.headAt < 40) return
    const dt = this.headAt ? Math.min(1, (now - this.headAt) / 1000) : 0
    this.headAt = now
    if (!this.ahead) this.ahead = { yaw: yawDeg, pitch: pitchDeg }
    const k = dt / 30
    this.ahead.yaw = turn(this.ahead.yaw + turn(yawDeg - this.ahead.yaw) * k)
    this.ahead.pitch += (pitchDeg - this.ahead.pitch) * k
    const yaw = turn(yawDeg - this.ahead.yaw)
    const pitch = Math.max(-60, Math.min(60, pitchDeg - this.ahead.pitch))
    this.place(this.sea, yaw, pitch)
    this.place(this.left, yaw, pitch)
  }

  centre(): void {
    this.ahead = null
  }

  /** the whole sound up or down over some seconds */
  level(v: number, seconds: number): void {
    if (!this.ctx || !this.master) return
    const t = this.ctx.currentTime
    this.master.gain.cancelScheduledValues(t)
    this.master.gain.setTargetAtTime(v, t, Math.max(0.05, seconds / 3))
  }

  /** one breath, from now: the sea rises for `inS` seconds and falls for `outS` */
  breath(inS: number, outS: number, depth = 1): void {
    if (!this.ctx || !this.breathGain || !this.filter) return
    const t = this.ctx.currentTime
    const lo = 0.3 - 0.14 * depth
    const hi = 0.3 + 0.7 * depth
    const g = this.breathGain.gain
    g.cancelScheduledValues(t)
    g.setValueAtTime(Math.max(0.0001, g.value), t)
    g.linearRampToValueAtTime(hi, t + inS)
    g.linearRampToValueAtTime(lo, t + inS + outS)
    const f = this.filter.frequency
    f.cancelScheduledValues(t)
    f.setValueAtTime(f.value, t)
    f.linearRampToValueAtTime(500 + 1500 * depth, t + inS)
    f.linearRampToValueAtTime(420, t + inS + outS)
  }

  /** a soft bell: a step begins or ends. Not placed in the room. */
  chime(high = false): void {
    if (!this.ctx) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'sine'
    o.frequency.value = high ? 880 : 587.3
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1)
    o.connect(g)
    g.connect(ctx.destination)
    o.start(t)
    o.stop(t + 1.2)
  }

  stop(): void {
    const ctx = this.ctx
    if (!ctx || !this.master) return
    this.level(0, 1.2)
    const nodes = [this.sea?.node, this.left?.node]
    setTimeout(() => {
      for (const n of nodes) {
        try {
          n?.stop()
        } catch {
          /* already stopped */
        }
      }
    }, 2500)
    this.master = null
    this.sea = null
    this.left = null
    this.filter = null
    this.breathGain = null
    this.ahead = null
    for (const k of Object.keys(this.made) as StemId[]) delete this.made[k]
  }
}
