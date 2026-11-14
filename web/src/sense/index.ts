// Vire sensing core. createSense() is the only thing the app needs; see ./types.ts for the interface.
//
//   face   MediaPipe FaceLandmarker on the front camera (./face.ts)
//   pulse  camera rPPG, POS on forehead + cheeks (./rppg.ts), or AirPods heart rate from the native shell
//   voice  mic through Web Audio, 50 Hz level / voicing / f0 (./voice.ts, ./pitch.ts)
//   head   AirPods motion from the native shell (./native.ts), else the camera head pose
//   ping   beginRecording / mark / endRecording -> PingFeatures + traces (./features.ts)

import type { PhaseKey, PingFeatures, PingTraces } from '@shared/types'
import { loadFaceTracker } from './face'
import type { FaceTracker } from './face'
import { HEART_MIN_QUALITY, computePing, emptyRecording } from './features'
import type { Recording } from './features'
import { epochToPerf, hasNative, onNative, postNative } from './native'
import type { NativeMsg } from './native'
import { CameraPulse, MotionGate } from './rppg'
import type { FaceCalibration, FaceFrame, HeadFrame, PulseSample, Sense, SenseCapabilities, SenseEvents, VoiceFrame } from './types'
import { startVoice } from './voice'
import type { VoiceCapture } from './voice'

export type * from './types'
export { createVoiceAnalyzer } from './pitch'
export { startVoice } from './voice'
export type { VoiceCapture } from './voice'
export type { VoiceAnalyzer } from './pitch'
export { CAMERA_LIMITS, cameraIssues } from './conditions'

/** extra read-only numbers for the lab page; not part of the app contract */
export interface SenseDebug {
  running: boolean
  /** camera frames analysed per second */
  fps: number
  /** ms of main-thread work per frame (model + pulse + bookkeeping) */
  frameMs: number
  frameMsP95: number
  /** of which: face model, skin colour sampling (last frame) */
  modelMs: number
  skinMs: number
  delegate: string
  voiceMode: string
  micLabel: string
  cameraLabel: string
  videoW: number
  videoH: number
  sampleRate: number
  /** pulse-band SNR in dB and the 0..1 motion/talk/smile gate applied to quality */
  pulseSnrDb: number | null
  pulseGate: number
  recording: boolean
  /** head angles from landmark depth: an independent check of the pose signs (deg) */
  lmPitch: number
  lmYaw: number
  /** mean skin RGB the pulse is computed from */
  rgb: [number, number, number] | null
  /** face width (cheek to cheek) in camera pixels and the nose position as a fraction of the frame; 0 without a face */
  faceW: number
  faceCx: number
  faceCy: number
}

export interface SenseWithDebug extends Sense {
  debug(): SenseDebug
}

export function createSense(): Sense {
  return new SenseImpl()
}

const AIR_HEAD_FRESH_MS = 1000
const AIR_HR_FRESH_MS = 15000
const MAX_RECORDING_MS = 10 * 60 * 1000
const BUILT_IN_MIC = /iphone|built-?in/i
const MIC_CONSTRAINTS: MediaTrackConstraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: false }

type Listeners = { [K in keyof SenseEvents]: Set<(e: SenseEvents[K]) => void> }

interface VfcMeta {
  captureTime?: number
  presentationTime?: number
}
type VfcVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: VfcMeta) => void) => number
  cancelVideoFrameCallback?: (id: number) => void
}

function senseError(message: string, cause: unknown): Error {
  const e = new Error(message, { cause })
  const name = (cause as { name?: string } | null)?.name
  if (name) e.name = name
  return e
}

function describeMediaError(err: unknown, wantAudio: boolean): Error {
  const name = (err as { name?: string } | null)?.name ?? ''
  const what = wantAudio ? 'camera and microphone' : 'camera'
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return senseError(`Vire needs the ${what} and was not allowed to use ${wantAudio ? 'them' : 'it'}. Allow access for this page in the browser settings, then try again.`, err)
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return senseError('No camera was found on this device.', err)
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return senseError(`The ${what} could not be opened. Another app may be using ${wantAudio ? 'them' : 'it'}; close it and try again.`, err)
  }
  return senseError(`Could not start the ${what}: ${(err as Error)?.message ?? String(err)}`, err)
}

class SenseImpl implements SenseWithDebug {
  private _caps: SenseCapabilities = { native: hasNative(), airpodsMotion: false, airpodsHr: false, camera: false, mic: false }
  private listeners: Listeners = { face: new Set(), head: new Set(), pulse: new Set(), voice: new Set(), caps: new Set() }
  private last: { face: FaceFrame | null; head: HeadFrame | null; pulse: PulseSample | null; voice: VoiceFrame | null } = { face: null, head: null, pulse: null, voice: null }

  private gen = 0
  private running = false
  private video: VfcVideo | null = null
  private streams: MediaStream[] = []
  private audioCtx: AudioContext | null = null
  private voice: VoiceCapture | null = null
  private tracker: FaceTracker | null = null
  private pulse = new CameraPulse()
  private vfc = 0
  private raf = 0
  private lastVideoTime = -1
  private micLabel = ''
  private cameraLabel = ''

  // native shell state
  private nativeCaps = { airpodsMotion: false, airpodsHr: false }
  private nativeStatus: { airpods: string; hr: string } = { airpods: 'connected', hr: 'off' }
  private lastAirHeadAt = -Infinity
  private lastAirHrAt = -Infinity

  // motion / talk gate for the camera pulse
  private motionGate = new MotionGate()
  private voicedEma = 0

  // perf
  private frameTimes: number[] = []
  private frameStamps: number[] = []

  private rec: Recording | null = null
  private poseCheck: { lmPitch: number; lmYaw: number; rgb: [number, number, number] | null; faceW: number; faceCx: number; faceCy: number } = { lmPitch: 0, lmYaw: 0, rgb: null, faceW: 0, faceCx: 0, faceCy: 0 }

  constructor() {
    onNative((m) => this.onNative(m))
  }

  get caps(): SenseCapabilities {
    return this._caps
  }

  on<K extends keyof SenseEvents>(ev: K, cb: (e: SenseEvents[K]) => void): () => void {
    const set = this.listeners[ev] as Set<(e: SenseEvents[K]) => void>
    set.add(cb)
    return () => {
      set.delete(cb)
    }
  }

  private emit<K extends keyof SenseEvents>(ev: K, e: SenseEvents[K]): void {
    for (const cb of Array.from(this.listeners[ev] as Set<(e: SenseEvents[K]) => void>)) {
      try {
        cb(e)
      } catch (err) {
        console.error(`[sense] ${ev} listener threw`, err)
      }
    }
  }

  private setCaps(patch: Partial<SenseCapabilities>): void {
    const next = { ...this._caps, ...patch }
    const keys = Object.keys(next) as (keyof SenseCapabilities)[]
    if (keys.every((k) => next[k] === this._caps[k])) return
    this._caps = next
    this.emit('caps', next)
  }

  latest() {
    return { ...this.last }
  }

  // ------------------------------------------------------------ start / stop

  async start(opts: { video?: HTMLVideoElement; audio?: boolean; camera?: boolean }): Promise<void> {
    if (this.running || this.streams.length) this.stop()
    const gen = ++this.gen
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
    if (!md?.getUserMedia) {
      throw new Error('The microphone is not available here. Open this page over https in Safari or Chrome.')
    }
    const wantCamera = opts.camera !== false
    const wantAudio = opts.audio !== false

    // Created and resumed synchronously, while we are still inside the tap (iOS requires that).
    let ctx: AudioContext | null = null
    if (wantAudio) {
      try {
        const AC: typeof AudioContext | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (AC) {
          ctx = new AC({ latencyHint: 'interactive' })
          void ctx.resume().catch(() => {})
        }
      } catch (err) {
        console.warn('[sense] no AudioContext', err)
      }
    }
    // the model download runs while the permission prompt is up
    const model = wantCamera ? loadFaceTracker() : Promise.resolve<FaceTracker>(null as unknown as FaceTracker)
    model.catch(() => {})

    const video: MediaTrackConstraints = { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }
    let stream: MediaStream
    let micMissing = false
    try {
      // one call for camera + mic: a single permission prompt. AirPods-only sessions never request video.
      // Follow keeps the microphone closed too, so there is no empty getUserMedia request to reject.
      stream = !wantCamera && !wantAudio
        ? new MediaStream()
        : await md.getUserMedia({ video: wantCamera ? video : false, audio: wantAudio ? MIC_CONSTRAINTS : false })
    } catch (err) {
      const name = (err as { name?: string } | null)?.name ?? ''
      if (wantCamera && wantAudio && (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError')) {
        // no microphone on this machine: carry on with the camera alone
        try {
          stream = await md.getUserMedia({ video, audio: false })
          micMissing = true
        } catch (err2) {
          void ctx?.close().catch(() => {})
          throw describeMediaError(err2, false)
        }
      } else {
        void ctx?.close().catch(() => {})
        throw describeMediaError(err, wantAudio)
      }
    }
    if (gen !== this.gen) {
      // stop() ran while the prompt was open
      stream.getTracks().forEach((t) => t.stop())
      void ctx?.close().catch(() => {})
      return
    }
    this.streams = [stream]
    this.audioCtx = ctx

    try {
      const v = wantCamera && opts.video ? (opts.video as VfcVideo) : null
      if (v) {
        v.playsInline = true
        v.muted = true
        v.autoplay = true
        v.setAttribute('playsinline', '')
        v.setAttribute('muted', '')
        v.srcObject = new MediaStream(stream.getVideoTracks())
        this.video = v
        await v.play().catch((err) => {
          // a second play() while one is pending aborts the first: harmless
          if ((err as { name?: string })?.name !== 'AbortError') throw err
        })
      }
      if (gen !== this.gen) return

      let mic: MediaStreamTrack | null = wantAudio && !micMissing ? (stream.getAudioTracks()[0] ?? null) : null
      if (mic) mic = await this.preferBuiltInMic(md, stream, mic)
      if (gen !== this.gen) return
      if (mic && ctx) {
        if (ctx.state !== 'running') void ctx.resume().catch(() => {})
        ctx.onstatechange = () => {
          // iOS interrupts the context on calls / route changes: pick it back up
          if (this.audioCtx === ctx && this.running && ctx.state !== 'running' && ctx.state !== 'closed') void ctx.resume().catch(() => {})
        }
        try {
          this.voice = await startVoice(ctx, new MediaStream([mic]), (f) => this.onVoice(f))
        } catch (err) {
          console.warn('[sense] voice capture failed', err)
          this.voice = null
        }
      } else if (ctx) {
        void ctx.close().catch(() => {})
        this.audioCtx = null
      }
      if (gen !== this.gen) return

      if (wantCamera) {
        try {
          this.tracker = await model
        } catch (err) {
          throw senseError(`The face model could not be loaded: ${(err as Error)?.message ?? String(err)}`, err)
        }
      } else this.tracker = null
      if (gen !== this.gen) return

      const cam = wantCamera ? (stream.getVideoTracks()[0] ?? null) : null
      this.cameraLabel = cam?.label ?? ''
      this.micLabel = mic?.label ?? ''
      const watch = (track: MediaStreamTrack | null, key: 'camera' | 'mic') => {
        if (!track) return
        track.addEventListener('ended', () => {
          if (gen === this.gen) this.setCaps(key === 'camera' ? { camera: false } : { mic: false })
        })
      }
      watch(cam, 'camera')
      watch(mic, 'mic')

      this.running = true
      this.pulse.reset()
      this.motionGate.lost()
      this.frameTimes = []
      this.frameStamps = []
      this.setCaps({ native: hasNative(), camera: !!cam && cam.readyState === 'live', mic: !!mic && mic.readyState === 'live' && !!this.voice })
      if (hasNative()) postNative({ cmd: 'start' })
      this.schedule()
    } catch (err) {
      if (gen === this.gen) this.stop()
      throw err
    }
  }

  /**
   * AirPods as the microphone put iOS in phone-call mode (mono, low quality playback).
   * If a built-in mic exists and we are not on it, reopen the audio track there.
   */
  private async preferBuiltInMic(md: MediaDevices, stream: MediaStream, cur: MediaStreamTrack): Promise<MediaStreamTrack> {
    try {
      if (BUILT_IN_MIC.test(cur.label)) return cur
      const inputs = (await md.enumerateDevices()).filter((d) => d.kind === 'audioinput')
      const builtIn = inputs.find((d) => d.deviceId && BUILT_IN_MIC.test(d.label))
      if (!builtIn || builtIn.deviceId === cur.getSettings().deviceId) return cur
      const s2 = await md.getUserMedia({ audio: { ...MIC_CONSTRAINTS, deviceId: { exact: builtIn.deviceId } } })
      const next = s2.getAudioTracks()[0]
      if (!next) return cur
      cur.stop()
      stream.removeTrack(cur)
      this.streams.push(s2)
      return next
    } catch (err) {
      console.warn('[sense] could not switch to the built-in mic', err)
      return cur
    }
  }

  stop(): void {
    this.gen++
    this.running = false
    const v = this.video
    if (v) {
      if (this.vfc && v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(this.vfc)
      try {
        v.pause()
      } catch {
        /* ignore */
      }
      v.srcObject = null
    }
    if (this.raf) cancelAnimationFrame(this.raf)
    this.vfc = 0
    this.raf = 0
    this.video = null
    this.voice?.stop()
    this.voice = null
    for (const s of this.streams) s.getTracks().forEach((t) => t.stop())
    this.streams = []
    if (this.audioCtx) {
      this.audioCtx.onstatechange = null
      void this.audioCtx.close().catch(() => {})
      this.audioCtx = null
    }
    if (hasNative()) postNative({ cmd: 'stop' })
    this.last = { face: null, head: null, pulse: null, voice: null }
    this.micLabel = ''
    this.cameraLabel = ''
    this.setCaps({ camera: false, mic: false })
  }

  pulseWave(t0: number, t1: number): { t: number[]; v: number[] } {
    return this.pulse.series(t0, t1)
  }

  setHeartSession(on: boolean): void {
    if (hasNative()) postNative({ cmd: 'heart', on })
  }

  private detailOn = false
  private cal: FaceCalibration | null = null

  setDetail(on: boolean): void {
    this.detailOn = on
    if (this.tracker) this.tracker.detail = on
  }

  blendNames(): string[] {
    return this.tracker?.names ?? []
  }

  setCalibration(cal: FaceCalibration | null): void {
    this.cal = cal
  }

  /** raw model score -> share of this person's own range (0 = their rest, 1 = their biggest) */
  private own(raw: number, range: [number, number] | undefined): number {
    if (!range) return raw
    const span = range[1] - range[0]
    if (!(span > 0.03)) return raw
    return Math.max(0, Math.min(1.25, (raw - range[0]) / span))
  }

  // ------------------------------------------------------------ camera loop

  private schedule(): void {
    const v = this.video
    if (!v || !this.running) return
    if (v.requestVideoFrameCallback) {
      this.vfc = v.requestVideoFrameCallback((now, meta) => void this.onFrame(now, meta))
    } else {
      this.raf = requestAnimationFrame((now) => {
        if (v.currentTime !== this.lastVideoTime) {
          this.lastVideoTime = v.currentTime
          void this.onFrame(now, undefined)
        } else this.schedule()
      })
    }
  }

  private async onFrame(now: number, meta: VfcMeta | undefined): Promise<void> {
    const gen = this.gen
    const v = this.video
    const tracker = this.tracker
    if (!v || !tracker || !this.running) return
    const began = performance.now()
    // when the camera reports the capture time, use it: it is free of main-thread jitter
    const cap = meta?.captureTime
    const t = typeof cap === 'number' && cap > began - 1000 && cap <= began + 5 ? cap : Math.min(now, began)
    try {
      const r = await tracker.detect(v, began)
      if (gen !== this.gen) return
      if (tracker.detail !== this.detailOn) tracker.detail = this.detailOn
      const smile = r.present ? this.own(r.smile, this.cal?.smile) : r.smile
      const brow = r.present ? this.own(r.brow, this.cal?.brow) : r.brow
      const face: FaceFrame = { t, present: r.present, smile, cheek: r.cheek, brow, jawOpen: r.jawOpen, blink: r.blink, pitch: r.pitch, yaw: r.yaw, roll: r.roll }
      if (r.blend && r.mesh) face.detail = { blend: r.blend, mesh: r.mesh }
      this.last.face = face
      this.poseCheck = { lmPitch: r.lmPitch, lmYaw: r.lmYaw, rgb: r.rgb, faceW: r.faceW, faceCx: r.cx, faceCy: r.cy }
      const rec = this.recordingNow(t)
      if (rec) {
        rec.face.t.push(t)
        rec.face.present.push(r.present)
        rec.face.smile.push(smile)
        rec.face.cheek.push(r.cheek)
        rec.face.pitch.push(r.pitch)
        rec.face.yaw.push(r.yaw)
        rec.face.roll.push(r.roll)
      }
      this.emit('face', face)

      const wall = performance.now()
      if (r.present && wall - this.lastAirHeadAt > AIR_HEAD_FRESH_MS) {
        const head: HeadFrame = { t, pitch: r.pitch, yaw: r.yaw, roll: r.roll, ax: 0, ay: 0, az: 0, source: 'camera' }
        this.last.head = head
        this.emit('head', head)
      }

      // camera pulse
      let sample: PulseSample
      if (r.present && r.rgb) {
        const gate = this.motionGate.update(t, r.pitch, r.yaw, r.roll, r.nx, r.ny, r.jawOpen, r.smile, this.voicedEma)
        const st = this.pulse.push(t, r.rgb[0], r.rgb[1], r.rgb[2])
        const quality = st.snrQuality * gate
        // honest: no number unless the signal is clean and the face is still
        sample = { t, bpm: quality >= HEART_MIN_QUALITY ? st.bpm : null, quality, wave: st.wave, source: 'camera' }
      } else {
        this.motionGate.lost()
        sample = { t, bpm: null, quality: 0, wave: 0, source: 'camera' }
      }
      if (rec) {
        rec.camPulse.t.push(t)
        rec.camPulse.bpm.push(sample.bpm)
        rec.camPulse.quality.push(sample.quality)
        rec.camPulse.gate.push(r.present && r.rgb ? this.motionGate.value : 0)
      }
      if (wall - this.lastAirHrAt > AIR_HR_FRESH_MS) {
        this.last.pulse = sample
        this.emit('pulse', sample)
      }
    } catch (err) {
      console.error('[sense] frame failed', err)
    } finally {
      const end = performance.now()
      this.frameTimes.push(end - began)
      if (this.frameTimes.length > 120) this.frameTimes.shift()
      this.frameStamps.push(end)
      while (this.frameStamps.length && end - this.frameStamps[0] > 2000) this.frameStamps.shift()
      if (gen === this.gen) this.schedule()
    }
  }

  // ------------------------------------------------------------ voice + native

  private onVoice(f: VoiceFrame): void {
    this.voicedEma += ((f.voiced ? 1 : 0) - this.voicedEma) * 0.03
    this.last.voice = f
    const rec = this.recordingNow(f.t)
    if (rec) {
      rec.voice.t.push(f.t)
      rec.voice.rms.push(f.rms)
      rec.voice.voiced.push(f.voiced)
      rec.voice.f0.push(f.f0)
    }
    this.emit('voice', f)
  }

  private onNative(m: NativeMsg): void {
    if (m.k === 'caps') {
      this.nativeCaps = { airpodsMotion: !!m.airpodsMotion, airpodsHr: !!m.airpodsHr }
      this.syncNativeCaps()
    } else if (m.k === 'status') {
      this.nativeStatus = { airpods: m.airpods, hr: m.hr }
      this.syncNativeCaps()
    } else if (m.k === 'head' && Array.isArray(m.s)) {
      const wall = performance.now()
      for (const row of m.s) {
        if (!Array.isArray(row) || row.length < 4) continue
        const head: HeadFrame = { t: epochToPerf(row[0]), pitch: row[1], yaw: row[2], roll: row[3], ax: row[4] ?? 0, ay: row[5] ?? 0, az: row[6] ?? 0, source: 'airpods' }
        if (row.length >= 10) {
          head.rx = row[7]
          head.ry = row[8]
          head.rz = row[9]
        }
        const rec = this.recordingNow(head.t)
        if (rec) {
          rec.airHead.t.push(head.t)
          rec.airHead.pitch.push(head.pitch)
          rec.airHead.yaw.push(head.yaw)
          rec.airHead.roll.push(head.roll)
        }
        this.last.head = head
        this.emit('head', head)
      }
      this.lastAirHeadAt = wall
      if (!this._caps.airpodsMotion) {
        this.nativeCaps.airpodsMotion = true
        this.syncNativeCaps()
      }
    } else if (m.k === 'hr' && typeof m.bpm === 'number' && m.bpm > 0) {
      const sample: PulseSample = { t: epochToPerf(m.t), bpm: m.bpm, quality: 1, wave: 0, source: 'airpods' }
      const rec = this.recordingNow(sample.t)
      if (rec) {
        rec.airPulse.t.push(sample.t)
        rec.airPulse.bpm.push(m.bpm)
      }
      this.lastAirHrAt = performance.now()
      this.last.pulse = sample
      this.emit('pulse', sample)
      if (!this._caps.airpodsHr) {
        this.nativeCaps.airpodsHr = true
        this.syncNativeCaps()
      }
    }
  }

  private syncNativeCaps(): void {
    const connected = this.nativeStatus.airpods !== 'disconnected'
    this.setCaps({
      native: hasNative(),
      airpodsMotion: this.nativeCaps.airpodsMotion && connected,
      airpodsHr: this.nativeCaps.airpodsHr && connected && this.nativeStatus.hr !== 'denied',
    })
  }

  // ------------------------------------------------------------ recording

  private recordingNow(t: number): Recording | null {
    const rec = this.rec
    if (!rec || t - rec.t0 > MAX_RECORDING_MS) return null
    return rec
  }

  beginRecording(): void {
    this.rec = emptyRecording(performance.now())
  }

  mark(phase: PhaseKey): void {
    if (!this.rec) this.beginRecording()
    this.rec!.marks.push({ key: phase, t: performance.now() })
  }

  peekRecording(opts: { laughOnsetT: number | null }): { features: PingFeatures; traces: PingTraces } | null {
    const rec = this.rec
    if (!rec) return null
    const t1 = Math.min(performance.now(), rec.t0 + MAX_RECORDING_MS)
    return computePing({ ...rec, t1, wave: this.pulse.series(rec.t0, t1) }, opts?.laughOnsetT ?? null)
  }

  endRecording(opts: { laughOnsetT: number | null }): { features: PingFeatures; traces: PingTraces } {
    const now = performance.now()
    const rec = this.rec ?? emptyRecording(now)
    this.rec = null
    rec.t1 = Math.min(now, rec.t0 + MAX_RECORDING_MS)
    rec.wave = this.pulse.series(rec.t0, rec.t1)
    return computePing(rec, opts?.laughOnsetT ?? null)
  }

  // ------------------------------------------------------------ debug

  debug(): SenseDebug {
    const ft = this.frameTimes
    const sorted = ft.slice().sort((a, b) => a - b)
    const span = this.frameStamps.length > 1 ? (this.frameStamps[this.frameStamps.length - 1] - this.frameStamps[0]) / 1000 : 0
    const st = this.pulse.peek()
    return {
      running: this.running,
      fps: span > 0 ? (this.frameStamps.length - 1) / span : 0,
      frameMs: ft.length ? ft.reduce((s, x) => s + x, 0) / ft.length : 0,
      frameMsP95: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0,
      modelMs: this.tracker?.modelMs ?? 0,
      skinMs: this.tracker?.skinMs ?? 0,
      delegate: this.tracker?.delegate ?? '-',
      voiceMode: this.voice?.mode ?? '-',
      micLabel: this.micLabel,
      cameraLabel: this.cameraLabel,
      videoW: this.video?.videoWidth ?? 0,
      videoH: this.video?.videoHeight ?? 0,
      sampleRate: this.audioCtx?.sampleRate ?? 0,
      pulseSnrDb: st.snrDb,
      pulseGate: this.motionGate.value,
      recording: !!this.rec,
      ...this.poseCheck,
    }
  }
}
