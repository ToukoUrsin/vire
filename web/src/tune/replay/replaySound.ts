// The replay's sound: the session's own engine (Swell) and the same pieces made on Modal that the run played,
// fetched by id from /api/sound/clip. Only GETs. A browser that will not start sound without a tap leaves the
// context suspended: the page then plays muted and asks for one tap.
import type { EarSessionRec } from '@shared/earsession'
import { apiUrl } from '../../shared/api'
import { loadManifest } from '../session/sound'
import { Swell } from '../session/swell'

export type SoundState = 'starting' | 'on' | 'blocked' | 'none'

export class ReplaySound {
  readonly sw = new Swell()
  private started: Promise<boolean> | null = null
  private bytes = new Map<string, Promise<ArrayBuffer | null>>()
  private stemOf = new Map<string, 'sea' | 'left'>()
  private played = new Set<string>()
  private level = 0.55
  muted = false

  /** fetch the pieces the run played (not decoded yet: that needs the audio context) */
  prefetch(sound: EarSessionRec['sound'], kind: EarSessionRec['kind']): void {
    const ids = [...new Set(sound.filter((x) => x.made !== 'tone').map((x) => x.id))]
    void loadManifest()
      .then((m) => {
        for (const b of m.beds) if (ids.includes(b.id)) this.stemOf.set(b.id, b.input?.kind === kind ? 'sea' : 'left')
      })
      .catch(() => {})
    for (const id of ids) {
      this.bytes.set(
        id,
        fetch(apiUrl(`sound/clip/${encodeURIComponent(id)}`))
          .then((r) => (r.ok ? r.arrayBuffer() : null))
          .catch(() => null),
      )
    }
  }

  /** try to start; resolves with what happened within a short while */
  async start(): Promise<SoundState> {
    if (!this.started) this.started = this.sw.start()
    const ok = await Promise.race([this.started, new Promise<null>((r) => setTimeout(() => r(null), 600))])
    if (ok === false) return 'none'
    return this.sw.context?.state === 'running' && ok ? 'on' : 'blocked'
  }

  /** inside a tap */
  async unblock(): Promise<SoundState> {
    const ctx = this.sw.context
    if (ctx && ctx.state !== 'running') await ctx.resume().catch(() => {})
    return this.start()
  }

  on(v: boolean): void {
    this.muted = !v
    this.sw.level(v ? this.level : 0, v ? 0.6 : 0.3)
  }

  breath(inS: number, outS: number, depth = 1): void {
    if (!this.muted) this.sw.breath(inS, outS, depth)
  }

  chime(high = false): void {
    if (!this.muted) this.sw.chime(high)
  }

  /** a piece the run played comes in, from the moment it came in the run */
  async piece(id: string): Promise<void> {
    if (this.played.has(id)) return
    this.played.add(id)
    const ctx = this.sw.context
    const data = await this.bytes.get(id)
    if (!ctx || !data) return
    try {
      const buf = await ctx.decodeAudioData(data.slice(0))
      this.sw.setStem(this.stemOf.get(id) ?? 'sea', buf, id)
    } catch {
      /* the phone's own sea goes on */
    }
  }

  /** from the start again: the pieces may come in again */
  rewind(): void {
    this.played.clear()
  }

  stop(): void {
    this.sw.stop()
    this.started = null
  }
}
