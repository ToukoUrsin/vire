// A stand-in for Vire Ears (the Mac helper) for tests on a machine without AirPods:
//   bun scripts/fake-ears.ts [port]     then in the page: localStorage['vire.ears.url'] = 'ws://127.0.0.1:<port>'
// It speaks the same messages and streams a head that nods now and then. Scripted motion: never a result.
const port = Number(process.argv[2] ?? 8893)
const timers = new Map<unknown, ReturnType<typeof setInterval>>()
Bun.serve({
  port,
  hostname: '127.0.0.1',
  fetch(req, server) {
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
              const att = [nod + 0.4 * Math.sin(s * 0.7), 12 * Math.sin(s * 0.25), 1.5 * Math.sin(s * 0.4)]
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
