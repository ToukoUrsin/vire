// A camera made of video clips, for driving the tune step with a real face in a headless browser.
// The page's getUserMedia returns a canvas stream; the test decides which clip the "person" is showing right now,
// the way a person changes their face when the prompt changes. Clips are served from disk through a route.
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
export const { chromium, webkit } = require('/home/ubuntu/.local/lib/node_modules/playwright')

/** files: { name: absolute path of a webm }. Call before the first page of the context is opened. */
export async function installCamera(context, files) {
  await context.route('**/__clips/*', (route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '')
    return files[name] ? route.fulfill({ path: files[name], contentType: 'video/webm' }) : route.fulfill({ status: 404, body: '' })
  })
  await context.addInitScript((names) => {
    if (window.top !== window) return
    const W = 640
    const H = 480
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#2a2622'
    ctx.fillRect(0, 0, W, H)
    const vids = {}
    let cur = null
    const cam = {
      ready: false,
      name: '',
      async load() {
        for (const n of names) {
          const blob = await (await fetch('/__clips/' + encodeURIComponent(n))).blob()
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
      /** nobody in front of the camera */
      away() {
        if (cur) cur.v.pause()
        cur = null
        cam.name = ''
        ctx.fillStyle = '#2a2622'
        ctx.fillRect(0, 0, W, H)
      },
      time: () => (cur ? cur.v.currentTime : -1),
      duration: (n) => vids[n]?.duration ?? 0,
    }
    window.__cam = cam
    const draw = () => {
      if (cur) {
        const v = cur.v
        if (v.ended || v.currentTime >= cur.to) {
          v.currentTime = cur.from
          v.play().catch(() => {})
        }
        if (v.readyState >= 2) ctx.drawImage(v, 0, 0, W, H)
      }
      requestAnimationFrame(draw)
    }
    requestAnimationFrame(draw)
    // a fresh stream per call: the app stops the tracks of the one it was given
    navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(30)
  }, Object.keys(files))
}

export const CLIPS = '/bulk2/runs/depression/tune/clips/webm/'

/**
 * Which clip plays for which asked-for face, per take: [file, loop from s, loop to s].
 * ravdess: RAVDESS actor 01 (Livingstone & Russo 2018, CC BY-NC-SA 4.0), video-only takes, strong intensity. The actor
 *   speaks a sentence with the acted emotion, so the mouth moves; every take of a face is a different recording.
 * commons: one man posing for the camera (Wikimedia Commons, "20140529 - ...", CC BY-SA 3.0). One recording per face,
 *   so a second take is a later second of the same recording, and there is no corners-down clip at all: he keeps a
 *   resting face for that step, which runs into its timeout.
 */
export const SETS = {
  ravdess: {
    dir: CLIPS + 'ravdess/',
    takes: {
      rest: [['02-01-01-01-01-01-01.webm', 0.6, 3.0], ['02-01-01-01-02-02-01.webm', 0.6, 3.0]],
      smile: [['02-01-03-02-01-01-01.webm', 0.9, 3.0], ['02-01-03-02-02-02-01.webm', 0.9, 3.0], ['02-01-03-02-01-02-01.webm', 0.9, 3.0]],
      sad: [['02-01-04-02-01-01-01.webm', 0.9, 3.0], ['02-01-04-02-02-02-01.webm', 0.9, 3.0]],
      angry: [['02-01-05-02-01-01-01.webm', 0.9, 3.0], ['02-01-05-02-02-02-01.webm', 0.9, 3.0]],
      surprised: [['02-01-08-02-01-01-01.webm', 0.9, 3.0], ['02-01-08-02-02-02-01.webm', 0.9, 3.0]],
    },
    // takes the tune step never showed, for checking the trained reader afterwards
    unseen: {
      rest: ['02-01-01-01-01-02-01.webm', 0.6, 3.0],
      smile: ['02-01-03-02-02-01-01.webm', 0.9, 3.0],
      sad: ['02-01-04-02-02-01-01.webm', 0.9, 3.0],
      angry: ['02-01-05-02-02-01-01.webm', 0.9, 3.0],
      surprised: ['02-01-08-02-02-01-01.webm', 0.9, 3.0],
    },
  },
  commons: {
    dir: CLIPS + 'commons/',
    // [file, loop from, loop to, start]: the clip plays from `start` (the face coming on), then loops its peak
    takes: {
      rest: [['blinking.webm', 0.3, 5.7]],
      smile: [['smiling.webm', 1.35, 2.1, 0.75], ['smiling.webm', 2.1, 2.8, 0.75], ['smiling.webm', 1.35, 2.8, 0.75]],
      sad: [['blinking.webm', 0.3, 5.7]],
      angry: [['frowning.webm', 0.5, 1.15, 0.25], ['frowning.webm', 1.15, 1.8, 0.25]],
      surprised: [['surprised.webm', 1.2, 1.8, 0.85], ['surprised.webm', 1.8, 2.45, 0.85]],
    },
    // the only second recording of any face: a weaker, one-browed surprise the tune step never showed
    unseen: { surprised: ['badly_surprised.webm', 0.4, 1.2, 0.2] },
  },
}

export function filesOf(set) {
  const files = {}
  for (const list of Object.values(set.takes)) for (const [f] of list) files[f] = set.dir + f
  for (const [f] of Object.values(set.unseen)) files[f] = set.dir + f
  return files
}

export function launch() {
  return chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] })
}
