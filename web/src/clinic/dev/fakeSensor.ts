// Fake sensor for the live mirror: connects to the relay as a sensor and plays a synthetic 58 s ping.
// With --show it plays what the round-2 phone sends: tune (five faces, training, accuracy), the ping with
// mesh, muscles, head pose and AirPods fields, the echo, a dose and the re-measure.
//
//   bun web/src/clinic/dev/fakeSensor.ts                       # room DEMO01 on 127.0.0.1:8871
//   bun web/src/clinic/dev/fakeSensor.ts --room AB12CD --name Aino --vigor 0.65 --loop
//   bun web/src/clinic/dev/fakeSensor.ts --url https://host:8443/vire --speed 2
//   bun web/src/clinic/dev/fakeSensor.ts --show                # the whole stage show, about 135 s
//   bun web/src/clinic/dev/fakeSensor.ts --show --cam          # no AirPods: head and heart from the camera
//   bun web/src/clinic/dev/fakeSensor.ts --show --no-tune --no-dose --mini-echo --no-mesh
//
// Then open  <app>/#/clinic/live/DEMO01  (or /#/clinic/live to auto-open the newest room).
// --vigor: 1 = the person's usual response, 0.6 = a flat day. --speed 2 plays twice as fast.
// Frames follow the phone's conventions (epoch-ms timestamps, voice level in dBFS); --linear keeps the raw synth values.
import type { LiveMessage } from '../../../../shared/types'
import { createPingPlayer, createShow } from './synth'
import type { PingPlayer } from './synth'

// the web tsconfig has no node types; this is all the script needs
declare const process: { argv: string[]; exit(code?: number): never }

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const flag = (name: string) => process.argv.includes(`--${name}`)

const base = arg('url', 'http://127.0.0.1:8871').replace(/\/$/, '')
const room = arg('room', 'DEMO01').toUpperCase()
const name = arg('name', 'Aino')
const vigor = Number(arg('vigor', '0.68'))
const speed = Number(arg('speed', '1'))
const loop = flag('loop')
const linear = flag('linear')
const show = flag('show')

const make = (v: number, seed = 1): PingPlayer =>
  show
    ? createShow({
        vigor: v,
        seed,
        hz: 25,
        rich: { airpods: !flag('cam'), ear: !flag('cam') && !flag('no-ear'), meshHz: flag('no-mesh') ? 0 : 10, muscles: !flag('no-muscles') },
        tune: !flag('no-tune'),
        tuneBare: flag('bare-tune'),
        dose: !flag('no-dose'),
        miniEcho: flag('mini-echo'),
      })
    : createPingPlayer({ vigor: v })

/** what web/src/app/session.ts sends: t and at are Date.now(), rms is dBFS with -90 for silence */
const asPhone = (m: LiveMessage): LiveMessage => {
  if (linear) return m
  if (m.type === 'frame') return { ...m, t: Date.now(), rms: m.rms > 0 ? Math.max(-90, +(20 * Math.log10(m.rms)).toFixed(1)) : -90 }
  if (m.type === 'mesh') return { ...m, t: Date.now() }
  if (m.type === 'phase') return { ...m, at: Date.now() }
  return m
}

const u = new URL(`${base}/api/live`)
u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
u.searchParams.set('room', room)
u.searchParams.set('role', 'sensor')
u.searchParams.set('name', name)

const ws = new WebSocket(u.toString())
const send = (m: LiveMessage) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m))

ws.addEventListener('error', () => {
  console.error(`fakeSensor: cannot reach ${u}`)
  process.exit(1)
})
ws.addEventListener('close', () => process.exit(0))
ws.addEventListener('open', () => {
  console.log(`fakeSensor: ${name} in room ${room} -> ${u.origin}${u.pathname}  (vigor ${vigor}, ${show ? 'the whole show' : 'one ping'}${loop ? ', looping' : ''})`)
  send({ type: 'hello', role: 'sensor', name })
  let player = make(vigor)
  let round = 0
  let started = Date.now() + 1500 // a short idle lead-in so viewers see the room appear
  let frames = 0
  let said = ''
  setInterval(() => {
    const elapsed = (Date.now() - started) * speed
    if (elapsed < 0) return
    for (const m of player.step(elapsed)) {
      send(asPhone(m))
      if (m.type === 'frame') frames++
      if (m.type === 'phase' && m.phase !== said) {
        said = m.phase
        console.log(`  ${(elapsed / 1000).toFixed(0).padStart(3)} s  ${m.phase}`)
      }
      if (m.type === 'tune') console.log(`  ${(elapsed / 1000).toFixed(0).padStart(3)} s  tune ${m.step}`)
      if (m.type === 'echo') console.log(`  echo ${m.echo.strength} (${m.echo.status}) after ${frames} frames`)
    }
    if (elapsed > player.durationMs) {
      if (!loop) {
        ws.close()
        return
      }
      player = make(0.55 + Math.random() * 0.6, ++round + 1)
      started = Date.now() + 2000
      frames = 0
    }
  }, 25)
})
