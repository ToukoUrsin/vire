// Native bridge (see "Native bridge" in CONTRACT.md). Two carriers, the same messages:
//  - the iOS shell around this page (window.webkit.messageHandlers.vire)
//  - "Vire Ears", the helper on a Mac, over a WebSocket on this machine. Only ever tried after the person pressed
//    "Connect AirPods" on this browser: a page that knocks on the local network unasked gets a permission prompt.
// Absent in a plain browser.

export type NativeMsg =
  | { k: 'caps'; airpodsMotion: boolean; airpodsHr: boolean }
  /** rows of [t epoch ms, pitchDeg, yawDeg, rollDeg, ax, ay, az, rxDegS, ryDegS, rzDegS] (the last three from shell v2 on) */
  | { k: 'head'; s: number[][] }
  | { k: 'hr'; t: number; bpm: number }
  /** the iPhone app, newer builds: each heart-rate sample as Health stored it, with what measured it */
  | { k: 'hrs'; t: number; bpm: number; src: string; model: string; n: number }
  | {
      k: 'status'
      airpods: 'connected' | 'disconnected'
      hr: 'off' | 'starting' | 'on' | 'denied'
      /** 'allowed' | 'denied' | 'restricted' | 'not asked': the system's motion permission for the shell */
      permission?: string
      error?: string
      /** the iPhone shell only: can this phone read headphone motion, where its sound goes now, how many samples so far */
      available?: boolean
      route?: string
      samples?: number
    }
  /** the Mac helper only: sent on connect */
  | { k: 'hello'; shell: 'mac'; v: number; available: boolean; permission: string }

export type NativeCmd = { cmd: 'start' } | { cmd: 'stop' } | { cmd: 'heart'; on: boolean }

interface VireWindow {
  webkit?: { messageHandlers?: { vire?: { postMessage(msg: unknown): void } } }
  __vireNative?: (msg: NativeMsg) => void
}

const w = (): VireWindow => (typeof window === 'undefined' ? {} : (window as unknown as VireWindow))

const shell = () => w().webkit?.messageHandlers?.vire

export function hasNative(): boolean {
  return !!shell() || earsState === 'on'
}

export function postNative(msg: NativeCmd): void {
  try {
    const s = shell()
    if (s) return s.postMessage(msg)
    if (msg.cmd === 'start') earsWanted = true
    if (msg.cmd === 'stop') earsWanted = false
    if (ears && ears.readyState === 1) ears.send(JSON.stringify(msg))
  } catch (err) {
    console.warn('[sense] native post failed', err)
  }
}

type Listener = (msg: NativeMsg) => void
const listeners = new Set<Listener>()
/** the shell may report caps/status before anyone listens: keep the last of each */
let lastCaps: NativeMsg | null = null
let lastStatus: NativeMsg | null = null
let installed = false

function deliver(msg: NativeMsg): void {
  if (!msg || typeof msg !== 'object') return
  if (msg.k === 'caps') lastCaps = msg
  if (msg.k === 'status') lastStatus = msg
  for (const l of listeners) {
    try {
      l(msg)
    } catch (err) {
      console.warn('[sense] native listener failed', err)
    }
  }
}

function install(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  w().__vireNative = deliver
  if (!shell() && earsRemembered()) void connectEars()
}

/** subscribe to shell messages; replays the last caps + status. Returns the unsubscribe. */
export function onNative(cb: Listener): () => void {
  install()
  listeners.add(cb)
  if (lastCaps) cb(lastCaps)
  if (lastStatus) cb(lastStatus)
  return () => {
    listeners.delete(cb)
  }
}

// ------------------------------------------------------------ the Mac helper

const EARS_KEY = 'vire.ears'
/** where the helper listens; tests point it at a stand-in through localStorage (a link cannot set that) */
function earsUrl(): string {
  try {
    return localStorage.getItem('vire.ears.url') || 'ws://127.0.0.1:8873'
  } catch {
    return 'ws://127.0.0.1:8873'
  }
}
/** 'missing' = asked for and not there (no helper on this machine, or the browser refused) */
export type EarsState = 'off' | 'connecting' | 'on' | 'missing'
export interface EarsInfo {
  state: EarsState
  /** the Mac's own answer to "may Vire Ears read motion": 'allowed' | 'denied' | 'restricted' | 'not asked' */
  permission: string | null
  /** AirPods in and streaming */
  airpods: boolean
  error: string | null
}

let ears: WebSocket | null = null
let earsState: EarsState = 'off'
let earsWanted = false
let earsPermission: string | null = null
let earsAirpods = false
let earsError: string | null = null
let earsRetry: ReturnType<typeof setTimeout> | null = null
const earsListeners = new Set<(i: EarsInfo) => void>()

export function earsInfo(): EarsInfo {
  return { state: earsState, permission: earsPermission, airpods: earsAirpods, error: earsError }
}

/** hear about every change of the Mac helper's state; called once right away. Returns the unsubscribe. */
export function onEars(cb: (i: EarsInfo) => void): () => void {
  earsListeners.add(cb)
  cb(earsInfo())
  return () => {
    earsListeners.delete(cb)
  }
}

function earsChanged(): void {
  const i = earsInfo()
  for (const l of earsListeners) {
    try {
      l(i)
    } catch (err) {
      console.warn('[sense] ears listener failed', err)
    }
  }
}

export function earsRemembered(): boolean {
  try {
    return localStorage.getItem(EARS_KEY) === '1'
  } catch {
    return false
  }
}

/** stop using the Mac helper on this browser */
export function forgetEars(): void {
  try {
    localStorage.removeItem(EARS_KEY)
  } catch {
    /* private mode */
  }
  if (earsRetry) clearTimeout(earsRetry)
  earsRetry = null
  const s = ears
  ears = null
  s?.close()
  earsState = 'off'
  earsAirpods = false
  earsChanged()
}

/**
 * Look for Vire Ears on this machine. Call from the "Connect AirPods" press; after one success this browser
 * reconnects on its own. Resolves true once the helper has answered.
 */
export function connectEars(): Promise<boolean> {
  if (typeof WebSocket === 'undefined' || shell()) return Promise.resolve(false)
  if (ears && earsState === 'on') return Promise.resolve(true)
  if (earsRetry) clearTimeout(earsRetry)
  earsRetry = null
  return new Promise((resolve) => {
    let settled = false
    const done = (ok: boolean) => {
      if (settled) return
      settled = true
      resolve(ok)
    }
    let s: WebSocket
    try {
      s = new WebSocket(earsUrl())
    } catch {
      earsState = 'missing'
      earsChanged()
      return done(false)
    }
    ears = s
    earsState = 'connecting'
    earsChanged()
    // a browser that blocks the helper's address (Safari from an https page) never opens the socket and never closes it:
    // settle here, or the page waits for ever with its button greyed
    const giveUp = setTimeout(() => {
      if (earsState !== 'connecting' || ears !== s) return
      ears = null
      earsState = 'missing'
      earsAirpods = false
      earsChanged()
      done(false)
      try {
        s.close()
      } catch {
        /* never opened */
      }
    }, 3000)
    s.onopen = () => {
      clearTimeout(giveUp)
      if (ears !== s) return
      earsState = 'on'
      try {
        localStorage.setItem(EARS_KEY, '1')
      } catch {
        /* private mode: connected for this visit only */
      }
      // the helper starts the AirPods only when asked; ask now, so the Mac's own permission question comes with this press
      s.send(JSON.stringify({ cmd: 'start' }))
      earsChanged()
      done(true)
    }
    s.onmessage = (e) => {
      if (ears !== s) return
      let msg: NativeMsg
      try {
        msg = JSON.parse(String(e.data)) as NativeMsg
      } catch {
        return
      }
      if (!msg || typeof msg !== 'object') return
      if (msg.k === 'hello') earsPermission = msg.permission
      if (msg.k === 'status') {
        if (msg.permission) earsPermission = msg.permission
        earsError = msg.error ?? null
        earsAirpods = msg.airpods === 'connected'
      }
      if (msg.k === 'head' && !earsAirpods) {
        earsAirpods = true
        earsPermission = 'allowed'
        earsChanged()
      }
      if (msg.k === 'hello' || msg.k === 'status') earsChanged()
      if (msg.k !== 'hello') deliver(msg)
    }
    s.onclose = () => {
      clearTimeout(giveUp)
      if (ears !== s) return
      ears = null
      const was = earsState
      earsState = was === 'on' ? 'off' : 'missing'
      earsAirpods = false
      if (was === 'on') deliver({ k: 'status', airpods: 'disconnected', hr: 'off' })
      earsChanged()
      done(false)
      // the helper restarts, the Mac wakes: keep knocking quietly while this browser is meant to use it
      if (earsRemembered()) earsRetry = setTimeout(() => void connectEars().then(() => earsWanted && postNative({ cmd: 'start' })), 3000)
    }
    s.onerror = () => {
      /* onclose follows */
    }
  })
}

// install at import so nothing the shell sends early is lost
install()

/** epoch ms (Date.now clock) -> performance.now() ms */
export function epochToPerf(t: number): number {
  return t - performance.timeOrigin
}
