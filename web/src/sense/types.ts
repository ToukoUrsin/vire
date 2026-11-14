// Sensing core public interface. The patient app talks only to this.
// Implementation lives in src/sense (createSense in ./index.ts). A scripted mock lives in ./mock.ts.

import type { HeartSource, MoveSource, PhaseKey, PingFeatures, PingTraces } from '@shared/types'

/** ~30 Hz. All times are performance.now() ms. */
export interface FaceFrame {
  t: number
  present: boolean
  /** mean(mouthSmileLeft, mouthSmileRight) 0..1 */
  smile: number
  /**
   * cheek raise 0..1: AU6, the Duchenne marker. MediaPipe's cheekSquint blendshapes are always 0,
   * so this is measured from the landmarks (cheek moving up to the eye + eye narrowing) against the person's resting face.
   */
  cheek: number
  /** mean(browDownLeft, browDownRight) 0..1 */
  brow: number
  jawOpen: number
  blink: number
  /** head pose from the camera, degrees. pitch: + is chin up. yaw: + is turning left. */
  pitch: number
  yaw: number
  roll: number
  /** every blendshape and the full mesh; present only after `sense.setDetail(true)` and while a face is in view */
  detail?: FaceDetail
}

/** The raw material for a personal face model and for drawing the face as a mesh (never the picture). */
export interface FaceDetail {
  /** all MediaPipe blendshape scores 0..1 (raw, uncalibrated), in the order of `sense.blendNames()` */
  blend: Float32Array
  /** 478 landmarks as x,y,z triples, normalised to the camera image (x,y in 0..1, unmirrored; z in the same scale as x) */
  mesh: Float32Array
}

/**
 * A person's own range, from the onboarding "tune" step: [rest, max] of the raw value.
 * With one set, `FaceFrame.smile` / `brow` (and the ping's smile features) are 0 at this person's resting face
 * and 1 at their own biggest, instead of the model's one-size scale.
 */
export interface FaceCalibration {
  smile: [number, number]
  brow: [number, number]
}

/** Head motion. From AirPods (25 Hz, native shell) when available, otherwise from the camera. */
export interface HeadFrame {
  t: number
  pitch: number
  yaw: number
  roll: number
  /** user acceleration in g, AirPods only (0 from camera) */
  ax: number
  ay: number
  az: number
  /** rotation rate in deg/s around the earbud axes, AirPods only (absent from the camera) */
  rx?: number
  ry?: number
  rz?: number
  source: MoveSource
}

/** ~30 Hz from the camera (rPPG) or ~0.2-1 Hz from AirPods Pro 3 (HealthKit workout). */
export interface PulseSample {
  t: number
  /** null whenever the camera pulse is not trustworthy (quality under 0.3): show nothing, not a guess */
  bpm: number | null
  /** 0..1 */
  quality: number
  /** filtered pulse waveform sample, roughly -1..1 (camera only; 0 for AirPods) */
  wave: number
  source: HeartSource
}

/** ~50 Hz. */
export interface VoiceFrame {
  t: number
  /** dBFS, about -90..0 */
  rms: number
  voiced: boolean
  /** Hz, 70-400. Null when unvoiced, and on weakly voiced frames where the pitch is not trustworthy. */
  f0: number | null
}

export interface SenseCapabilities {
  /** running inside the iOS shell */
  native: boolean
  airpodsMotion: boolean
  airpodsHr: boolean
  camera: boolean
  mic: boolean
}

export interface SenseEvents {
  face: FaceFrame
  head: HeadFrame
  pulse: PulseSample
  voice: VoiceFrame
  caps: SenseCapabilities
}

export interface Sense {
  readonly caps: SenseCapabilities
  /** asks for camera + mic, loads the face model, starts all streams. Call from a user gesture. */
  start(opts: { video?: HTMLVideoElement; audio?: boolean; camera?: boolean }): Promise<void>
  stop(): void
  on<K extends keyof SenseEvents>(ev: K, cb: (e: SenseEvents[K]) => void): () => void
  /** latest values, for render loops */
  latest(): { face: FaceFrame | null; head: HeadFrame | null; pulse: PulseSample | null; voice: VoiceFrame | null }
  /** start buffering every stream for a ping */
  beginRecording(): void
  /** mark a phase boundary inside the recording */
  mark(phase: PhaseKey): void
  /** stop buffering and compute features + 10 Hz traces. laughOnsetT = performance.now() when the laughter started. */
  endRecording(opts: { laughOnsetT: number | null }): { features: PingFeatures; traces: PingTraces }
  /** what endRecording would give at this moment, without ending the recording: a finished step is read as soon as it ends */
  peekRecording?(opts: { laughOnsetT: number | null }): { features: PingFeatures; traces: PingTraces } | null
  /**
   * The camera's pulse wave between two times (ms, performance.now clock), each sample at the time it describes.
   * This is what the ping reads the heart from. Use it, not the `wave` on `pulse` events, for anything that times
   * beats: the event's sample is one frame's glimpse of this wave and places each beat twice as loosely.
   */
  pulseWave(t0: number, t1: number): { t: number[]; v: number[] }
  /** ask the native shell to start/stop the AirPods heart-rate workout session (no-op on web) */
  setHeartSession(on: boolean): void
  /** include `detail` (all blendshapes + mesh) on face frames. Off by default: it copies ~1500 numbers per frame. */
  setDetail(on: boolean): void
  /** blendshape names in the order of `FaceDetail.blend`; empty until the first face has been seen */
  blendNames(): string[]
  /** scale smile and brow to this person's own range (null = back to the model's raw scale) */
  setCalibration(cal: FaceCalibration | null): void
}
