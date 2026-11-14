import { useEffect, useRef, useState } from 'react'
import { connectEars, onNative, postNative } from '../../sense/native'
import type { NativeMsg } from '../../sense/native'
import { apiUrl } from '../../shared/api'
import './eeg.css'

type EegSource = 'AirPods' | 'Apple Watch' | 'iPhone' | 'another device'
interface EegLog {
  v: 1; at: string; ua: string
  clock: { start: { dateNow: number; timeOriginNow: number; deltaMs: number }; end?: { dateNow: number; timeOriginNow: number; deltaMs: number } }
  sampleRateHz: number; samplesPerSecond?: number; sampleEveryMs: number; motion: number[][]
  heart: Array<{ t: number; bpm: number; source: EegSource }>
  steps: Array<{ name: string; t0: number; t1: number }>; sync: Array<{ n: number; t: number }>
}

type Phase = 'ready' | 'sync' | 'eyes-open' | 'eyes-closed' | 'breathing' | 'smile' | 'done' | 'stopped' | 'saving'
type Saved = { id: string; code: string; log: EegLog & { id?: string } }
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const speed = () => { try { return Math.max(1, Number(localStorage.getItem('vire.eeg.speed')) || 1) } catch { return 1 } }
const inApp = () => !!(window as unknown as { webkit?: { messageHandlers?: { vire?: unknown } } }).webkit?.messageHandlers?.vire
const sourceOf = (raw: unknown): EegSource => {
  const s = String(raw ?? '')
  if (/airpods/i.test(s)) return 'AirPods'
  if (/watch/i.test(s)) return 'Apple Watch'
  if (/iphone/i.test(s)) return 'iPhone'
  return 'another device'
}
const clock = () => { const dateNow = Date.now(); const timeOriginNow = performance.timeOrigin + performance.now(); return { dateNow, timeOriginNow, deltaMs: dateNow - timeOriginNow } }

async function keepScreenOn(): Promise<() => void> {
  try {
    const lock = await (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen')
    return () => void lock?.release().catch(() => {})
  } catch { return () => {} }
}
function tone(): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx(); const osc = ctx.createOscillator(); const gain = ctx.createGain()
    osc.frequency.value = 660; gain.gain.setValueAtTime(0.0001, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01); gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12)
    osc.connect(gain).connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.14); osc.addEventListener('ended', () => void ctx.close())
  } catch { /* a beep is helpful but never blocks the recording */ }
}

export default function Eeg() {
  const [phase, setPhase] = useState<Phase>('ready')
  const [label, setLabel] = useState('Two minutes. Keep your head easy and follow the words.')
  const [left, setLeft] = useState(0)
  const [flash, setFlash] = useState(0)
  const [saved, setSaved] = useState<Saved | null>(null)
  const [error, setError] = useState<string | null>(null)
  const motion = useRef<number[][]>([])
  const heart = useRef<Array<{ t: number; bpm: number; source: EegSource }>>([])
  const steps = useRef<Array<{ name: string; t0: number; t1: number }>>([])
  const sync = useRef<Array<{ n: number; t: number }>>([])
  const startAt = useRef(0)
  const clockStart = useRef<ReturnType<typeof clock> | null>(null)
  const cancelled = useRef(false)
  const running = useRef(false)
  const stopListening = useRef<(() => void) | null>(null)
  const releaseWake = useRef<(() => void) | null>(null)

  useEffect(() => {
    const onMessage = (msg: NativeMsg) => {
      if (!running.current) return
      if (msg.k === 'head') for (const row of msg.s) if (row.length === 10 && row.every(Number.isFinite)) motion.current.push(row.slice())
      if (msg.k === 'hr') heart.current.push({ t: msg.t, bpm: msg.bpm, source: 'AirPods' })
      if (msg.k === 'hrs') heart.current.push({ t: msg.t, bpm: msg.bpm, source: sourceOf(msg.src) })
    }
    stopListening.current = onNative(onMessage)
    const hidden = () => {
      if (!running.current || !document.hidden) return
      cancelled.current = true
      running.current = false
      postNative({ cmd: 'heart', on: false }); postNative({ cmd: 'stop' }); releaseWake.current?.(); releaseWake.current = null
      setPhase('stopped'); setLabel('Recording stopped because this page was hidden. Start again with the screen awake.'); setLeft(0)
    }
    document.addEventListener('visibilitychange', hidden)
    return () => { document.removeEventListener('visibilitychange', hidden); stopListening.current?.(); stopListening.current = null }
  }, [])

  const recordStep = (name: string, t0: number, t1: number) => steps.current.push({ name, t0, t1 })
  const timed = async (name: string, ms: number, text: string) => {
    const t0 = Date.now(); recordStep(name, t0, t0)
    setLabel(text); setLeft(Math.ceil(ms / 1000));
    const started = performance.now()
    while (performance.now() - started < ms / speed()) {
      if (cancelled.current) throw new Error('stopped')
      setLeft(Math.max(0, Math.ceil((ms / speed() - (performance.now() - started)) / 1000)))
      await wait(Math.min(100, Math.max(20, 500 / speed())))
    }
    const t1 = Date.now(); steps.current[steps.current.length - 1]!.t1 = t1
  }
  const syncMark = async (which: number) => {
    const t0 = Date.now(); recordStep(`sync-${which}`, t0, t0)
    setPhase('sync'); setLabel('Three firm nods, one on each beep.');
    for (let n = 1; n <= 3; n++) {
      if (cancelled.current) throw new Error('stopped')
      tone(); const t = Date.now(); sync.current.push({ n: (which - 1) * 3 + n, t }); setFlash((x) => x + 1); setLeft(3 - n)
      await wait(420 / speed())
    }
    const t1 = Date.now(); steps.current[steps.current.length - 1]!.t1 = t1
    await wait(120 / speed())
  }
  const finish = async () => {
    const endClock = clock(); const ended = Date.now();
    postNative({ cmd: 'heart', on: false }); postNative({ cmd: 'stop' }); releaseWake.current?.(); releaseWake.current = null; running.current = false
    const rows = [...motion.current].sort((a, b) => a[0]! - b[0]!); const hrs = [...heart.current].sort((a, b) => a.t - b.t)
    const elapsed = Math.max(1, ended - startAt.current)
    const rate = rows.length * 1000 / elapsed
    const log: EegLog = { v: 1, at: new Date(startAt.current).toISOString(), ua: navigator.userAgent, clock: { start: clockStart.current!, end: endClock }, sampleRateHz: rate, samplesPerSecond: rate, sampleEveryMs: 1000, motion: rows, heart: hrs, steps: steps.current.slice(), sync: sync.current.slice() }
    setPhase('saving'); setLabel('Saving the numbers…');
    try {
      const res = await fetch(apiUrl('ear/eeg'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(log) })
      if (!res.ok) throw new Error(`save failed (${res.status})`)
      const answer = await res.json() as { id: string; code: string }
      setSaved({ id: answer.id, code: answer.code, log: { ...log, id: answer.id } }); setPhase('done'); setLabel('Done. Write the four letters into the EEG file name.');
    } catch (e) { setPhase('stopped'); setError(e instanceof Error ? e.message : 'Could not save the log'); setLabel('The run finished, but the log could not be saved. Keep this page open and try again.'); }
  }
  const start = async () => {
    if (running.current) return
    motion.current = []; heart.current = []; steps.current = []; sync.current = []; setSaved(null); setError(null); cancelled.current = false; running.current = true; startAt.current = Date.now(); clockStart.current = clock(); setPhase('sync');
    releaseWake.current = await keepScreenOn()
    if (!inApp()) await connectEars()
    postNative({ cmd: 'start' }); postNative({ cmd: 'heart', on: true })
    try {
      await syncMark(1)
      setPhase('eyes-open'); await timed('eyes-open', 20_000, 'Eyes open. Rest your face and head.')
      setPhase('eyes-closed'); await timed('eyes-closed', 20_000, 'Eyes closed. Stay at rest.'); tone()
      setPhase('breathing'); await timed('slow-breathing', 60_000, 'Slow breathing. In for 4 seconds, out for 6.')
      for (let i = 1; i <= 4; i++) { setPhase('smile'); await timed(`smile-${i}`, 2_500, `Smile gently for 2.5 seconds (${i} of 4).`); if (i < 4) await timed(`smile-${i}-rest`, 2_500, 'Let go and rest.') }
      await syncMark(2); if (!cancelled.current) await finish()
    } catch { /* hidden-page stop already explained */ }
  }
  const download = saved ? URL.createObjectURL(new Blob([JSON.stringify(saved.log, null, 2)], { type: 'application/json' })) : null
  return <main className="eeg" data-phase={phase}>
    <div className="eeg-flash" key={flash} aria-hidden="true" />
    <header><span className="eeg-brand">Vire</span><span>EEG booth recording</span></header>
    <section className="eeg-card">
      <p className="eeg-kicker">Aalto booth · two minutes</p>
      <h1>{phase === 'ready' ? 'A quiet check beside your EEG.' : phase === 'done' ? 'The two minutes are saved.' : phase === 'stopped' ? 'The recording stopped.' : phase === 'saving' ? 'Almost there.' : label}</h1>
      {phase === 'ready' && <><p className="eeg-copy">Wear your EEG headset and AirPods together. Keep this page awake and follow the short prompts. AirPods record motion and heart rate only.</p><button type="button" className="eeg-start" data-start onClick={() => void start()}>Start the two minutes</button></>}
      {phase !== 'ready' && phase !== 'done' && phase !== 'stopped' && phase !== 'saving' && <><p className="eeg-count" aria-live="polite">{left > 0 ? `${left}s` : '0s'}</p>{phase === 'breathing' && <div className="eeg-breath" aria-label="breathing pace" />}{phase === 'sync' && <p className="eeg-sync">Nod firmly when the screen flashes.</p>}</>}
      {phase === 'stopped' && <button type="button" className="eeg-start" data-start onClick={() => void start()}>Start again</button>}
      {error && <p className="eeg-error">{error}</p>}
      {saved && <div className="eeg-result" data-saved><p><b>Log ID</b> {saved.id}</p><p><b>EEG code</b> <strong>{saved.code}</strong></p><a href={download ?? '#'} download={`vire-eeg-${saved.id}.json`}>Download the log</a><p className="eeg-small">The file contains numbers, timestamps and the protocol events. No audio or picture was recorded.</p></div>}
    </section>
  </main>
}
