// The ping: a two-second check, then PING_PHASES exactly, hands-free once it starts. Voice lines and a few words
// guide it; the centre is the living echo, never the person's own face.
import { useEffect, useRef, useState } from 'react'
import type { Channel, HeartSource, MoveSource, PhaseKey, PingFeatures, PingKind, PingTraces, StepReading } from '@shared/types'
import { PING_PHASES } from '@shared/types'
import { audio, pick } from './audio'
import type { Handle } from './audio'
import EchoCanvas from './EchoCanvas'
import type { EchoMode } from './EchoCanvas'
import { IconClose } from './icons'
import { beginLaugh, endLaugh } from './personal'
import { loadLovedLaugh } from './laugh'
import { dailyUrl, getDaily } from './daily'
import type { SenseWithDebug } from '../sense'
import { createEarReader, loadEarModel } from '../tune/ear'
import type { EarNow } from '@shared/ear'
import { readEarLaugh } from './follow/rule'
// the measured limits behind the check before a ping (VALIDATE's; not re-exported by the sense index yet)
import { cameraIssues } from '../sense/conditions'
import { currentSense, hasMic, isMock, isShell, keepAwake, live, stopSession } from './session'
import { UNREAD_NOTE, sourceLine } from './words'

export interface PingResult {
  features: PingFeatures
  traces: PingTraces
  startedAt: string
  /** channels this ping could not measure, and the plain reason for each */
  unreadable: Channel[]
  why: Partial<Record<Channel, string>>
  head: MoveSource
  heart: HeartSource
  stepReadings?: import('@shared/types').PingUpload['stepReadings']
}

interface Props {
  kind: PingKind
  onDone(r: PingResult): void
  onLeave(): void
  /** the ping was interrupted and the person wants to go again: restart the camera inside this tap, then remount */
  onRestart(): void
  stim?: string
  onUseCamera?(): void
}

const MINI_PHASES: { key: PhaseKey; ms: number }[] = [
  { key: 'laugh', ms: 8000 },
  { key: 'breathe', ms: 10000 },
]
export const HALL_PHASES: { key: PhaseKey; ms: number }[] = [
  { key: 'nod', ms: 5000 },
  { key: 'laugh', ms: 10000 },
  { key: 'speak', ms: 8000 },
  { key: 'breathe', ms: 10000 },
]

export const SPEAK_PROMPTS = [
  'What’s one thing you’re looking forward to?',
  'Tell me about something small that went well lately.',
  'What did you eat today, and how was it?',
]

const MEASURES: Record<PhaseKey, Channel | null> = {
  settle: null,
  nod: 'move',
  laugh: 'smile',
  speak: 'voice',
  breathe: 'heart',
}
const CHANNEL_ORDER: Channel[] = ['move', 'smile', 'voice', 'heart']
const LAUGHS = ['laugh-1', 'laugh-2', 'laugh-3']

/** room level (dBFS) over which a voice is hard to tell from the room */
const LOUD_DB = -38

type Step = PhaseKey | 'lead' | 'check' | 'done'
type Mark = 'wait' | 'ok' | 'warn'
interface Check {
  face: Mark
  /** what to ask for when the face row is a warning */
  faceWhy: 'gone' | 'far' | 'turned' | null
  /** null: nothing to say about the light (the heart comes from the AirPods and the face is bright enough) */
  light: Mark | null
  /** 'dark' = too dark to follow the face well; 'pulse' = fine for the face, too dim for a pulse from the camera */
  lightWhy: 'dark' | 'pulse' | null
  /** null: this ping does not listen (the mini ping) */
  room: Mark | 'off' | null
  /** the laughter is still downloading */
  sounds: boolean
}
type Pause = 'away' | 'sound' | 'camera'
const CANCEL = Symbol('cancel')

/** the headline, then short sentences that each stay on one line */
const PAUSED: Record<Pause, [string, string[]]> = {
  away: ['The ping stopped when you left.', ['Nothing was saved.', 'Start again when you’re ready.']],
  sound: ['The sound was interrupted.', ['A call or another app took it.', 'Nothing was saved.']],
  camera: ['The camera stopped.', ['Another app may have taken it.', 'Nothing was saved.']],
}

const median = (xs: number[]) => {
  if (!xs.length) return -90
  const a = [...xs].sort((x, y) => x - y)
  const m = a.length >> 1
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}

export { readEarLaugh } from './follow/rule'

export default function PingStage({ kind, onDone, onLeave, onRestart, onUseCamera, stim = 'laugh-1' }: Props) {
  const phases = kind === 'full' ? PING_PHASES : kind === 'hall' ? HALL_PHASES : MINI_PHASES
  const isLong = kind === 'full' || kind === 'hall'
  const [step, setStep] = useState<Step>('lead')
  const [line, setLine] = useState(kind === 'mini' ? 'One more quick listen.' : kind === 'hall' ? 'Nod when you’re ready.' : 'One moment.')
  const [sub, setSub] = useState(kind === 'mini' ? 'Then one slow breath.' : '')
  const [faceLost, setFaceLost] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [check, setCheck] = useState<Check | null>(null)
  const [src, setSrc] = useState<{ head: MoveSource; heart: HeartSource; air: boolean } | null>(null)
  const [paused, setPaused] = useState<Pause | null>(null)
  const [sensingPaused, setSensingPaused] = useState<Pause | null>(null)
  const [sensingPausedFor, setSensingPausedFor] = useState(0)
  const sensingPauseRef = useRef(false)
  const [again, setAgain] = useState(false)
  const [airOnly, setAirOnly] = useState(false)
  const breathStart = useRef<number | null>(null)
  const idx = useRef(-1)
  const phaseStart = useRef(0)
  const fills = useRef<(HTMLSpanElement | null)[]>([])
  const done = useRef(onDone)
  done.current = onDone

  useEffect(() => {
    const sense = currentSense()
    if (!sense) {
      onLeave()
      return
    }
    let cancelled = false
    let finished = false
    let recording = false
    let sensorPause: Pause | null = null
    let sensorPauseAt = 0
    const timers = new Set<number>()
    const handles: Handle[] = []
    const offs: (() => void)[] = []
    const sleep = (ms: number) =>
      new Promise<void>((res, rej) => {
        const started = performance.now()
        let heldTotal = 0
        let holdStarted: number | null = sensorPause ? performance.now() : null
        const id = window.setInterval(() => {
          if (cancelled) { clearInterval(id); timers.delete(id); rej(CANCEL); return }
          const now = performance.now()
          if (sensorPause) { holdStarted ??= now; return }
          if (holdStarted != null) { heldTotal += now - holdStarted; holdStarted = null }
          if (now - started - heldTotal >= ms) {
            clearInterval(id); timers.delete(id); res()
          }
        }, 40)
        timers.add(id)
      })
    const keep = (h: Handle | null) => {
      if (!h) return
      if (cancelled) h.stop(60)
      else handles.push(h)
    }
    const say = (name: string, gain = 1) => {
      void audio.playSoon(name, { gain }).then(keep)
    }
    const show = (l: string, s = '') => {
      setLine(l)
      setSub(s)
    }

    // ---- what the ping needs to know afterwards about what it could and could not see ----
    const micOn = hasMic()
    const earModel = loadEarModel()
    const earReader = earModel ? createEarReader(earModel) : null
    const earSamples: { t: number; now: EarNow }[] = []
    let earLaughMs: number | null = null
    const airOnly = !sense.caps.camera && sense.caps.airpodsMotion
    let phaseNow: PhaseKey | null = null
    /** [frames with a face, frames] while the nod was asked for and while the laughter played */
    const seen: Record<'nod' | 'laugh', [number, number]> = { nod: [0, 0], laugh: [0, 0] }
    const faceRing: { t: number; present: boolean }[] = []
    let lastFaceAt = performance.now()
    let gotFace = false
    offs.push(
      sense.on('face', (f) => {
        gotFace = true
        lastFaceAt = performance.now()
        faceRing.push({ t: lastFaceAt, present: f.present })
        if (faceRing.length > 90) faceRing.shift()
        if (phaseNow === 'nod' || phaseNow === 'laugh') {
          seen[phaseNow][1]++
          if (f.present) seen[phaseNow][0]++
        }
      }),
    )
    /** the room on its own (nothing playing, nobody asked to speak) against the person answering */
    let listening: 'room' | 'answer' | null = null
    const room = { n: 0, voiced: 0, rms: [] as number[] }
    const answer = { n: 0, voiced: 0, rms: [] as number[] }
    const voiceRing: { t: number; rms: number; voiced: boolean }[] = []
    offs.push(
      sense.on('voice', (v) => {
        voiceRing.push({ t: performance.now(), rms: v.rms, voiced: v.voiced })
        if (voiceRing.length > 240) voiceRing.shift()
        if (listening === 'room') {
          room.n++
          room.rms.push(v.rms)
          if (v.voiced) room.voiced++
        } else if (listening === 'answer') {
          answer.n++
          if (v.voiced) {
            answer.voiced++
            answer.rms.push(v.rms)
          }
        }
      }),
    )

    // resting head pitch, learned outside the nod window
    let restPitch: number | null = null
    let nodding = false
    let nodPeak = 0
    let nodSeen: (() => void) | null = null
    offs.push(
      sense.on('head', (f) => {
        if (f.source === 'airpods' && earReader) {
          const now = earReader.push(f)
          if (now) {
            earSamples.push({ t: f.t, now })
            if (earSamples.length > 300) earSamples.shift()
          }
        }
        if (!nodding) {
          restPitch = restPitch == null ? f.pitch : restPitch + (f.pitch - restPitch) * 0.04
          return
        }
        if (restPitch == null) restPitch = f.pitch
        const exc = Math.abs(f.pitch - restPitch)
        if (exc > nodPeak) nodPeak = exc
        if (nodPeak > 7 && exc < Math.max(2.5, nodPeak * 0.4) && nodSeen) {
          nodSeen()
          nodSeen = null
        }
      }),
    )
    setAirOnly(airOnly)
    if (airOnly) {
      setLine('AirPods only. The camera is off.')
      setSub('Keep them in. You can use the camera today if you prefer.')
    }

    // AirPods taken out mid-ping: say so once, carry on with the camera
    let hadAir = sense.caps.airpodsMotion
    let noteTimer = 0
    offs.push(
      sense.on('caps', (c) => {
        if (hadAir && !c.airpodsMotion && !cancelled && !finished) {
          setNote('AirPods dropped out. The camera has taken over.')
          clearTimeout(noteTimer)
          noteTimer = window.setTimeout(() => setNote(null), 6000)
        }
        hadAir = c.airpodsMotion
      }),
    )

    let laughOnsetT: number | null = null
    let laughPlayed = false
    let lovedUrl: string | null = null
    void loadLovedLaugh().then((url) => { lovedUrl = url })
    let laughRead: ReturnType<typeof endLaugh> = {}
    const daily = getDaily()
    /** offset of the speak phase's own start, when the mark was held back until the question had been asked */
    let promptAt: number | null = null

    const readCheck = (): Check => {
      const now = performance.now()
      const fr = faceRing.filter((x) => now - x.t < 1000)
      const inView = fr.length >= 3 && fr.filter((x) => x.present).length / fr.length >= 0.5
      const l = sense.latest()
      const camHeart = !(l.pulse?.source === 'airpods' || sense.caps.airpodsHr)
      let face: Mark = inView ? 'ok' : 'warn'
      let faceWhy: Check['faceWhy'] = inView ? null : 'gone'
      let light: Mark | null = camHeart ? 'ok' : null
      let lightWhy: Check['lightWhy'] = null
      // the limits are VALIDATE's, measured on real video (sense/conditions.ts): face width, head turn, skin brightness
      const dbg = typeof (sense as Partial<SenseWithDebug>).debug === 'function' ? (sense as SenseWithDebug).debug() : null
      if (dbg && inView && l.face) {
        const issues = cameraIssues(dbg, l.face)
        if (issues.includes('too-far')) {
          face = 'warn'
          faceWhy = 'far'
        } else if (issues.includes('turned')) {
          face = 'warn'
          faceWhy = 'turned'
        }
        if (issues.includes('too-dark')) {
          light = 'warn'
          lightWhy = 'dark'
        } else if (camHeart && issues.includes('dim-for-pulse')) {
          light = 'warn'
          lightWhy = 'pulse'
        }
      } else if (!dbg && camHeart && inView && l.pulse != null && l.pulse.bpm == null && l.pulse.quality < 0.15) {
        // demo signals have no picture to measure: go by the scripted pulse
        light = 'warn'
        lightWhy = 'pulse'
      }
      let roomMark: Check['room'] = null
      if (isLong) {
        if (!micOn) roomMark = 'off'
        else {
          const vr = voiceRing.filter((x) => now - x.t < 1200)
          const loud = vr.length > 0 && (median(vr.map((x) => x.rms)) > LOUD_DB || vr.filter((x) => x.voiced).length / vr.length > 0.35)
          roomMark = loud ? 'warn' : 'ok'
        }
      }
      return { face, faceWhy, light, lightWhy, room: roomMark, sounds: false }
    }

    /** two seconds of looking and listening; a little longer when there is something to fix. It never refuses. */
    const checkStep = async () => {
      setStep('check')
      setCheck({ face: 'wait', faceWhy: null, light: sense.caps.airpodsHr ? null : 'wait', lightWhy: null, room: isLong ? (micOn ? 'wait' : 'off') : null, sounds: false })
      listening = 'room'
      let soundsIn = false
      const sounds = audio.ready(LAUGHS, 7000).then(() => {
        soundsIn = true
      })
      await sleep(1000)
      let c = readCheck()
      setCheck(c)
      await sleep(1000)
      c = readCheck()
      setCheck(c)
      const bad = () => c.face === 'warn' || c.light === 'warn' || c.room === 'warn'
      for (let i = 0; i < 8 && bad(); i++) {
        await sleep(250)
        c = readCheck()
        setCheck(c)
      }
      if (!soundsIn) {
        setCheck({ ...c, sounds: true })
        await sounds
        if (cancelled) throw CANCEL
      }
      listening = null
    }

    const run: Record<PhaseKey, (ms: number) => Promise<void>> = {
      async settle(ms) {
        show('Just look here.', 'Rest for a moment.')
        say('vo-settle')
        // once the voice line is over, the room is heard on its own
        await sleep(4500)
        listening = 'room'
        await sleep(ms - 4500)
        listening = null
      },
      async nod(ms) {
        show('Nod when you’re ready.')
        say('vo-nod')
        const t0 = performance.now()
        nodPeak = 0
        nodding = true
        const seenNod = new Promise<void>((res) => {
          nodSeen = res
        })
        const early = seenNod.then(async () => {
          show('There.')
          audio.bell(0.16, 784)
          // let the voice line finish, and keep recording the tail of the nod
          await sleep(Math.max(650, 1700 - (performance.now() - t0)))
        })
        await Promise.race([sleep(ms), early])
        nodding = false
        nodSeen = null
      },
      async laugh(ms) {
        show('Here’s something for you.', 'Just listen.')
        if (isLong) say('vo-listen', 0.9)
        beginLaugh()
        await sleep(1000)
        const clip = stim === 'personal' && lovedUrl ? 'personal' : stim.startsWith('laugh-') ? stim : pick(audio.available(LAUGHS))
        const latency = audio.ctx ? ((audio.ctx.outputLatency || audio.ctx.baseLatency || 0) as number) * 1000 : 0
        laughOnsetT = performance.now() + latency
        const h = stim.startsWith('daily-') && daily?.laugh.source === 'generated'
          ? audio.playUrl(dailyUrl('laugh'), { gain: 1 })
          : clip === 'personal' ? audio.playUrl(lovedUrl!, { gain: 1 }) : clip ? audio.play(clip, { gain: 1 }) : null
        if (h) handles.push(h)
        laughPlayed = !!h && audio.running
        // the smile is timed as it happens: the first held rise is the answer, and nothing later in the phase can move it
        let left = ms - 1000
        let timed = false
        while (left > 0) {
          const d = Math.min(250, left)
          await sleep(d)
          left -= d
          if (timed) continue
          if (airOnly) {
            const earMs = readEarLaugh(earSamples, earModel, laughOnsetT ?? performance.now())
            if (earMs != null) {
              earLaughMs = earMs
              timed = true
              live.send({ type: 'reading', readings: { laugh: { value: earMs / 1000, unit: 's', readable: true } } })
            }
            continue
          }
          const p = sense.peekRecording?.({ laughOnsetT })
          if (p && p.features.smile.latencyMs != null) {
            const r = stepReading('laugh', p.features, judge(p.features))
            if (r.readable) {
              timed = true
              live.send({ type: 'reading', readings: { laugh: r } })
            }
          }
        }
        h?.stop(500)
        laughRead = endLaugh()
      },
      async speak(ms) {
        const have = audio.available(['vo-speak-1', 'vo-speak-2', 'vo-speak-3'])
        const dailyIndex = daily ? SPEAK_PROMPTS.indexOf(daily.question as (typeof SPEAK_PROMPTS)[number]) : -1
        const name = dailyIndex >= 0 ? `vo-speak-${dailyIndex + 1}` : pick(have) ?? `vo-speak-${1 + Math.floor(Math.random() * 3)}`
        const n = Number(name.slice(-1)) - 1
        const question = daily?.question ?? SPEAK_PROMPTS[n]
        show(question, 'Say it out loud. A sentence or two.')
        const t0 = performance.now()
        const h = daily?.questionAudio.source === 'generated' ? audio.playUrl(dailyUrl('question')) : await audio.playSoon(name)
        keep(h)
        if (cancelled) throw CANCEL
        // The question comes out of the phone's own speaker and straight back into its microphone. The speak
        // window opens when the question is over, so the voice that gets measured is the person's.
        const gap = h ? Math.min(ms - 7000, h.duration * 1000 + 250) - (performance.now() - t0) : 0
        if (gap > 0) await sleep(gap)
        sense.mark('speak')
        listening = 'answer'
        await sleep(Math.max(0, ms - (performance.now() - t0)))
        listening = null
      },
      async breathe(ms) {
        const breaths = Math.round(ms / 10000)
        breathStart.current = performance.now()
        if (isLong) say('vo-breathe')
        for (let i = 0; i < breaths; i++) {
          show('Breathe in', breaths > 1 ? 'Two slow breaths.' : 'One slow breath.')
          const a = audio.breath('in', 5, 0.5)
          if (a) handles.push(a)
          if (i > 0 || kind === 'mini' || kind === 'hall') say('vo-in', 0.9)
          await sleep(5000)
          show('And out', breaths > 1 ? 'Two slow breaths.' : 'One slow breath.')
          const b = audio.breath('out', 5, 0.5)
          if (b) handles.push(b)
          say('vo-out', 0.9)
          await sleep(5000)
        }
        breathStart.current = null
      },
    }

    /** which channels this ping could not measure, and why, in the person's words */
    const judge = (f: PingFeatures) => {
      const unreadable: Channel[] = []
      const why: Partial<Record<Channel, string>> = {}
      const no = (ch: Channel, because: string) => {
        unreadable.push(ch)
        why[ch] = `${UNREAD_NOTE[ch]} ${because}`
      }
      const share = (s: [number, number]) => (s[1] ? s[0] / s[1] : 0)

      if (!laughPlayed) no('smile', 'The laughter didn’t play, so there was nothing to answer.')
      else if (airOnly && earLaughMs == null) {
        const can = earModel && (earModel.events.smile?.score.ok || earModel.events.laugh?.score.ok)
        no('smile', can ? 'Your AirPods did not read a clear smile this time.' : 'Your AirPods have not learned your smile yet.')
      } else if (!airOnly && share(seen.laugh) < 0.5) no('smile', 'Your face was out of view while the laughter played.')

      if (isLong) {
        if (!micOn || room.n + answer.n === 0) no('voice', 'The microphone was off.')
        else {
          const roomTalks = room.n > 0 && room.voiced / room.n > 0.25
          const sd = f.voice.f0SdSemitones
          if (roomTalks && (!answer.rms.length || median(answer.rms) < median(room.rms) + 6)) {
            no('voice', 'The room was too loud to tell your voice from it.')
          } else if (f.voice.speechFraction < 0.08 || answer.voiced < 0.08 * answer.n) {
            no('voice', 'I didn’t hear you speak.')
          } else if (sd != null && sd > 9) {
            // nobody's sentence swings this far: that is the room, not a voice
            no('voice', 'The room was too loud to tell your voice from it.')
          }
        }
      }

      if (f.heart.swingBpm == null || f.heart.quality < 0.3) {
        no(
          'heart',
          f.heart.source === 'airpods'
            ? 'I couldn’t follow your pulse through both breaths. Keep still while you breathe, and keep your AirPods in.'
            : 'I couldn’t follow your pulse through both breaths. More light on your face, and keep still while you breathe.',
        )
      }

      if (isLong && f.move.nodPeakVelDegS == null) {
        no('move', f.move.source === 'camera' && share(seen.nod) < 0.5 ? 'Your face was out of view, so the nod was missed.' : 'I didn’t see one.')
      }
      return { unreadable, why }
    }

    /** One finished step as the big screen and the clinic get it. The phone is the only source of these. */
    const stepReading = (key: PhaseKey, f: PingFeatures, j: { unreadable: Channel[]; why: Partial<Record<Channel, string>> }): StepReading => {
      const un = (ch: Channel) => j.unreadable.includes(ch)
      const said = (ch: Channel, fallback: string) => j.why[ch] ?? fallback
      switch (key) {
        case 'settle': {
          // the resting pulse is its own reading, taken in this step: it stands whether or not the swing is read later
          const v = f.heart.restBpm
          return { value: v, unit: 'bpm', readable: v != null, reason: v == null ? 'the pulse was too faint to follow' : undefined }
        }
        case 'nod': {
          const v = f.move.nodPeakVelDegS
          const bad = v == null || un('move')
          return { value: v, unit: '°/s', readable: !bad, reason: bad ? said('move', 'no nod seen') : undefined }
        }
        case 'laugh': {
          if (airOnly) return earLaughMs == null
            ? { value: null, unit: 's', readable: false, reason: 'Your AirPods have not learned your smile yet.' }
            : { value: earLaughMs / 1000, unit: 's', readable: true }
          const ms = f.smile.latencyMs
          const bad = ms == null || un('smile')
          return { value: ms == null ? null : ms / 1000, unit: 's', readable: !bad, reason: bad ? said('smile', f.smile.alreadySmiling ? 'already smiling when the laugh began' : 'no smile seen') : undefined }
        }
        case 'speak': {
          // the same rule as the echo: a voice the echo leaves out is not a reading on the big screen either
          const v = f.voice.f0SdSemitones
          const bad = v == null || un('voice')
          return { value: v, unit: 'semitones', readable: !bad, reason: un('voice') ? said('voice', 'the room was too loud') : v == null ? 'no voice heard' : undefined }
        }
        case 'breathe': {
          const v = f.heart.swingBpm
          const bad = v == null || un('heart')
          return { value: v, unit: 'bpm', readable: !bad, reason: bad ? said('heart', 'the pulse was too faint to follow') : undefined }
        }
      }
    }
    /** readings already sent while the ping ran; a step keeps the reading it was given */
    const sent: Partial<Record<PhaseKey, StepReading>> = {}
    const publish = (key: PhaseKey) => {
      const p = sense.peekRecording?.({ laughOnsetT })
      if (!p) return
      const r = stepReading(key, p.features, judge(p.features))
      sent[key] = r
      live.send({ type: 'reading', readings: { [key]: r } })
    }

    const main = async () => {
      await sleep(60)
      void keepAwake(true)
      sense.setHeartSession(true)
      live.startFrames()
      if (kind === 'mini') {
        say('vo-mini')
        await sleep(3300)
      } else if (kind === 'full' && !airOnly) {
        await checkStep()
      }
      const startedAt = new Date().toISOString()
      sense.beginRecording()
      recording = true
      const t0 = performance.now()
      for (let i = 0; i < phases.length; i++) {
        const p = phases[i]
        if (p.key === 'speak') {
          // held back until the question is over (see run.speak). The laugh window still ends here.
          sense.mark('laugh')
          promptAt = Math.round(performance.now() - t0)
        } else sense.mark(p.key)
        // the step before is closed by the mark above: read it now, so its number lands as the next step starts
        if (i > 0) publish(phases[i - 1].key)
        live.setPhase(p.key)
        phaseNow = p.key
        idx.current = i
        phaseStart.current = performance.now()
        setStep(p.key)
        await run[p.key](p.ms)
      }
      phaseNow = null
      const out = sense.endRecording({ laughOnsetT })
      recording = false
      finished = true
      // the clinic's trace strip shows the five phases where they began, question included
      if (promptAt != null) {
        const marks = out.traces.phases
        const second = marks.findIndex((m, i) => m.key === 'laugh' && i > 0 && marks.slice(0, i).some((x) => x.key === 'laugh'))
        if (second >= 0) {
          const at = marks[second].at
          marks.splice(second, 1)
          const sp = marks.find((m) => m.key === 'speak')
          if (sp) sp.at = at
        }
      }
      Object.assign(out.features, laughRead)
      const { unreadable, why } = judge(out.features)
      const j = { unreadable, why }
      const stepReadings: Partial<Record<PhaseKey, StepReading>> = {}
      for (const p of phases) stepReadings[p.key] = p.key === 'settle' && sent.settle ? sent.settle : stepReading(p.key, out.features, j)
      // The phone is the source of truth: the big screen shows these values and never its own estimate.
      live.send({ type: 'reading', readings: stepReadings })
      idx.current = phases.length
      setStep('done')
      show('That’s it.', kind === 'full' || kind === 'hall' ? 'Reading your four numbers…' : 'Reading how it changed…')
      audio.chime(0.4)
      if (kind === 'full' || kind === 'hall') say('vo-done')
      done.current({ ...out, startedAt, unreadable, why, head: out.features.move.source, heart: out.features.heart.source, stepReadings })
    }

    const stopRun = () => {
      cancelled = true
      timers.forEach((id) => clearTimeout(id))
      clearTimeout(noteTimer)
      handles.forEach((h) => h.stop(150))
      breathStart.current = null
      if (recording) {
        recording = false
        try {
          sense.endRecording({ laughOnsetT: null })
        } catch {
          /* discarded */
        }
      }
      endLaugh()
      void keepAwake(false)
    }

    /** a call, the lock screen, another app: the ping cannot be trusted any more. Stop cleanly and offer to go again. */
    const interrupt = (why: Pause) => {
      if (cancelled || finished) return
      stopRun()
      live.stopFrames()
      stopSession()
      setPaused(why)
    }

    const pauseForSensor = (why: Pause) => {
      if (sensorPause === why || cancelled || finished || idx.current < 0 || idx.current >= phases.length) return
      sensorPause = why
      sensorPauseAt = performance.now()
      sensingPauseRef.current = true
      setSensingPaused(why)
    }
    const resumeSensor = () => {
      if (!sensorPause) return
      const held = performance.now() - sensorPauseAt
      phaseStart.current += held
      sensorPause = null
      sensingPauseRef.current = false
      setSensingPaused(null)
    }

    main().catch((e) => {
      if (e !== CANCEL) {
        console.error(e)
        interrupt('camera')
      }
    })

    const onHide = () => {
      if (document.visibilityState === 'hidden') interrupt('away')
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)

    // progress segments
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const now = performance.now()
      fills.current.forEach((el, i) => {
        if (!el) return
        if (sensingPauseRef.current) return
        const v = i < idx.current ? 1 : i === idx.current ? Math.min(1, (now - phaseStart.current) / phases[i].ms) : 0
        el.style.transform = `scaleX(${v.toFixed(4)})`
      })
    }
    raf = requestAnimationFrame(tick)

    // twice a second: a nudge when the face leaves the picture, where the signals come from, and whether the ping can still be trusted
    let lostSince: number | null = null
    let soundRan = audio.running
    let soundGone: number | null = null
    let cameraGone: number | null = null
    const watch = window.setInterval(() => {
      if (cancelled) return
      const now = performance.now()
      const l = sense.latest()
      if (!airOnly && l.face && !l.face.present) {
        lostSince ??= now
        if (now - lostSince > 2000) setFaceLost(true)
        if (now - lostSince > 1200) pauseForSensor('away')
      } else if (!airOnly) {
        lostSince = null
        setFaceLost(false)
        if (sensorPause === 'away') resumeSensor()
      }
      if (!airOnly && sensorPause === null && !isMock() && l.face && l.face.present) {
        const dbg = typeof (sense as Partial<SenseWithDebug>).debug === 'function' ? (sense as Partial<SenseWithDebug>).debug?.() : null
        if (dbg && cameraIssues(dbg, l.face).includes('too-dark')) pauseForSensor('away')
      } else if (!airOnly && sensorPause === 'away' && l.face?.present) {
        const dbg = typeof (sense as Partial<SenseWithDebug>).debug === 'function' ? (sense as Partial<SenseWithDebug>).debug?.() : null
        if (!dbg || !cameraIssues(dbg, l.face).includes('too-dark')) resumeSensor()
      }
      if (sensorPause) setSensingPausedFor(Math.round((now - sensorPauseAt) / 1000))
      const head: MoveSource = l.head?.source ?? 'camera'
      // the last number may still be the AirPods' for a moment after they drop out: go by whether they are still there
      const heart: HeartSource = l.pulse?.source === 'airpods' && sense.caps.airpodsHr ? 'airpods' : 'camera'
      const air = sense.caps.airpodsMotion
      setSrc((s) => (s && s.head === head && s.heart === heart && s.air === air ? s : { head, heart, air }))
      if (finished) return

      // the sound: gone for more than a moment after it was running means a call or another app has it
      if (audio.running) {
        soundRan = true
        soundGone = null
      } else if (soundRan) {
        soundGone ??= now
        void audio.ctx?.resume().catch(() => {})
        if (now - soundGone > 2500) interrupt('sound')
      }
      // the camera: its track ended, or no picture has come through for a while
      // (a slow phone may need a few seconds before its first picture: that is not a stopped camera)
      const dead = !airOnly && ((!isMock() && !sense.caps.camera) || now - lastFaceAt > (gotFace ? 4000 : 12000))
      if (dead) {
        cameraGone ??= now
        if (now - cameraGone > 1500) interrupt('camera')
      } else cameraGone = null
    }, 500)

    return () => {
      const wasRunning = !cancelled
      if (wasRunning) stopRun()
      cancelAnimationFrame(raf)
      clearInterval(watch)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
      offs.forEach((off) => off())
    }
    // one run per mount: the ping is a fixed script
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const mode: EchoMode = step === 'lead' || step === 'check' || paused ? 'idle' : step === 'done' ? 'all' : step
  const measuring = step === 'lead' || step === 'check' || step === 'done' ? null : MEASURES[step]
  const guide = (now: number) => {
    const t0 = breathStart.current
    if (t0 == null) return null
    const u = (now - t0) % 10000
    return u < 5000 ? 0.5 - 0.5 * Math.cos((Math.PI * u) / 5000) : 0.5 + 0.5 * Math.cos((Math.PI * (u - 5000)) / 5000)
  }

  if (paused) {
    return (
      <div className="va-stage" data-step="paused" data-paused={paused}>
        <div className="va-stage-top">
          <span className="va-progress" />
          <button className="va-icon-btn va-on-stage" onClick={onLeave} aria-label="Go back">
            <IconClose />
          </button>
        </div>
        <EchoCanvas mode="idle" className="va-stage-canvas" />
        <div className="va-stage-words" role="alert">
          <p className="va-stage-line">{PAUSED[paused][0]}</p>
          <p className="va-stage-sub">
            {PAUSED[paused][1].map((t) => [
              <span key={t} className="va-nb">
                {t}
              </span>,
              ' ',
            ])}
          </p>
        </div>
        <div className="va-paused-go">
          <button
            className="va-btn va-btn-primary va-btn-big"
            disabled={again}
            onClick={() => {
              setAgain(true)
              onRestart()
            }}
          >
            {again ? 'Starting…' : 'Start again'}
          </button>
          <button className="va-btn va-btn-ghost" onClick={onLeave}>
            Not now
          </button>
        </div>
      </div>
    )
  }

  if (sensingPaused) {
    return (
      <div className="va-stage" data-step="paused-sensor" role="alert">
        <EchoCanvas mode="idle" className="va-stage-canvas" />
        <div className="va-stage-words">
          <p className="va-stage-line">The ping is paused.</p>
          <p className="va-stage-sub">{sensingPaused === 'away' ? 'Bring your face back into view. The timer will resume when it can see you.' : 'Face a light if you can. The timer is stopped while the reading is unclear.'}</p>
        </div>
        <div className="va-paused-go">
          {sensingPausedFor >= 8 && <button className="va-btn va-btn-primary va-btn-big" onClick={onRestart}>Start this step again</button>}
          <button className="va-btn va-btn-ghost" onClick={onLeave}>Not now</button>
        </div>
      </div>
    )
  }

  const checking = step === 'check' && check
  return (
    <div className="va-stage" data-step={step}>
      <div className="va-stage-top">
        <div className="va-progress" aria-hidden="true">
          {phases.map((p, i) => (
            <span key={p.key} className="va-progress-seg" style={{ flexGrow: p.ms }}>
              <span
                className="va-progress-fill"
                ref={(el) => {
                  fills.current[i] = el
                }}
              />
            </span>
          ))}
        </div>
        <button className="va-icon-btn va-on-stage" onClick={onLeave} aria-label="Stop and go back">
          <IconClose />
        </button>
      </div>

      <EchoCanvas mode={mode} guide={guide} className="va-stage-canvas" />

      <div className="va-stage-words" aria-live="polite">
        <p className="va-stage-line" key={line}>
          {line}
        </p>
        {checking ? (
          <ul className="va-check">
            <li data-mark={check.face}>
              {check.face === 'wait'
                ? 'Looking for your face'
                : check.face === 'ok'
                  ? 'Face in view'
                  : check.faceWhy === 'far'
                    ? 'Bring the phone a little closer to your face'
                    : check.faceWhy === 'turned'
                      ? 'Turn your face towards the phone'
                      : 'Hold the phone so it can see your face'}
            </li>
            {check.light && (
              <li data-mark={check.light}>
                {check.light === 'wait'
                  ? 'Checking the light'
                  : check.light === 'ok'
                    ? 'Enough light'
                    : check.lightWhy === 'dark'
                      ? 'It’s dark here. Face a light if you can.'
                      : 'It’s a little dark for your pulse. Face a light if you can.'}
              </li>
            )}
            {check.room && (
              <li data-mark={check.room === 'off' ? 'warn' : check.room}>
                {check.room === 'wait'
                  ? 'Listening to the room'
                  : check.room === 'ok'
                    ? 'Quiet enough'
                    : check.room === 'off'
                      ? 'The microphone is off, so your voice won’t be read'
                      : 'It’s loud here. Hold the phone close when you speak.'}
              </li>
            )}
            {check.sounds && <li data-mark="wait">Getting the sounds ready…</li>}
          </ul>
        ) : (
          <p className="va-stage-sub" key={`s-${sub}`}>
            {sub}
          </p>
        )}
      </div>

      <div className="va-stage-foot">
        {faceLost && step !== 'check' ? (
          <p className="va-stage-hint">Bring your face back into view</p>
        ) : note ? (
          <p className="va-stage-hint">{note}</p>
        ) : step === 'check' ? (
          isShell() && src && !src.air && <p className="va-stage-src">Put your AirPods in for head movement and heart rate. Without them the camera reads both.</p>
        ) : airOnly ? (
          <div className="va-air-only-foot">
            <p className="va-stage-src">AirPods only. The camera is off.</p>
            {onUseCamera && <button type="button" className="va-link" onClick={onUseCamera}>Use the camera today</button>}
          </div>
        ) : (
          <ul className="va-legend" aria-hidden="true">
            {CHANNEL_ORDER.filter((c) => isLong || c === 'smile' || c === 'heart').map((c) => (
              <li key={c} className="va-legend-item" data-ch={c} data-on={measuring === c}>
                <i />
                <span>{c}</span>
              </li>
            ))}
          </ul>
        )}
        {src && <p className="va-stage-src va-stage-from">{sourceLine(src.head, src.heart)}</p>}
      </div>
    </div>
  )
}
