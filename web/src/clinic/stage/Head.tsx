// The head as a 3D object that turns with the person: a point-cloud head seen from three quarters, fixed shoulders
// under it, the AirPods in its ears, and a beam from the nose that draws the nod in the air. Plain canvas maths.
import { useEffect, useRef } from 'react'
import type { MoveSource } from '@shared/types'
import { CANON } from './canonData'
import { onFrame, palette, rgba, useCanvas } from './loop'
import type { Stage } from './store'

const LINES: number[][] = [
  [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10],
  [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246, 33],
  [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466, 263],
  [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185, 61],
  [70, 63, 105, 66, 107],
  [336, 296, 334, 293, 300],
  [168, 6, 197, 195, 5, 4, 1, 19, 94, 2],
  [98, 97, 2, 326, 327],
]

// the skull behind the face: points on an ellipsoid, kept where the face mesh is not
const SKULL = (() => {
  const c = [0, -250, 150]
  const r = [545, 615, 640]
  const pts: number[] = []
  const n = 520
  const ga = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < n; i++) {
    const v = 1 - (2 * (i + 0.5)) / n
    const rad = Math.sqrt(1 - v * v)
    const th = i * ga
    const nx = Math.cos(th) * rad
    const ny = v
    const nz = Math.sin(th) * rad
    const x = c[0] + nx * r[0]
    const y = c[1] + ny * r[1]
    const z = c[2] + nz * r[2]
    const back = z > -60 && y < 250
    const crown = y < -610 && z > -430
    if (back || crown) pts.push(x, y, z, nx, ny, nz)
  }
  return Float32Array.from(pts)
})()
const SKULL_N = SKULL.length / 6

/** where the head turns: a little under and behind the middle of the ears */
const PIVOT = [0, 90, 110]
const NOSE = [CANON[4 * 3], CANON[4 * 3 + 1], CANON[4 * 3 + 2]]
const BEAM = 620
const TRAIL = 46

export function Head({ stage, source, dim }: { stage: Stage; source: MoveSource | null; dim: boolean }) {
  const nums = useRef<(HTMLElement | null)[]>([])
  const trail = useRef({ x: new Float32Array(TRAIL), y: new Float32Array(TRAIL), n: 0, i: 0, last: 0 })
  const face = useRef({ x: new Float32Array(478), y: new Float32Array(478), z: new Float32Array(478) })

  const canvas = useCanvas((s, now) => {
    const { ctx, w, h } = s
    const p = palette()
    ctx.clearRect(0, 0, w, h)
    const sm = stage.sm
    const live = now - stage.lastFrameAt < 2500
    const air = source === 'airpods'

    // head pose (pitch about x, yaw about y, roll about z), then a fixed three-quarter view
    const a = (-sm.pitch * Math.PI) / 180
    const b = (-sm.yaw * Math.PI) / 180
    const c = (sm.roll * Math.PI) / 180
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    const cb = Math.cos(b)
    const sb = Math.sin(b)
    const cc = Math.cos(c)
    const sc = Math.sin(c)
    const vy = (-34 * Math.PI) / 180
    const vx = (9 * Math.PI) / 180
    const cvy = Math.cos(vy)
    const svy = Math.sin(vy)
    const cvx = Math.cos(vx)
    const svx = Math.sin(vx)
    const k = Math.min(w / 1420, h / 1900)
    const ox = w * 0.49
    const oy = h * 0.45
    const out = [0, 0, 0]
    const view = (x: number, y: number, z: number) => {
      const x1 = x * cvy + z * svy
      const z1 = -x * svy + z * cvy
      const y1 = y * cvx - z1 * svx
      const z2 = y * svx + z1 * cvx
      const pr = 5200 / (5200 + z2)
      out[0] = ox + x1 * k * pr
      out[1] = oy + (y1 + 120) * k * pr
      out[2] = z2
    }
    const posed = (x: number, y: number, z: number) => {
      x -= PIVOT[0]
      y -= PIVOT[1]
      z -= PIVOT[2]
      const y1 = y * ca - z * sa
      const z1 = y * sa + z * ca
      const x2 = x * cb + z1 * sb
      const z2 = -x * sb + z1 * cb
      const x3 = x2 * cc - y1 * sc
      const y3 = x2 * sc + y1 * cc
      view(x3 + PIVOT[0], y3 + PIVOT[1], z2 + PIVOT[2])
    }
    const lw = Math.max(1.3, k * 7)

    // shoulders and neck stay where they are: the frame the head turns against
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = rgba(p.ink, 0.2)
    ctx.lineWidth = lw
    ctx.beginPath()
    for (let i = 0; i <= 24; i++) {
      const u = i / 24 - 0.5
      view(u * 2300, 930 + 190 * Math.pow(Math.abs(u) * 2, 2.2), 230)
      if (i) ctx.lineTo(out[0], out[1])
      else ctx.moveTo(out[0], out[1])
    }
    ctx.stroke()
    ctx.beginPath()
    for (const sx of [-1, 1]) {
      view(sx * 250, 540, 260)
      ctx.moveTo(out[0], out[1])
      view(sx * 300, 900, 250)
      ctx.lineTo(out[0], out[1])
    }
    ctx.stroke()

    // where the nose points at rest
    ctx.setLineDash([lw * 1.2, lw * 3])
    ctx.strokeStyle = rgba(p.ink, 0.22)
    ctx.beginPath()
    view(NOSE[0], NOSE[1], NOSE[2] - 40)
    ctx.moveTo(out[0], out[1])
    view(NOSE[0], NOSE[1], NOSE[2] - BEAM)
    ctx.lineTo(out[0], out[1])
    ctx.stroke()
    ctx.setLineDash([])

    // skull: dots, the far side fainter
    const dot = Math.max(1.2, k * 7)
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = rgba(p.ink, pass ? 0.5 : 0.13)
      ctx.beginPath()
      for (let i = 0; i < SKULL_N; i++) {
        const j = i * 6
        // the normal turned by the same pose and view: only its depth is needed
        let nx = SKULL[j + 3]
        let ny = SKULL[j + 4]
        let nz = SKULL[j + 5]
        const ny1 = ny * ca - nz * sa
        const nz1 = ny * sa + nz * ca
        const nx2 = nx * cb + nz1 * sb
        const nz2 = -nx * sb + nz1 * cb
        nx = nx2 * cc - ny1 * sc
        ny = nx2 * sc + ny1 * cc
        const vz1 = -nx * svy + nz2 * cvy
        const vz = ny * svx + vz1 * cvx
        if (vz < 0 !== (pass === 1)) continue
        posed(SKULL[j], SKULL[j + 1], SKULL[j + 2])
        ctx.rect(out[0] - dot / 2, out[1] - dot / 2, dot, dot)
      }
      ctx.fill()
    }

    // the face
    const f = face.current
    for (let i = 0; i < 478; i++) {
      posed(CANON[i * 3], CANON[i * 3 + 1], CANON[i * 3 + 2])
      f.x[i] = out[0]
      f.y[i] = out[1]
      f.z[i] = out[2]
    }
    ctx.fillStyle = rgba(p.ink, 0.34)
    ctx.beginPath()
    const fd = Math.max(1, k * 5)
    for (let i = 0; i < 468; i++) ctx.rect(f.x[i] - fd / 2, f.y[i] - fd / 2, fd, fd)
    ctx.fill()
    ctx.strokeStyle = rgba(p.ink, 0.9)
    ctx.lineWidth = lw * 1.25
    ctx.beginPath()
    for (const line of LINES) {
      for (let i = 0; i < line.length; i++) {
        const v = line[i]
        if (i) ctx.lineTo(f.x[v], f.y[v])
        else ctx.moveTo(f.x[v], f.y[v])
      }
    }
    ctx.stroke()

    // the AirPods: where the motion is measured
    const glow = air ? 0.75 + 0.25 * Math.sin(now / 420) : 0
    for (const sx of [-1, 1]) {
      posed(sx * 548, -70, 70)
      const ex = out[0]
      const ey = out[1]
      const far = out[2] > 250
      posed(sx * 556, 150, -10)
      ctx.strokeStyle = air ? rgba('#ffffff', far ? 0.35 : 0.95) : rgba(p.ink, far ? 0.15 : 0.4)
      ctx.lineWidth = lw * 2.6
      ctx.beginPath()
      ctx.moveTo(ex, ey)
      ctx.lineTo(out[0], out[1])
      ctx.stroke()
      if (air && !far) {
        const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, k * 190)
        g.addColorStop(0, rgba(p.move, 0.55 * glow))
        g.addColorStop(1, rgba(p.move, 0))
        ctx.fillStyle = g
        ctx.fillRect(ex - k * 190, ey - k * 190, k * 380, k * 380)
      }
      ctx.fillStyle = air ? rgba('#ffffff', far ? 0.4 : 1) : rgba(p.ink, far ? 0.2 : 0.5)
      ctx.beginPath()
      ctx.arc(ex, ey, lw * 2.4, 0, Math.PI * 2)
      ctx.fill()
    }

    // the beam from the nose, and the path its tip has drawn: a nod is a stroke, a turn is an arc
    posed(NOSE[0], NOSE[1], NOSE[2] - 40)
    const bx = out[0]
    const by = out[1]
    posed(NOSE[0], NOSE[1], NOSE[2] - BEAM)
    const tx = out[0]
    const ty = out[1]
    const tr = trail.current
    if (now - tr.last > 24) {
      tr.last = now
      tr.x[tr.i] = tx
      tr.y[tr.i] = ty
      tr.i = (tr.i + 1) % TRAIL
      tr.n = Math.min(TRAIL, tr.n + 1)
    }
    const tint = '#aab4f2'
    if (live && tr.n > 2) {
      for (let j = 1; j < tr.n; j++) {
        const i0 = (tr.i - j - 1 + TRAIL * 2) % TRAIL
        const i1 = (tr.i - j + TRAIL * 2) % TRAIL
        const age = j / tr.n
        ctx.strokeStyle = rgba(tint, 0.75 * (1 - age) * (1 - age))
        ctx.lineWidth = lw * (3.4 - 2.2 * age)
        ctx.beginPath()
        ctx.moveTo(tr.x[i0], tr.y[i0])
        ctx.lineTo(tr.x[i1], tr.y[i1])
        ctx.stroke()
      }
    }
    const beam = ctx.createLinearGradient(bx, by, tx, ty)
    beam.addColorStop(0, rgba(tint, 0.15))
    beam.addColorStop(1, rgba(tint, live ? 0.95 : 0.4))
    ctx.strokeStyle = beam
    ctx.lineWidth = lw * 2
    ctx.beginPath()
    ctx.moveTo(bx, by)
    ctx.lineTo(tx, ty)
    ctx.stroke()
    ctx.fillStyle = live ? '#ffffff' : rgba(p.ink, 0.5)
    ctx.shadowColor = tint
    ctx.shadowBlur = live ? lw * 9 : 0
    ctx.beginPath()
    ctx.arc(tx, ty, lw * 2.6, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
  })

  useEffect(() => {
    let last = 0
    return onFrame((now) => {
      if (now - last < 120) return
      last = now
      const sm = stage.sm
      const live = now - stage.lastFrameAt < 2500
      const vals = [sm.pitch, sm.yaw, sm.roll]
      for (let i = 0; i < 3; i++) {
        const el = nums.current[i]
        if (!el) continue
        const r = Math.round(vals[i])
        const t = i === 0 && stage.phoneReadings.nod?.readable === false
          ? 'not read'
          : live
            ? `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r)}°`
            : 'listening'
        if (el.textContent !== t) el.textContent = t
      }
    })
  }, [stage])

  return (
    <section className={`sg-panel sg-head${dim ? ' is-dim' : ''}`} aria-label="Head motion">
      <header>
        <b>Head motion</b>
        <small>{source === 'airpods' ? 'from the AirPods' : source === 'camera' ? 'from the camera' : 'from the phone'}</small>
      </header>
      <canvas ref={canvas} />
      <dl>
        {['Nod', 'Turn', 'Tilt'].map((name, i) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd
              ref={(el) => {
                nums.current[i] = el
              }}
            >
              listening
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
