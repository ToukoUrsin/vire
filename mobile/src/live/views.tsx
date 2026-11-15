// Two drawings fed straight from the samples, outside React's render: the head as the AirPods feel it,
// and a strip of the last few seconds of motion.
import { useEffect, useRef, type MutableRefObject } from 'react'

export interface Pose {
  t: number
  pitch: number
  yaw: number
  roll: number
}
const turn = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180
const css = (el: Element, name: string) => getComputedStyle(el).getPropertyValue(name).trim()

function fit(c: HTMLCanvasElement): { w: number; h: number; k: number } {
  const k = Math.min(3, window.devicePixelRatio || 1)
  const w = c.clientWidth
  const h = c.clientHeight
  if (c.width !== Math.round(w * k) || c.height !== Math.round(h * k)) {
    c.width = Math.round(w * k)
    c.height = Math.round(h * k)
  }
  return { w, h, k }
}

/**
 * A face that turns with the head, drawn as a mirror. The AirPods have no idea where straight ahead is, so it is
 * taken as where the head has rested lately (`drift`); a pose from the camera is already against the camera.
 */
export function HeadView({ pose, smile, drift = true, size = 264 }: { pose: MutableRefObject<Pose | null>; smile: MutableRefObject<number>; drift?: boolean; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let raf = 0
    let base: Pose | null = null
    const eased = { yaw: 0, pitch: 0, roll: 0, smile: 0, alive: 0 }
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const c = ref.current
      if (!c) return
      const g = c.getContext('2d')
      if (!g) return
      const { w, h, k } = fit(c)
      g.setTransform(k, 0, 0, k, 0, 0)
      g.clearRect(0, 0, w, h)
      const ink = css(c, '--ink') || '#f3ece0'
      const ember = css(c, '--ember') || '#e4572e'
      const p = pose.current
      const now = performance.now()
      const fresh = !!p && now - p.t < 1200
      eased.alive += ((fresh ? 1 : 0) - eased.alive) * 0.12
      let yaw = 0
      let pitch = 0
      let roll = 0
      if (p && fresh) {
        if (drift) {
          if (!base) base = { ...p, t: now }
          const f = Math.min(1, (now - base.t) / 12000)
          base.pitch += (p.pitch - base.pitch) * f
          base.roll += (p.roll - base.roll) * f
          base.yaw = turn(base.yaw + turn(p.yaw - base.yaw) * f)
          base.t = now
          yaw = turn(p.yaw - base.yaw)
          pitch = p.pitch - base.pitch
          roll = p.roll - base.roll
        } else {
          yaw = p.yaw
          pitch = p.pitch
          roll = p.roll
        }
      } else base = null
      const cl = (v: number, m: number) => Math.max(-m, Math.min(m, v))
      eased.yaw += (cl(yaw, 65) - eased.yaw) * 0.45
      eased.pitch += (cl(pitch, 40) - eased.pitch) * 0.45
      eased.roll += (cl(roll, 40) - eased.roll) * 0.45
      eased.smile += (Math.max(0, Math.min(1, smile.current)) - eased.smile) * 0.25
      const rad = Math.PI / 180
      const R = Math.min(w, h) * 0.36
      const dx = -Math.sin(eased.yaw * rad) * R * 0.55
      const dy = -Math.sin(eased.pitch * rad) * R * 0.5
      const wide = Math.cos(eased.yaw * rad)
      g.save()
      g.translate(w / 2, h / 2)
      g.rotate(-eased.roll * rad)
      g.lineCap = 'round'
      g.lineJoin = 'round'
      g.globalAlpha = 0.35 + 0.65 * eased.alive
      // the AirPods: behind the head on the far side, in front on the near one
      for (const side of [-1, 1]) {
        const ex = side * R * 0.8 - dx * 0.25
        const near = side * dx < 0 ? 1 : 0.55
        g.strokeStyle = ember
        g.globalAlpha = (0.35 + 0.65 * eased.alive) * near
        g.lineWidth = R * 0.085
        g.beginPath()
        g.moveTo(ex, dy * 0.3 - R * 0.03)
        g.lineTo(ex, dy * 0.3 + R * 0.25)
        g.stroke()
      }
      g.globalAlpha = 0.35 + 0.65 * eased.alive
      g.strokeStyle = ink
      g.fillStyle = ink
      g.lineWidth = R * 0.05
      g.beginPath()
      g.ellipse(0, 0, R * 0.8, R, 0, 0, Math.PI * 2)
      g.stroke()
      for (const side of [-1, 1]) {
        g.beginPath()
        g.arc(dx + side * R * 0.3 * wide, dy - R * 0.14, R * 0.045, 0, Math.PI * 2)
        g.fill()
      }
      g.lineWidth = R * 0.04
      g.beginPath()
      g.moveTo(dx * 1.3, dy)
      g.lineTo(dx * 1.3, dy + R * 0.16)
      g.stroke()
      const mw = R * (0.24 + 0.1 * eased.smile) * wide
      const my = dy + R * 0.44
      const curve = (0.03 + eased.smile * 0.3) * R
      g.lineWidth = R * 0.05
      g.beginPath()
      g.moveTo(dx - mw, my - curve * 0.35)
      g.quadraticCurveTo(dx, my + curve, dx + mw, my - curve * 0.35)
      g.stroke()
      g.restore()
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [pose, smile, drift])
  return <canvas ref={ref} style={{ width: size, height: size, display: 'block', margin: '0 auto' }} aria-label="Your head, as it is being read" role="img" />
}

/** the last six seconds, two rows on one clock: up and down (a nod lives here), side to side (a head shake) */
export function MotionStrip({ sub, height = 92 }: { sub: (cb: (s: { t: number; pitch: number; yaw: number }) => void) => () => void; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const buf: number[][] = []
    let yaw = 0
    let lastYaw: number | null = null
    let mp = 0
    let my = 0
    const off = sub((s) => {
      let d = lastYaw == null ? 0 : s.yaw - lastYaw
      if (d > 180) d -= 360
      else if (d < -180) d += 360
      yaw += d
      lastYaw = s.yaw
      if (!buf.length) {
        mp = s.pitch
        my = yaw
      }
      // the slow part is where the head rests; what is drawn is the movement around it
      mp += (s.pitch - mp) * 0.02
      my += (yaw - my) * 0.02
      buf.push([s.t, s.pitch - mp, yaw - my])
      while (buf.length && s.t - buf[0][0] > 6500) buf.shift()
    })
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const c = ref.current
      if (!c) return
      const g = c.getContext('2d')
      if (!g) return
      const { w, h, k } = fit(c)
      g.setTransform(k, 0, 0, k, 0, 0)
      g.clearRect(0, 0, w, h)
      const ink = css(c, '--ink') || '#f3ece0'
      const line = css(c, '--move') || '#7d89e0'
      const now = buf.length ? Math.max(buf[buf.length - 1][0], performance.now() - 80) : performance.now()
      const L = 86
      const rows = [
        { col: 1, label: 'up and down', y: h * 0.27 },
        { col: 2, label: 'side to side', y: h * 0.75 },
      ]
      g.font = '500 11.5px Inter, sans-serif'
      g.textBaseline = 'middle'
      for (const r of rows) {
        g.globalAlpha = 0.14
        g.strokeStyle = ink
        g.lineWidth = 1
        g.beginPath()
        g.moveTo(L, r.y)
        g.lineTo(w, r.y)
        g.stroke()
        g.globalAlpha = 0.62
        g.fillStyle = ink
        g.fillText(r.label, 0, r.y)
        g.globalAlpha = 1
        g.strokeStyle = line
        g.lineWidth = 2
        g.lineJoin = 'round'
        g.lineCap = 'round'
        g.beginPath()
        let started = false
        const amp = h * 0.2
        for (const s of buf) {
          const x = w - ((now - s[0]) / 6000) * (w - L)
          if (x < L) continue
          const y = r.y - Math.max(-1, Math.min(1, s[r.col] / 18)) * amp
          if (started) g.lineTo(x, y)
          else {
            g.moveTo(x, y)
            started = true
          }
        }
        g.stroke()
      }
    }
    raf = requestAnimationFrame(draw)
    return () => {
      off()
      cancelAnimationFrame(raf)
    }
  }, [sub])
  return <canvas ref={ref} style={{ width: '100%', height, display: 'block' }} aria-label="The last six seconds of head motion" role="img" />
}
