// The running session: one Sense, one live socket, one wake lock.
import type { LiveFrame, LiveMessage, PhaseKey } from '@shared/types'
import { createSense } from '../sense'
import type { Sense, SenseCapabilities } from '../sense/types'
import { wsUrl } from '../shared/api'
import { audio } from './audio'
import { createMockSense } from './mockSense'
import { attachModel, currentModel, detachModel, personalRead } from './personal'

export type LivePhase = PhaseKey | 'idle' | 'dose'

let sense: Sense | null = null
let mock = false
let started = false
let micOn = false
let starting: Promise<void> | null = null

let videoEl: HTMLVideoElement | null = null
/** the hidden <video playsInline muted> the sensing core reads the camera through */
export function attachVideo(el: HTMLVideoElement | null) {
  videoEl = el
}

export function wantsMock(): boolean {
  return /[?&]mock=1/.test(location.search) || /[?&]mock=1/.test(location.hash)
}

function make(forceMock: boolean): Sense {
  if (!forceMock && !wantsMock()) {
    try {
      mock = false
      return createSense()
    } catch {
      /* the sensing core has not landed: fall through to the scripted one */
    }
  }
  mock = true
  return createMockSense()
}

export const isMock = () => mock
export const isStarted = () => started
/** true when the microphone is part of the running session */
export const hasMic = () => started && micOn && !!sense?.caps.mic
/** the running Sense, or null before Start */
export const currentSense = (): Sense | null => (started ? sense : null)
/** what the sensing core can reach right now; in the native shell this is known before the camera starts */
export const currentCaps = (): SenseCapabilities | null => sense?.caps ?? null

// ---- native shell (iOS app around this page: AirPods motion and heart rate) ----

interface ShellWindow {
  webkit?: { messageHandlers?: { vire?: { postMessage(msg: unknown): void } } }
}
const bridge = () => (window as unknown as ShellWindow).webkit?.messageHandlers?.vire

export function isShell(): boolean {
  return /VireShell\/\d/.test(navigator.userAgent) || !!bridge()
}

/**
 * The shell only reports whether AirPods are in once it has been asked for motion. Ask as soon as a calm screen
 * is up, so the person can be told to put them in before the ping, not after.
 */
export function probeShell() {
  if (!isShell() || wantsMock() || started || starting) return
  if (!sense) sense = make(false)
  try {
    bridge()?.postMessage({ cmd: 'start' })
  } catch {
    /* an older shell: the status arrives with the ping */
  }
}

/**
 * Call inside a user gesture. Creates the AudioContext, asks for the camera (and the mic when `audio`) and starts
 * every stream. The mic is only opened for the full ping: on iPhone an open mic pushes AirPods into call mode,
 * so doses and the mini ping run with `audio: false`, and switching stops and restarts the sensing core.
 * `demo: true` switches to the scripted signals (offered when the camera is refused).
 */
export async function startSession(opts: { audio: boolean; demo?: boolean; camera?: boolean }): Promise<void> {
  audio.init()
  const video = videoEl
  if (!video) throw new Error('Vire is still loading. Try again in a moment.')
  if (starting) await starting.catch(() => {})
  const switchToDemo = !!opts.demo && !mock
  const wantCamera = opts.camera !== false
  if (started && micOn === opts.audio && !switchToDemo) {
    // the camera can go quiet behind our back (a call, the lock screen): a session nobody is feeding is not a session
    if (sense && ((wantCamera && (sense.caps.camera || mock)) || (!wantCamera && (sense.caps.airpodsMotion || sense.caps.mic || mock)))) return
  }
  if (sense && (started || switchToDemo)) {
    try {
      sense.stop()
    } catch {
      /* ignore */
    }
    started = false
    if (switchToDemo) sense = null
  }
  if (!sense) sense = make(!!opts.demo)
  const run = async () => {
    try {
      await begin(sense!, video, opts.audio, wantCamera)
    } catch (e) {
      const name = (e as { name?: string } | null)?.name ?? ''
      // a refusal is an answer, not a glitch: do not ask twice in a row
      if (mock || name === 'NotAllowedError' || name === 'SecurityError' || name === 'NotFoundError') throw e
      // a stopped core may not restart cleanly: try once more with a fresh one
      try {
        sense!.stop()
      } catch {
        /* ignore */
      }
      sense = make(false)
        await begin(sense, video, opts.audio, wantCamera)
    }
    started = true
    micOn = opts.audio
    attachModel(sense!)
  }
  starting = run().finally(() => {
    starting = null
  })
  return starting
}

function begin(s: Sense, video: HTMLVideoElement, withMic: boolean, camera = true): Promise<void> {
  let timer = 0
  return Promise.race([
    s.start({ video, audio: withMic, camera }),
    new Promise<void>((_, rej) => {
      timer = window.setTimeout(() => {
        // do not leave a half-open camera behind
        try {
          s.stop()
        } catch {
          /* ignore */
        }
        rej(new Error('Starting the camera took too long.'))
      }, 30000)
    }),
  ]).finally(() => clearTimeout(timer))
}

/** the model was just (re)trained or cleared: read with it from now on */
export function reapplyModel() {
  if (started && sense) attachModel(sense)
}

/** release the camera and mic. The live socket stays so the clinic keeps seeing the room. */
export function stopSession() {
  if (!sense) return
  detachModel()
  try {
    sense.setHeartSession(false)
    sense.setDetail(false)
    sense.stop()
  } catch {
    /* ignore */
  }
  started = false
}

// ---- wake lock: keep the screen on while a ping or a dose runs ----

interface WakeLockLike {
  release(): Promise<void>
  addEventListener?(ev: 'release', cb: () => void): void
}
let lock: WakeLockLike | null = null
let wantAwake = false
export async function keepAwake(on: boolean) {
  wantAwake = on
  const wl = (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<WakeLockLike> } }).wakeLock
  try {
    if (on && !lock && wl && document.visibilityState === 'visible') {
      const l = await wl.request('screen')
      lock = l
      // the browser drops the lock whenever the page is hidden
      l.addEventListener?.('release', () => {
        if (lock === l) lock = null
      })
      if (!wantAwake) void keepAwake(false)
    } else if (!on && lock) {
      const l = lock
      lock = null
      await l.release()
    }
  } catch {
    lock = null
  }
}

// coming back from another app, a call or the lock screen: wake the things iOS put to sleep
if (typeof document !== 'undefined') {
  const back = () => {
    if (document.visibilityState !== 'visible') return
    if (wantAwake) void keepAwake(true)
    if (started && videoEl && videoEl.paused && videoEl.srcObject) void videoEl.play().catch(() => {})
  }
  document.addEventListener('visibilitychange', back)
  window.addEventListener('pageshow', back)
}

// ---- live relay: mirrors the ping on the clinic's big screen ----

/** above this the hall network is not keeping up: the face wireframe waits, the numbers do not */
const MESH_BACKLOG = 64 * 1024
/** above this nothing new is queued at all */
const FRAME_BACKLOG = 512 * 1024

class Live {
  private ws: WebSocket | null = null
  private room = ''
  private name = ''
  private timer: number | null = null
  private meshTimer: number | null = null
  private phase: LivePhase = 'idle'
  private retry: number | null = null
  private wanted = false
  private lastMeshT = -1
  /** the tune step owns the detail switch while it runs */
  private tuning = false

  connect(room: string, name: string) {
    this.wanted = true
    if (this.ws && this.room === room && this.ws.readyState <= 1) return
    if (this.ws) this.drop()
    this.room = room
    this.name = name
    this.open()
  }

  private drop() {
    const ws = this.ws
    this.ws = null
    if (!ws) return
    ws.onclose = null
    try {
      ws.close()
    } catch {
      /* ignore */
    }
  }

  private open() {
    if (!this.wanted) return
    try {
      const q = `live?room=${encodeURIComponent(this.room)}&role=sensor&name=${encodeURIComponent(this.name || 'Guest')}`
      const ws = new WebSocket(wsUrl(q))
      this.ws = ws
      ws.onopen = () => {
        this.send({ type: 'hello', role: 'sensor', name: this.name || undefined })
        this.send({ type: 'phase', phase: this.phase, at: Date.now() })
      }
      ws.onerror = () => {}
      ws.onclose = () => {
        if (this.ws === ws) this.ws = null
        this.detail(false)
        if (this.wanted && this.retry == null) {
          this.retry = window.setTimeout(() => {
            this.retry = null
            this.open()
          }, 4000)
        }
      }
    } catch {
      this.ws = null
    }
  }

  send =(msg: LiveMessage) => {
    const ws = this.ws
    if (!ws || ws.readyState !== 1) return
    try {
      ws.send(JSON.stringify(msg))
    } catch {
      /* drop the frame */
    }
  }

  setPhase(phase: LivePhase) {
    this.phase = phase
    this.send({ type: 'phase', phase, at: Date.now() })
  }

  setTuning(on: boolean) {
    this.tuning = on
  }

  /** all blendshapes + the mesh on every face frame: only worth it while a screen is watching */
  private detail(on: boolean) {
    if (!on && this.tuning) return
    try {
      currentSense()?.setDetail(on)
    } catch {
      /* ignore */
    }
  }

  /** ~15 Hz numbers and ~10 Hz face wireframe from the latest sensor values while a ping, a dose or the tune step runs */
  startFrames() {
    if (this.timer != null) return
    this.timer = window.setInterval(() => this.frame(), 66)
    this.meshTimer = window.setInterval(() => this.mesh(), 100)
  }

  private frame() {
    const s = currentSense()
    const ws = this.ws
    if (!s || !ws || ws.readyState !== 1 || ws.bufferedAmount > FRAME_BACKLOG) return
    const l = s.latest()
    const head = l.head ?? l.face
    const p = personalRead()
    const camera = s.caps.camera
    const msg: LiveFrame = {
      type: 'frame',
      t: Date.now(),
      phase: this.phase,
      smile: round(l.face?.smile ?? 0, 3),
      cheek: round(l.face?.cheek ?? 0, 3),
      pitch: round(head?.pitch ?? 0, 2),
      yaw: round(head?.yaw ?? 0, 2),
      bpm: l.pulse?.bpm != null ? round(l.pulse.bpm, 1) : null,
      wave: round(l.pulse?.wave ?? 0, 3),
      rms: round(l.voice?.rms ?? -90, 1),
      f0: l.voice?.f0 != null ? round(l.voice.f0, 1) : null,
      roll: round(head?.roll ?? 0, 2),
      headSource: l.head?.source ?? 'camera',
      heartSource: l.pulse ? l.pulse.source : 'none',
      camera,
    }
    if (p.muscles && currentModel()) msg.muscles = p.muscles.map((x) => round(x, 3))
    if (p.face) msg.face = { label: p.face.label, p: round(p.face.p, 2) }
    if (p.earSmile != null) msg.earSmile = round(p.earSmile, 3)
    if (p.ear) msg.ear = Object.fromEntries(Object.entries(p.ear).map(([k, v]) => [k, round(v ?? 0, 3)])) as LiveFrame['ear']
    if (p.earOn.length) msg.earOn = [...p.earOn]
    if (p.rate != null) msg.rate = round(p.rate, 2)
    this.send(msg)
  }

  private mesh() {
    const s = currentSense()
    const ws = this.ws
    if (!s || !ws || ws.readyState !== 1 || !s.caps.camera) return
    // re-asserted on every tick: the tune step switches detail off when it ends
    this.detail(true)
    const f = s.latest().face
    const m = f?.present ? f.detail?.mesh : undefined
    if (!f || !m || f.t === this.lastMeshT) return
    // a slow network gets a choppier face, never a late ping
    if (ws.bufferedAmount > MESH_BACKLOG) return
    this.lastMeshT = f.t
    const pts = new Array<number>(m.length)
    for (let i = 0; i < m.length; i++) pts[i] = Math.round(m[i] * 1000)
    this.send({ type: 'mesh', t: Date.now(), pts })
  }

  stopFrames() {
    if (this.timer != null) clearInterval(this.timer)
    if (this.meshTimer != null) clearInterval(this.meshTimer)
    this.timer = null
    this.meshTimer = null
    this.detail(false)
    this.setPhase('idle')
  }

  close() {
    this.wanted = false
    this.stopFrames()
    if (this.retry != null) clearTimeout(this.retry)
    this.retry = null
    this.drop()
  }
}

const round = (x: number, d: number) => {
  const k = 10 ** d
  return Math.round(x * k) / k
}

export const live = new Live()

// ---- motion permission (iOS asks once, inside a gesture) ----

type Perm = { requestPermission?: () => Promise<'granted' | 'denied'> }
export async function askMotionPermission(): Promise<boolean> {
  let ok = true
  for (const E of [
    (window as unknown as { DeviceMotionEvent?: Perm }).DeviceMotionEvent,
    (window as unknown as { DeviceOrientationEvent?: Perm }).DeviceOrientationEvent,
  ]) {
    if (E?.requestPermission) {
      try {
        ok = (await E.requestPermission()) === 'granted' && ok
      } catch {
        ok = false
      }
    }
  }
  return ok
}
