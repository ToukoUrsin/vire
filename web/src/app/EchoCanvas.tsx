// The living echo: one figure, four layers in the four fixed channel colours, each answering its own signal.
// heart (rose) = the core, beating with the pulse wave · smile (amber) = petals that bloom
// voice (teal) = a ring that ripples · move (indigo) = an orbit that tilts with the head
import { useEffect, useRef } from 'react'
import { currentSense } from './session'

export type EchoMode = 'idle' | 'settle' | 'nod' | 'laugh' | 'speak' | 'breathe' | 'all'

interface Props {
  mode: EchoMode
  /** breath guide level 0..1 at `now` (performance.now()), or null for no guide */
  guide?: (now: number) => number | null
  className?: string
}

const COL = {
  smile: [233, 162, 59],
  voice: [42, 157, 143],
  heart: [209, 73, 91],
  move: [91, 106, 191],
  ink: [243, 236, 224],
} as const
const rgba = (c: readonly number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`

// how strongly each layer shows in each phase: the measured one steps forward, the rest recede
const WEIGHT: Record<EchoMode, { smile: number; voice: number; heart: number; move: number }> = {
  idle: { smile: 0.55, voice: 0.45, heart: 0.7, move: 0.55 },
  settle: { smile: 0.4, voice: 0.3, heart: 0.75, move: 0.4 },
  nod: { smile: 0.25, voice: 0.2, heart: 0.45, move: 1 },
  laugh: { smile: 1, voice: 0.2, heart: 0.5, move: 0.3 },
  speak: { smile: 0.25, voice: 1, heart: 0.45, move: 0.3 },
  breathe: { smile: 0.22, voice: 0.15, heart: 1, move: 0.25 },
  all: { smile: 0.9, voice: 0.7, heart: 0.9, move: 0.9 },
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

export default function EchoCanvas({ mode, guide, className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const modeRef = useRef(mode)
  const guideRef = useRef(guide)
  modeRef.current = mode
  guideRef.current = guide

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let raf = 0
    let w = 0
    let h = 0
    const dpr = Math.min(2, window.devicePixelRatio || 1)

    const fit = () => {
      const r = canvas.getBoundingClientRect()
      w = Math.max(1, r.width)
      h = Math.max(1, r.height)
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(canvas)

    const st = {
      last: 0,
      base: 0.06,
      bloom: 0,
      cheek: 0,
      beatPhase: 0,
      beat: 0,
      waveEnergy: 0,
      beatUp: false,
      lastBeat: 0,
      voice: 0,
      lastRipple: 0,
      pitch: 0,
      yaw: 0,
      roll: 0,
      pitch0: 0,
      yaw0: 0,
      primed: false,
      w: { ...WEIGHT[modeRef.current] },
      rot: Math.random() * 6,
      guide: 0,
      guideOn: 0,
    }
    const ripples: { born: number; amp: number }[] = []
    const beats: number[] = []

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      const dt = st.last ? Math.min(0.05, (now - st.last) / 1000) : 0.016
      st.last = now
      const k = (rate: number) => 1 - Math.exp(-rate * dt) // frame-rate independent smoothing

      const m = modeRef.current
      const target = WEIGHT[m]
      st.w.smile += (target.smile - st.w.smile) * k(3)
      st.w.voice += (target.voice - st.w.voice) * k(3)
      st.w.heart += (target.heart - st.w.heart) * k(3)
      st.w.move += (target.move - st.w.move) * k(3)

      // ---- signals: the real ones when sensing runs, a quiet synthetic life otherwise
      const l = currentSense()?.latest()
      const s = now / 1000
      const face = l?.face ?? null
      const head = l?.head ?? face
      const smileRaw = face ? face.smile : 0.1 + 0.07 * Math.sin(s * 0.45) + 0.03 * Math.sin(s * 1.1)
      const cheekRaw = face ? face.cheek : 0.05
      const pitchRaw = head ? head.pitch : 5 * Math.sin(s * 0.31)
      const yawRaw = head ? head.yaw : 7 * Math.sin(s * 0.23 + 1)
      const rollRaw = head ? head.roll : 2 * Math.sin(s * 0.17)
      const bpm = l?.pulse?.bpm ?? 62
      const waveRaw = l?.pulse ? l.pulse.wave : 0
      const rms = l?.voice ? l.voice.rms : -90
      const voiced = l?.voice ? l.voice.voiced : false
      const f0 = l?.voice?.f0 ?? null

      if (!st.primed && head) {
        st.pitch0 = pitchRaw
        st.yaw0 = yawRaw
        st.primed = true
      }
      // the resting smile is learned while nothing is asked of the face, then held during the laughter
      if (m !== 'laugh') st.base += (smileRaw - st.base) * k(0.6)
      const bloomT = clamp((smileRaw - st.base - 0.025) / 0.38, 0, 1)
      st.bloom += (bloomT - st.bloom) * k(bloomT > st.bloom ? 7 : 2.2)
      st.cheek += (cheekRaw - st.cheek) * k(4)

      st.waveEnergy += (Math.abs(waveRaw) - st.waveEnergy) * k(1)
      st.beatPhase += (bpm / 60) * dt
      const bp = st.beatPhase % 1
      const synth = Math.exp(-((bp - 0.15) ** 2) / 0.008) + 0.3 * Math.exp(-((bp - 0.42) ** 2) / 0.014)
      const beatT = st.waveEnergy > 0.04 ? clamp(waveRaw * 0.9 + 0.3, -0.2, 1.2) : synth
      st.beat += (beatT - st.beat) * k(18)
      if (!st.beatUp && st.beat > 0.55 && now - st.lastBeat > 330) {
        st.beatUp = true
        st.lastBeat = now
        beats.push(now)
        if (beats.length > 4) beats.shift()
      } else if (st.beatUp && st.beat < 0.3) st.beatUp = false

      const levelT = clamp((rms + 52) / 34, 0, 1) * (voiced ? 1 : 0.35)
      st.voice += (levelT - st.voice) * k(levelT > st.voice ? 16 : 4)
      if (st.voice > 0.28 && now - st.lastRipple > 170) {
        st.lastRipple = now
        ripples.push({ born: now, amp: st.voice })
        if (ripples.length > 12) ripples.shift()
      }

      st.pitch0 += (pitchRaw - st.pitch0) * k(0.15)
      st.yaw0 += (yawRaw - st.yaw0) * k(0.15)
      st.pitch += (pitchRaw - st.pitch0 - st.pitch) * k(12)
      st.yaw += (yawRaw - st.yaw0 - st.yaw) * k(12)
      st.roll += (rollRaw - st.roll) * k(6)

      const g = guideRef.current ? guideRef.current(now) : null
      st.guideOn += ((g == null ? 0 : 1) - st.guideOn) * k(2.5)
      if (g != null) st.guide += (g - st.guide) * k(10)

      // ---- draw
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'lighter'
      const S = Math.min(w, h)
      const R = S * 0.155
      const cx = w / 2 - clamp(st.yaw, -30, 30) * S * 0.0035
      const cy = h / 2 - clamp(st.pitch, -30, 30) * S * 0.0035
      st.rot += dt * (0.12 + 0.5 * st.bloom)

      // breath guide: a slow swell to follow with half-closed eyes
      if (st.guideOn > 0.01) {
        const gg = st.guide
        const rg = R * (1.55 + 1.55 * gg)
        const halo = ctx.createRadialGradient(cx, cy, R * 0.4, cx, cy, rg * 1.25)
        halo.addColorStop(0, rgba(COL.ink, (0.1 + 0.16 * gg) * st.guideOn))
        halo.addColorStop(0.7, rgba(COL.heart, (0.05 + 0.1 * gg) * st.guideOn))
        halo.addColorStop(1, rgba(COL.heart, 0))
        ctx.fillStyle = halo
        ctx.beginPath()
        ctx.arc(cx, cy, rg * 1.25, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = rgba(COL.ink, (0.22 + 0.4 * gg) * st.guideOn)
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(cx, cy, rg, 0, Math.PI * 2)
        ctx.stroke()
      }

      // move: an orbit that tilts with the head
      {
        const wm = st.w.move
        const tilt = ((66 + clamp(st.pitch, -40, 40) * 2.3) * Math.PI) / 180
        const yawA = (clamp(st.yaw, -60, 60) * 1.6 * Math.PI) / 180
        const rollA = (st.roll * Math.PI) / 180
        const Rr = R * 2.25
        const N = 72
        const pt = (a: number) => {
          const x = Math.cos(a) * Rr
          const y0 = Math.sin(a) * Rr
          const y = y0 * Math.cos(tilt)
          const z0 = y0 * Math.sin(tilt)
          const x1 = x * Math.cos(yawA) + z0 * Math.sin(yawA)
          const z1 = -x * Math.sin(yawA) + z0 * Math.cos(yawA)
          const xr = x1 * Math.cos(rollA) - y * Math.sin(rollA)
          const yr = x1 * Math.sin(rollA) + y * Math.cos(rollA)
          return [cx + xr, cy + yr, z1 / Rr] as const
        }
        ctx.lineCap = 'round'
        let prev = pt(0)
        for (let i = 1; i <= N; i++) {
          const p = pt((i / N) * Math.PI * 2)
          const depth = 0.5 + 0.5 * ((p[2] + prev[2]) / 2)
          ctx.strokeStyle = rgba(COL.move, (0.16 + 0.7 * depth) * (0.3 + 0.7 * wm))
          ctx.lineWidth = 1 + 2.2 * wm * depth
          ctx.beginPath()
          ctx.moveTo(prev[0], prev[1])
          ctx.lineTo(p[0], p[1])
          ctx.stroke()
          prev = p
        }
        const b = pt(s * 0.7)
        const br = 2.5 + 3.5 * wm * (0.5 + 0.5 * b[2])
        const glow = ctx.createRadialGradient(b[0], b[1], 0, b[0], b[1], br * 4)
        glow.addColorStop(0, rgba([170, 182, 255], 0.9 * (0.4 + 0.6 * wm)))
        glow.addColorStop(0.3, rgba(COL.move, 0.5 * wm))
        glow.addColorStop(1, rgba(COL.move, 0))
        ctx.fillStyle = glow
        ctx.beginPath()
        ctx.arc(b[0], b[1], br * 4, 0, Math.PI * 2)
        ctx.fill()
      }

      // smile: petals that open
      {
        const ws = st.w.smile
        const bloom = st.bloom
        for (const [lobes, dir, amp, alpha] of [
          [5, 1, 0.26, 1],
          [7, -0.7, 0.16, 0.55],
        ] as const) {
          const N = 90
          const rMax = R * (1.14 + bloom * (1.25 + amp))
          ctx.beginPath()
          for (let i = 0; i <= N; i++) {
            const a = (i / N) * Math.PI * 2
            const lobe = Math.cos(lobes * a + st.rot * dir)
            const r = R * (1.1 + 0.03 * lobe + bloom * (1.0 + amp * lobe + 0.05 * Math.sin(3 * a - s)))
            const x = cx + Math.cos(a) * r
            const y = cy + Math.sin(a) * r
            if (i === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          }
          ctx.closePath()
          const a0 = (0.1 + 0.5 * bloom + 0.12 * st.cheek) * (0.25 + 0.75 * ws) * alpha
          const gr = ctx.createRadialGradient(cx, cy, R * 0.5, cx, cy, rMax)
          gr.addColorStop(0, rgba(COL.smile, a0 * 0.15))
          gr.addColorStop(0.55, rgba(COL.smile, a0))
          gr.addColorStop(1, rgba(COL.smile, a0 * 0.12))
          ctx.fillStyle = gr
          ctx.fill()
          ctx.strokeStyle = rgba([255, 205, 120], (0.22 + 0.5 * bloom) * (0.3 + 0.7 * ws) * alpha)
          ctx.lineWidth = 1 + 0.8 * bloom
          ctx.stroke()
        }
      }

      // voice: a ring that shivers, and ripples that travel out
      {
        const wv = st.w.voice
        const lv = st.voice
        for (const rp of ripples) {
          const age = (now - rp.born) / 1500
          if (age >= 1) continue
          const r = R * (1.4 + age * 2.6)
          ctx.strokeStyle = rgba(COL.voice, (1 - age) ** 1.5 * 0.6 * rp.amp * (0.3 + 0.7 * wv))
          ctx.lineWidth = 1 + 2.5 * rp.amp * (1 - age)
          ctx.beginPath()
          ctx.arc(cx, cy, r, 0, Math.PI * 2)
          ctx.stroke()
        }
        const lobes = clamp(Math.round((f0 ?? 130) / 24), 4, 13)
        const N = 120
        ctx.beginPath()
        for (let i = 0; i <= N; i++) {
          const a = (i / N) * Math.PI * 2
          const d = lv * R * 0.2 * Math.sin(lobes * a + s * 9) * (0.6 + 0.4 * Math.sin(3 * a - s * 2.2))
          const r = R * 1.42 + d
          const x = cx + Math.cos(a) * r
          const y = cy + Math.sin(a) * r
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.closePath()
        ctx.strokeStyle = rgba([92, 205, 190], (0.2 + 0.7 * lv) * (0.3 + 0.7 * wv))
        ctx.lineWidth = 1.2 + 2 * lv * wv
        ctx.stroke()
      }

      // heart: the core, beating
      {
        const wh = st.w.heart
        for (const born of beats) {
          const age = (now - born) / 1100
          if (age >= 1) continue
          ctx.strokeStyle = rgba(COL.heart, (1 - age) ** 2 * 0.5 * wh)
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.arc(cx, cy, R * (0.9 + age * 1.5), 0, Math.PI * 2)
          ctx.stroke()
        }
        const rc = R * (0.8 + 0.12 * st.beat * (0.4 + 0.6 * wh))
        const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, rc * 1.5)
        const a = 0.5 + 0.5 * wh
        core.addColorStop(0, rgba([255, 226, 214], 0.95 * a))
        core.addColorStop(0.32, rgba([232, 110, 118], 0.85 * a))
        core.addColorStop(0.62, rgba(COL.heart, 0.5 * a))
        core.addColorStop(1, rgba(COL.heart, 0))
        ctx.fillStyle = core
        ctx.beginPath()
        ctx.arc(cx, cy, rc * 1.5, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalCompositeOperation = 'source-over'
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  return <canvas ref={ref} className={className} aria-hidden="true" />
}
