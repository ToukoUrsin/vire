// Microphone -> 50 Hz VoiceFrames. AudioWorklet when available, AnalyserNode polling otherwise.

import { createVoiceAnalyzer } from './pitch'
import type { RawVoiceFrame } from './pitch'
import type { VoiceFrame } from './types'

export interface VoiceCapture {
  readonly mode: 'worklet' | 'analyser'
  stop(): void
}

const WORKLET_NAME = 'vire-voice'

function workletSource(): string {
  // createVoiceAnalyzer is self-contained, so its source can run inside the worklet scope
  return `const createVoiceAnalyzer = ${createVoiceAnalyzer.toString()};
class VireVoice extends AudioWorkletProcessor {
  constructor() {
    super();
    this.an = createVoiceAnalyzer(sampleRate);
    this.out = [];
    this.emit = (f) => { this.out.push(f); };
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      this.an.push(ch, currentFrame, this.emit);
      if (this.out.length) { this.port.postMessage(this.out); this.out = []; }
    }
    return true;
  }
}
registerProcessor('${WORKLET_NAME}', VireVoice);`
}

const workletReady = new WeakMap<AudioContext, Promise<void>>()

function loadWorklet(ctx: AudioContext): Promise<void> {
  let p = workletReady.get(ctx)
  if (!p) {
    const url = URL.createObjectURL(new Blob([workletSource()], { type: 'application/javascript' }))
    p = ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url))
    workletReady.set(ctx, p)
  }
  return p
}

/**
 * Start analysing the mic. Frames are stamped on the performance.now() clock: the audio clock is
 * mapped with the smallest arrival delay seen, so a busy main thread does not smear the timing.
 */
export async function startVoice(ctx: AudioContext, stream: MediaStream, onFrame: (f: VoiceFrame) => void): Promise<VoiceCapture> {
  const sr = ctx.sampleRate
  const source = ctx.createMediaStreamSource(stream)
  // a silent path to the destination keeps the graph pulling on every browser
  const sink = ctx.createGain()
  sink.gain.value = 0
  sink.connect(ctx.destination)

  // audio clock -> performance clock: the smallest (now - audio time) seen over the last 3 s of frames.
  // A late delivery (busy main thread) only adds delay, so the minimum is the true offset; the window
  // lets it follow a suspend / resume of the context.
  const arrivals = new Float64Array(150).fill(Infinity)
  let ai = 0
  const deliver = (frames: RawVoiceFrame[]) => {
    const now = performance.now()
    for (const f of frames) {
      const audioMs = (f.frame / sr) * 1000
      arrivals[ai] = now - audioMs
      ai = (ai + 1) % arrivals.length
      let offset = Infinity
      for (let i = 0; i < arrivals.length; i++) if (arrivals[i] < offset) offset = arrivals[i]
      // the level window is 40 ms long: stamp its centre
      onFrame({ t: audioMs + offset - 20, rms: f.rms, voiced: f.voiced, f0: f.f0 })
    }
  }

  if (ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
    try {
      await loadWorklet(ctx)
      const node = new AudioWorkletNode(ctx, WORKLET_NAME, { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' })
      node.port.onmessage = (e: MessageEvent<RawVoiceFrame[]>) => deliver(e.data)
      source.connect(node)
      node.connect(sink)
      return {
        mode: 'worklet',
        stop() {
          node.port.onmessage = null
          try {
            source.disconnect()
            node.disconnect()
            sink.disconnect()
          } catch {
            /* already gone */
          }
        },
      }
    } catch (err) {
      console.warn('[sense] AudioWorklet unavailable, using AnalyserNode', err)
    }
  }

  // Fallback: rebuild a continuous sample stream from the analyser's rolling buffer.
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 8192
  analyser.smoothingTimeConstant = 0
  source.connect(analyser)
  analyser.connect(sink)
  const an = createVoiceAnalyzer(sr)
  const buf = new Float32Array(analyser.fftSize)
  let lastFrame = Math.round(ctx.currentTime * sr)
  const out: RawVoiceFrame[] = []
  const emit = (f: RawVoiceFrame) => {
    out.push(f)
  }
  const timer = setInterval(() => {
    const nowFrame = Math.round(ctx.currentTime * sr)
    const n = Math.min(nowFrame - lastFrame, buf.length)
    if (n <= 0) return
    analyser.getFloatTimeDomainData(buf)
    an.push(buf.subarray(buf.length - n), nowFrame - n, emit)
    lastFrame = nowFrame
    if (out.length) deliver(out.splice(0))
  }, 20)
  return {
    mode: 'analyser',
    stop() {
      clearInterval(timer)
      try {
        source.disconnect()
        analyser.disconnect()
        sink.disconnect()
      } catch {
        /* already gone */
      }
    },
  }
}
