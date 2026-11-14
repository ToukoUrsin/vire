// The phone's camera, microphone and loudspeaker for a scripted capture.
// Camera: a canvas fed by clips of a real face; the script switches clips when the app's prompt changes, the way
//   a person changes their face. Microphone: silence, plus a recording of real speech when the script "answers".
// Loudspeaker: everything the app plays is also recorded, so the film has the product's own sound.
// The camera picture and the app's sound are streamed to disk through the `__filmChunk` binding.
import { appendFileSync, writeFileSync } from 'node:fs'

/**
 * files: { name: absolute path } for the face clips (webm) and one speech recording under the name `speech.wav`.
 * outDir: where camera.webm and sound.webm are written. log(event) receives { name, t } with t in epoch seconds.
 * Call before the first page of the context is opened.
 */
export async function installIO(context, files, outDir, log) {
  const mime = (n) => (n.endsWith('.wav') ? 'audio/wav' : 'video/webm')
  await context.route('**/__film/*', (route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '')
    return files[name] ? route.fulfill({ path: files[name], contentType: mime(name) }) : route.fulfill({ status: 404, body: '' })
  })
  const started = {}
  await context.exposeBinding('__filmChunk', (_src, kind, b64, t) => {
    const path = `${outDir}/${kind}.webm`
    if (!started[kind]) {
      started[kind] = true
      writeFileSync(path, Buffer.from(b64, 'base64'))
      log({ name: `${kind}-rec-start`, t: t / 1000 })
    } else appendFileSync(path, Buffer.from(b64, 'base64'))
  })
  await context.exposeBinding('__filmEvent', (_src, ev) => log(ev))

  await context.addInitScript((names) => {
    if (window.top !== window) return
    const send = async (kind, blob, t) => {
      const u8 = new Uint8Array(await blob.arrayBuffer())
      let s = ''
      for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000))
      await window.__filmChunk(kind, btoa(s), t)
    }
    // one writer per kind, so chunks land in order
    const queues = {}
    const push = (kind, blob, t) => {
      queues[kind] = (queues[kind] ?? Promise.resolve()).then(() => send(kind, blob, t)).catch(() => {})
    }

    // ---- camera ----
    const W = 640
    const H = 480
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const g = canvas.getContext('2d')
    g.fillStyle = '#2a2622'
    g.fillRect(0, 0, W, H)
    const vids = {}
    let cur = null
    const cam = {
      ready: false,
      name: '',
      async load() {
        for (const n of names.filter((x) => x.endsWith('.webm'))) {
          const blob = await (await fetch('/__film/' + encodeURIComponent(n))).blob()
          const v = document.createElement('video')
          v.muted = true
          v.playsInline = true
          v.preload = 'auto'
          v.src = URL.createObjectURL(blob)
          await new Promise((res) => {
            v.oncanplaythrough = res
            v.onerror = res
            setTimeout(res, 8000)
          })
          vids[n] = v
        }
        cam.ready = true
      },
      /** show this clip from `start` seconds on, then keep looping the part between `from` and `to` */
      play(n, from = 0, to = 1e9, start = from) {
        const v = vids[n]
        if (!v) throw new Error('no clip ' + n)
        if (cur && cur.v !== v) cur.v.pause()
        cur = { v, from, to: Math.min(to, (v.duration || 1e9) - 0.06) }
        v.currentTime = Math.min(start, from)
        v.play().catch(() => {})
        cam.name = n
      },
      time: () => (cur ? cur.v.currentTime : -1),
      /** record what the camera shows, for the film's "what the camera saw" inset */
      record() {
        if (cam.rec) return
        const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 4_000_000 })
        let first = true
        const t0 = Date.now()
        rec.ondataavailable = (e) => {
          if (e.data.size) push('camera', e.data, first ? t0 : 0)
          first = false
        }
        rec.start(1000)
        cam.rec = rec
      },
      stop() {
        try {
          cam.rec?.stop()
        } catch {}
      },
    }
    window.__cam = cam
    const draw = () => {
      if (cur) {
        const v = cur.v
        if (v.ended || v.currentTime >= cur.to) {
          v.currentTime = cur.from
          v.play().catch(() => {})
        }
        if (v.readyState >= 2) g.drawImage(v, 0, 0, W, H)
      }
      requestAnimationFrame(draw)
    }
    requestAnimationFrame(draw)

    // ---- microphone ----
    const NativeAC = window.AudioContext
    let micCtx = null
    let micOut = null
    let speech = null
    let talking = null
    const mic = {
      async load() {
        micCtx = new NativeAC()
        micOut = micCtx.createMediaStreamDestination()
        // a live track must carry samples: a silent source keeps it running
        const z = micCtx.createConstantSource()
        z.offset.value = 0
        z.connect(micOut)
        z.start()
        const ab = await (await fetch('/__film/speech.wav')).arrayBuffer()
        speech = await micCtx.decodeAudioData(ab)
      },
      /** the person talks: `dur` seconds of the recording from `from` */
      speak(from = 0, dur = 8) {
        if (!speech || !micCtx) return
        mic.quiet()
        const s = micCtx.createBufferSource()
        s.buffer = speech
        const gain = micCtx.createGain()
        gain.gain.value = 1
        s.connect(gain)
        gain.connect(micOut)
        s.start(0, from, dur)
        talking = s
      },
      quiet() {
        try {
          talking?.stop()
        } catch {}
        talking = null
      },
    }
    window.__mic = mic

    const md = navigator.mediaDevices
    md.getUserMedia = async (c = {}) => {
      const tracks = []
      if (c.video) tracks.push(...canvas.captureStream(30).getVideoTracks())
      if (c.audio && micOut) tracks.push(...micOut.stream.getAudioTracks().map((t) => t.clone()))
      return new MediaStream(tracks)
    }

    // ---- loudspeaker: record whatever the app sends to its output ----
    const taps = new WeakMap()
    const connect = AudioNode.prototype.connect
    AudioNode.prototype.connect = function (dest, ...rest) {
      const out = connect.call(this, dest, ...rest)
      try {
        if (dest instanceof AudioDestinationNode && dest.context !== micCtx) {
          let tap = taps.get(dest.context)
          if (!tap) {
            tap = dest.context.createMediaStreamDestination()
            taps.set(dest.context, tap)
            const rec = new MediaRecorder(tap.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192000 })
            let first = true
            const t0 = Date.now()
            rec.ondataavailable = (e) => {
              if (e.data.size) push('sound', e.data, first ? t0 : 0)
              first = false
            }
            rec.start(1000)
            window.__soundRec = rec
          }
          connect.call(this, tap)
        }
      } catch {}
      return out
    }
    // every sample the app starts, with its length: a second way to place the sound if the recording drifts
    const start = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (when = 0, ...rest) {
      try {
        if (this.context !== micCtx) {
          const late = Math.max(0, when - this.context.currentTime)
          window.__filmEvent({ name: 'sample', t: Date.now() / 1000 + late, dur: Math.round((this.buffer?.duration ?? 0) * 1000) / 1000 })
        }
      } catch {}
      return start.call(this, when, ...rest)
    }
  }, Object.keys(files))
}

/** screen recording through the DevTools screencast: every painted frame as a JPEG with its wall-clock time */
export async function screencast(page, dir, { maxWidth, maxHeight, quality = 92 }) {
  const { mkdirSync, writeFile } = await import('node:fs')
  mkdirSync(dir, { recursive: true })
  const cdp = await page.context().newCDPSession(page)
  const times = []
  cdp.on('Page.screencastFrame', (f) => {
    const i = times.length
    times.push(f.metadata.timestamp)
    writeFile(`${dir}/${String(i).padStart(6, '0')}.jpg`, Buffer.from(f.data, 'base64'), () => {})
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality, maxWidth, maxHeight, everyNthFrame: 1 })
  return {
    async stop() {
      await cdp.send('Page.stopScreencast').catch(() => {})
      await cdp.detach().catch(() => {})
      return times
    },
  }
}
