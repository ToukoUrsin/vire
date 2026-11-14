// A stand-in for Vire Ears (the Mac helper) for tests on a machine without AirPods:
//   bun scripts/fake-ears.ts [port]     then in the page: localStorage['vire.ears.url'] = 'ws://127.0.0.1:<port>'
// It speaks the same messages and streams a head that nods now and then. Scripted motion: never a result.
//
// A script can tell it how to move (the maker of the scripted replay does: web/tests/e2e/watch.mjs --make):
//   GET /script?mode=nod|shake|restless|calm|quiet|in|out[&secs=N]     (mode=off: back to the nods now and then)
// `in` and `out` raise and lower the head a little over N seconds, as a chest that breathes with the sound does;
// `restless` and `calm` are a head sitting still, the first fidgeting more than the second. Still a script.
const port = Number(process.argv[2] ?? 8893)
const timers = new Map<unknown, ReturnType<typeof setInterval>>()

type Mode = 'nod' | 'shake' | 'restless' | 'calm' | 'quiet' | 'in' | 'out'
const MODES = new Set(['nod', 'shake', 'restless', 'calm', 'quiet', 'in', 'out'])
const script = { mode: null as Mode | null, at: 0, secs: 4, from: 0, to: 0, depth: 0.6 }
/** the breath's share of the head's pitch right now, degrees */
let breath = 0
const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : (1 - Math.cos(Math.PI * x)) / 2)
function setScript(mode: string, secs: number): boolean {
  if (mode === 'off') return (script.mode = null), true
  if (!MODES.has(mode)) return false
  if (mode === script.mode && mode !== 'in' && mode !== 'out') return true
  script.mode = mode as Mode
  script.at = Date.now()
  script.secs = Math.max(0.5, secs || 4)
  script.from = breath
  // each breath a little deeper or shallower than the last, as a person's are
  if (mode === 'in') script.depth = 0.3 + 0.15 * Math.random()
  script.to = mode === 'in' ? script.depth : mode === 'out' ? -script.depth : 0
  return true
}
/** scripted head angles [pitch, yaw, roll] at time t (ms) */
function scripted(t: number): number[] {
  const s = t / 1000
  const since = (t - script.at) / 1000
  const m = script.mode
  // a person starts a breath a moment after the sound does
  if (m === 'in' || m === 'out') breath = script.from + (script.to - script.from) * ease((since - 0.3) / Math.max(0.5, script.secs - 0.4))
  else if (m === 'restless') breath = 0.3 * Math.sin(2 * Math.PI * 0.2 * s)
  else if (m === 'calm') breath = 0.35 * Math.sin(2 * Math.PI * (7 / 60) * s)
  else breath = 0.2 * Math.sin(2 * Math.PI * 0.22 * s)
  // small quick movement of a head that sits: more of it when restless
  const fidget = m === 'restless' ? 0.62 : m === 'calm' ? 0.5 : m === 'nod' || m === 'shake' ? 0.5 : 0.3
  const nod = m === 'nod' ? 9 * Math.sin(2 * Math.PI * 1.6 * since) * ease(since / 0.3) : 0
  const shake = m === 'shake' ? 12 * Math.sin(2 * Math.PI * 1.8 * since) * ease(since / 0.3) : 0
  return [
    breath + nod + 0.12 * fidget * Math.sin(2 * Math.PI * 0.83 * s + 1),
    shake + fidget * Math.sin(2 * Math.PI * 0.6 * s) + 0.4 * Math.sin(2 * Math.PI * 0.021 * s),
    0.25 * fidget * Math.sin(2 * Math.PI * 0.71 * s + 2) + 0.15 * breath,
  ]
}
Bun.serve({
  port,
  hostname: '127.0.0.1',
  fetch(req, server) {
    const url = new URL(req.url)
    if (url.pathname === '/script') {
      const ok = setScript(url.searchParams.get('mode') ?? '', Number(url.searchParams.get('secs')))
      return new Response(ok ? 'ok' : 'no such mode', { status: ok ? 200 : 400, headers: { 'access-control-allow-origin': '*' } })
    }
    return server.upgrade(req) ? undefined : new Response('Vire Ears stand-in', { status: 426 })
  },
  websocket: {
    open(ws) {
      ws.send(JSON.stringify({ k: 'hello', shell: 'mac', v: 1, available: true, permission: 'allowed' }))
      ws.send(JSON.stringify({ k: 'caps', airpodsMotion: false, airpodsHr: false }))
      ws.send(JSON.stringify({ k: 'status', airpods: 'disconnected', hr: 'off', permission: 'allowed' }))
    },
    message(ws, raw) {
      let cmd = ''
      try {
        cmd = (JSON.parse(String(raw)) as { cmd?: string }).cmd ?? ''
      } catch {
        return
      }
      if (cmd === 'start' && !timers.has(ws)) {
        ws.send(JSON.stringify({ k: 'caps', airpodsMotion: true, airpodsHr: false }))
        ws.send(JSON.stringify({ k: 'status', airpods: 'connected', hr: 'off', permission: 'allowed' }))
        let n = 0
        let last = [0, 0, 0]
        timers.set(
          ws,
          setInterval(() => {
            const rows: number[][] = []
            for (let i = 0; i < 3; i++) {
              const t = Date.now() - (2 - i) * 40
              const s = n++ / 25
              const nod = s % 9 < 2.4 ? 9 * Math.sin(2 * Math.PI * 1.6 * s) : 0
              const att = script.mode ? scripted(t) : [nod + 0.4 * Math.sin(s * 0.7), 12 * Math.sin(s * 0.25), 1.5 * Math.sin(s * 0.4)]
              const rate = att.map((v, k) => (v - last[k]) * 25)
              last = att
              rows.push([t, ...att, 0.004 * Math.sin(s * 31), 0.003 * Math.cos(s * 27), 0.002 * Math.sin(s * 19), ...rate].map((v) => Math.round(v * 1000) / 1000))
            }
            ws.send(JSON.stringify({ k: 'head', s: rows }))
          }, 120),
        )
      }
      if (cmd === 'stop') {
        clearInterval(timers.get(ws))
        timers.delete(ws)
      }
    },
    close(ws) {
      clearInterval(timers.get(ws))
      timers.delete(ws)
    },
  },
})
console.log(`Vire Ears stand-in on ws://127.0.0.1:${port}`)
