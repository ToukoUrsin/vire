// The sound under a practice: a 20 second bed made by MusicGen for this kind of practice and this pace, looped
// with a soft seam. Two stages exist for every kind (settling, deep); the practice moves to the deep one once
// the head has gone still. The beds are the main site's own (/api/sound/manifest); nothing is generated here.
import { loadManifest, type SoundKind, type SoundManifest, type SoundStage } from '@web/tune/session/sound'

type Ctx = AudioContext
const SEAM = 2.6

function pick(beds: SoundManifest['beds'], kind: SoundKind, stage: SoundStage, pace: number) {
  const score = (b: SoundManifest['beds'][number]) => (b.input ? (b.input.kind === kind ? 0 : 20) + (b.input.stage === stage ? 0 : 6) + Math.abs(b.input.pace - pace) : 100)
  return beds.slice().sort((a, b) => score(a) - score(b))[0] ?? null
}

export class Bed {
  private ctx: Ctx | null = null
  private out: GainNode | null = null
  private stage: { name: SoundStage; gain: GainNode; stop: () => void } | null = null
  private buffers = new Map<string, Promise<AudioBuffer | null>>()
  private dead = false
  /** what is playing, for the screen to say so */
  info: { model: string; stage: SoundStage } | null = null

  /** call from a tap: iOS only lets sound start inside one */
  constructor(private kind: SoundKind) {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return
      this.ctx = new AC()
      this.out = this.ctx.createGain()
      this.out.gain.value = 0.9
      this.out.connect(this.ctx.destination)
      void this.ctx.resume()
    } catch (e) {
      console.error('[sound] no audio here', e)
      this.ctx = null
    }
  }

  private load(stage: SoundStage): Promise<AudioBuffer | null> {
    const have = this.buffers.get(stage)
    if (have) return have
    const ctx = this.ctx
    const p = (async () => {
      if (!ctx) return null
      try {
        const bed = pick((await loadManifest()).beds, this.kind, stage, stage === 'deep' ? 6 : 10)
        if (!bed) return null
        const res = await fetch(bed.url)
        if (!res.ok) throw new Error(`clip ${res.status}`)
        const buf = await ctx.decodeAudioData(await res.arrayBuffer())
        this.info = { model: bed.model, stage }
        return buf
      } catch (e) {
        console.error('[sound] bed not loaded', e)
        return null
      }
    })()
    this.buffers.set(stage, p)
    return p
  }

  /** fetch the next stage ahead of time so the change has no gap */
  warm(stage: SoundStage): void {
    void this.load(stage)
  }

  /** start (or move to) a stage; the one before fades out under it */
  async play(stage: SoundStage, fade = 4): Promise<void> {
    const ctx = this.ctx
    if (!ctx || !this.out || this.stage?.name === stage) return
    const buf = await this.load(stage)
    if (!buf || this.dead || this.stage?.name === stage) return
    const gain = ctx.createGain()
    gain.connect(this.out)
    const t0 = ctx.currentTime + 0.05
    gain.gain.setValueAtTime(0, t0)
    gain.gain.linearRampToValueAtTime(1, t0 + fade)
    let stopped = false
    let timer = 0
    let at = t0
    const seam = Math.min(SEAM, buf.duration / 4)
    const next = () => {
      if (stopped) return
      const src = ctx.createBufferSource()
      src.buffer = buf
      const g = ctx.createGain()
      const end = at + buf.duration
      g.gain.setValueAtTime(0, at)
      g.gain.linearRampToValueAtTime(1, at + seam)
      g.gain.setValueAtTime(1, end - seam)
      g.gain.linearRampToValueAtTime(0, end)
      src.connect(g).connect(gain)
      src.start(at)
      src.stop(end + 0.05)
      at = end - seam
      timer = window.setTimeout(next, Math.max(200, (at - ctx.currentTime - 1.5) * 1000))
    }
    next()
    const before = this.stage
    if (before) {
      before.gain.gain.cancelScheduledValues(t0)
      before.gain.gain.setValueAtTime(before.gain.gain.value, t0)
      before.gain.gain.linearRampToValueAtTime(0, t0 + fade)
      window.setTimeout(before.stop, (fade + 0.3) * 1000)
    }
    this.stage = {
      name: stage,
      gain,
      stop: () => {
        stopped = true
        clearTimeout(timer)
        try {
          gain.disconnect()
        } catch {
          /* already gone */
        }
      },
    }
  }

  /** the whole sound up or down, 0 to 1 */
  level(v: number, seconds = 3): void {
    if (!this.ctx || !this.out) return
    const t = this.ctx.currentTime
    this.out.gain.cancelScheduledValues(t)
    this.out.gain.setValueAtTime(this.out.gain.value, t)
    this.out.gain.linearRampToValueAtTime(Math.max(0, Math.min(1, v)) * 0.9, t + seconds)
  }

  /** a struck bowl: two partials that ring out. Not part of the bed, so it stays clear over it. */
  bell(soft = false): void {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime + 0.02
    const peak = soft ? 0.07 : 0.16
    for (const [f, k, long] of [
      [432, 1, 4.2],
      [432 * 2.76, 0.35, 2.4],
      [432 * 5.4, 0.12, 1.2],
    ] as const) {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = f
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(peak * k, t + 0.012)
      g.gain.exponentialRampToValueAtTime(0.0001, t + long)
      o.connect(g).connect(ctx.destination)
      o.start(t)
      o.stop(t + long + 0.1)
    }
  }

  stop(fade = 2): void {
    if (this.dead) return
    this.dead = true
    const ctx = this.ctx
    if (!ctx || !this.out) return
    this.level(0, fade)
    window.setTimeout(
      () => {
        this.stage?.stop()
        void ctx.close().catch(() => {})
      },
      (fade + 4.5) * 1000,
    )
  }
}
