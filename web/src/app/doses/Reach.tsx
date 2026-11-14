// Reach out: ten seconds of the person's own voice for someone they like. One button starts the recording,
// the pitch is drawn as they speak, and the note leaves the phone only through the phone's own share sheet.
import { useRef, useState } from 'react'
import { audio } from '../audio'
import type { Handle } from '../audio'
import { getTodayMeta } from '../store'
import { startVoice } from '../../sense'
import type { VoiceCapture } from '../../sense'
import type { VoiceFrame } from '../../sense/types'
import { DOSE_SECONDS, DoseShell, DoseWords, band, createTimers, endHoldMs, leftOf, level, mmss, openPlot, patched, token, trace, useRun } from './shared'
import type { DoseProps } from './shared'
import { NOTE_SECONDS, pingSpread, pitchLine, pitchSpread, reachEndLine } from './voiceNote'

const TOTAL_MS = DOSE_SECONDS * 1000
const NOTE_MS = NOTE_SECONDS * 1000
/** a note that ends after the minute still gets this long to be heard and sent */
const AFTER_NOTE_MS = 15000
/** "shared" or "saved" stays up this long before the reading takes its place */
const AFTER_SEND_MS = 1800
/** the pitch line shows this many semitones each way, and more when the voice goes further */
const LINE_SEMITONES = 6
const PRIVATE = 'Nothing is uploaded. The note stays on this phone until you send it.'

type Step = 'ready' | 'asking' | 'recording' | 'recorded' | 'sent' | 'saved'

interface View {
  step: Step
  line: string
  sub: string
  /** seconds of the note left while recording */
  noteLeft: number
  playing: boolean
  canRecord: boolean
  left: string
  end: string | null
}

interface Note {
  file: File
  url: string
  seconds: number
}

const START: View = {
  step: 'ready',
  line: 'Think of one person.',
  sub: 'Ten seconds of your voice. Hello is enough.',
  noteLeft: NOTE_SECONDS,
  playing: false,
  canRecord: true,
  left: leftOf(TOTAL_MS, 0),
  end: null,
}

const canRecordHere = () => !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'

function recorderType(): string | undefined {
  return ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((type) => MediaRecorder.isTypeSupported(type))
}

function noteFile(chunks: Blob[], mime: string): File {
  const ext = mime.includes('mp4') ? 'm4a' : 'webm'
  return new File(chunks, `voice-note.${ext}`, { type: mime })
}

const canShare = (file: File) => typeof navigator.share === 'function' && !!navigator.canShare?.({ files: [file] })

function saveToPhone(note: Note) {
  const a = document.createElement('a')
  a.href = note.url
  a.download = note.file.name
  a.click()
}

/** why the microphone did not open, in words the person can act on */
function micWords(err: unknown): [string, string] {
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return ['The microphone is off for Vire.', 'Allow it in your browser’s settings for this page, then tap Record again.']
  }
  if (name === 'NotFoundError') return ['I can’t find a microphone.', 'Plug one in or try another device, then tap Record again.']
  return ['The microphone didn’t start.', 'Close other apps that use it, then tap Record again.']
}

/** today's ping pitch variation, only when the ping could read the voice */
function todaysPingSpread(): number | null {
  const meta = getTodayMeta()
  if (!meta?.traces || meta.unreadable.includes('voice')) return null
  return pingSpread(meta.traces.f0)
}

export default function Reach({ onFinish, onLeave }: DoseProps) {
  const [view, setView] = useState<View>(START)
  const chart = useRef<HTMLCanvasElement>(null)
  const act = useRef({ record: () => {}, stop: () => {}, listen: () => {}, send: () => {}, done: () => {} })

  useRun(() => {
    const timers = createTimers()
    const frames: VoiceFrame[] = []
    const t0 = performance.now()
    let voice: Handle | null = null
    let stream: MediaStream | null = null
    let capture: VoiceCapture | null = null
    let recorder: MediaRecorder | null = null
    let player: HTMLAudioElement | null = null
    let note: Note | null = null
    let step: Step = 'ready'
    let recStart = 0
    let noteEndedAt = 0
    let sharing = false
    let shared = false
    let saved = false
    let ended = false

    const set = (patch: Partial<View>) => setView((v) => patched(v, patch))
    const go = (next: Step, line: string, sub: string) => {
      step = next
      set({ step, line, sub })
    }
    void audio.playSoon('vo-dose-reach').then((h) => {
      voice = h
      if (ended || step !== 'ready') h?.stop(50)
    })

    const closeMic = () => {
      capture?.stop()
      capture = null
      stream?.getTracks().forEach((track) => track.stop())
      stream = null
    }

    const noteReady = (chunks: Blob[], mime: string) => {
      closeMic()
      if (ended) return
      const file = noteFile(chunks, mime)
      note = { file, url: URL.createObjectURL(file), seconds: Math.min(NOTE_SECONDS, (performance.now() - recStart) / 1000) }
      noteEndedAt = performance.now()
      go('recorded', 'Listen, then send it.', PRIVATE)
    }

    const dropNote = () => {
      player?.pause()
      if (note) URL.revokeObjectURL(note.url)
      note = null
      set({ playing: false })
    }

    const record = async () => {
      if (ended || (step !== 'ready' && step !== 'recorded')) return
      voice?.stop(120)
      dropNote()
      go('asking', 'One moment.', '')
      try {
        // a fresh request every time: the ping's microphone is released before a dose starts
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch (err) {
        const [line, sub] = micWords(err)
        go('ready', line, sub)
        return
      }
      if (ended) {
        closeMic()
        return
      }
      const mime = recorderType()
      const chunks: Blob[] = []
      frames.length = 0
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data)
      }
      recorder.onstop = () => noteReady(chunks, recorder?.mimeType || mime || 'audio/webm')
      const ctx = audio.init()
      if (ctx) capture = await startVoice(ctx, stream, (f) => frames.push(f)).catch(() => null)
      recStart = performance.now()
      recorder.start()
      go('recording', 'Say anything.', 'It stops by itself after ten seconds.')
    }

    const stop = () => {
      if (recorder && recorder.state !== 'inactive') recorder.stop()
    }

    const listen = () => {
      if (!note) return
      if (player && !player.paused) {
        player.pause()
        set({ playing: false })
        return
      }
      player = new Audio(note.url)
      player.onended = () => set({ playing: false })
      void player.play().then(() => set({ playing: true })).catch(() => set({ playing: false }))
    }

    const send = async () => {
      if (!note || sharing) return
      player?.pause()
      if (!canShare(note.file)) {
        saveToPhone(note)
        saved = true
        go('saved', 'Saved on this phone.', 'Send it from your files when you like.')
        timers.after(AFTER_SEND_MS, end)
        return
      }
      sharing = true
      try {
        await navigator.share({ files: [note.file] })
        shared = true
        go('sent', 'Shared from your phone.', '')
        timers.after(AFTER_SEND_MS, end)
      } catch {
        /* the share sheet was closed: the note is still here */
      }
      sharing = false
    }

    const end = () => {
      if (ended) return
      ended = true
      voice?.stop(120)
      player?.pause()
      stop()
      closeMic()
      const spread = note ? pitchSpread(frames) : null
      const line = reachEndLine(note != null, spread, spread == null ? null : todaysPingSpread())
      set({ end: line, playing: false })
      const metrics: Record<string, number> = { recorded: note ? 1 : 0, shared: shared ? 1 : 0, saved: saved ? 1 : 0 }
      if (note) metrics.recordedS = Math.round(note.seconds)
      if (spread != null) metrics.pitchSemitones = Math.round(spread * 10) / 10
      timers.after(endHoldMs(line), () => onFinish(metrics, line))
    }
    act.current = { record: () => void record(), stop, listen, send: () => void send(), done: end }

    /** the minute is over, and nothing the person started is still in the air */
    const overAndIdle = (now: number) => {
      const busy = step === 'asking' || step === 'recording' || step === 'sent' || step === 'saved' || sharing || (player != null && !player.paused)
      const until = Math.max(t0 + TOTAL_MS, note ? noteEndedAt + AFTER_NOTE_MS : 0)
      return !busy && now >= until
    }

    const tick = () => {
      if (ended) return
      const now = performance.now()
      if (step === 'recording') {
        set({ noteLeft: Math.max(0, Math.ceil((NOTE_MS - (now - recStart)) / 1000)) })
        if (now - recStart >= NOTE_MS) stop()
      }
      if (overAndIdle(now)) end()
      set({ left: leftOf(TOTAL_MS, now - t0) })
      drawPitch(chart.current, frames, recStart, step === 'recording' ? now : null)
    }

    set({ canRecord: canRecordHere() })
    if (!canRecordHere()) go('ready', 'This browser can’t record a voice note.', 'Open Vire in Safari or Chrome to send one.')
    timers.every(50, tick)

    return () => {
      ended = true
      timers.stop()
      voice?.stop(120)
      player?.pause()
      stop()
      closeMic()
      dropNote()
    }
  })

  const ended = view.end != null
  const { step } = view
  return (
    <DoseShell title="Reach out" count={view.left} ended={ended} onDone={() => act.current.done()} onLeave={onLeave}>
      <div className="va-reach" data-step={step}>
        <canvas ref={chart} className="va-reach-chart" role="img" aria-label="The pitch of your voice as you speak" />
        <p className="va-reach-clock" aria-hidden={step !== 'recording'}>
          {step === 'recording' ? mmss(view.noteLeft) : ''}
        </p>
      </div>
      <DoseWords line={view.end ?? view.line} sub={view.sub} end={ended} />
      <div className="va-reach-actions">
        {!ended && (
          <>
          {(step === 'ready' || step === 'asking') && view.canRecord && (
            <button className="va-btn va-btn-primary" onClick={() => act.current.record()} disabled={step === 'asking'}>
              Record
            </button>
          )}
          {step === 'recording' && (
            <button className="va-btn va-btn-stage" onClick={() => act.current.stop()}>
              Stop
            </button>
          )}
          {step === 'recorded' && (
            <>
              <button className="va-btn va-btn-primary" onClick={() => act.current.send()}>
                Send it
              </button>
              <p className="va-reach-more">
                <button className="va-link-stage" onClick={() => act.current.listen()}>
                  {view.playing ? 'Stop' : 'Listen'}
                </button>
                <button className="va-link-stage" onClick={() => act.current.record()}>
                  Record again
                </button>
              </p>
            </>
          )}
          </>
        )}
      </div>
    </DoseShell>
  )
}

/** the pitch of the note left to right across its ten seconds, in semitones around its own middle */
function drawPitch(cv: HTMLCanvasElement | null, frames: VoiceFrame[], recStart: number, now: number | null) {
  const p = openPlot(cv)
  if (!p || !cv) return
  const ink = token(cv, '--stage-ink')
  level(p, p.h / 2, ink, 0.18)
  if (!frames.length) return
  const semitones = pitchLine(frames)
  const reach = Math.max(LINE_SEMITONES, ...semitones.map((st) => Math.abs(st ?? 0)))
  const x = (t: number) => ((t - recStart) / NOTE_MS) * p.w
  const y = (st: number) => p.h / 2 - (st / reach) * (p.h / 2 - 8)
  const pts = frames.map((f, i): [number, number] | null => {
    const st = semitones[i]
    return st == null ? null : [x(f.t), y(st)]
  })
  trace(p, pts, token(cv, '--ch-voice'), 2.5)
  if (now != null) band(p, x(now), x(now) + 1, ink, 0.35)
}
