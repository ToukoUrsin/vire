// /#/lab: the sensing debug page. Open it on the real phone, tap Start, watch the numbers.
import { useCallback, useEffect, useRef, useState } from 'react'
import { PING_PHASES } from '@shared/types'
import type { PhaseKey } from '@shared/types'
import { createSense } from './index'
import type { SenseDebug, SenseWithDebug } from './index'

const WINDOW_MS = 12000

interface Meter {
  key: string
  label: string
  color: string
  min: number
  max: number
  /** draw separate dots (values that come and go) instead of a line */
  dots?: boolean
  fmt: (v: number | null) => string
}

const num = (d: number, unit = '') => (v: number | null) => (v === null || !Number.isFinite(v) ? '–' : v.toFixed(d) + unit)

const METERS: Meter[] = [
  { key: 'smile', label: 'smile', color: '--ch-smile', min: 0, max: 1, fmt: num(2) },
  { key: 'cheek', label: 'cheek', color: '--ch-smile', min: 0, max: 1, fmt: num(2) },
  { key: 'pitch', label: 'head pitch', color: '--ch-move', min: -35, max: 35, fmt: num(1, '°') },
  { key: 'yaw', label: 'head yaw', color: '--ch-move', min: -35, max: 35, fmt: num(1, '°') },
  { key: 'wave', label: 'pulse wave', color: '--ch-heart', min: -1.5, max: 1.5, fmt: num(2) },
  { key: 'bpm', label: 'bpm', color: '--ch-heart', min: 40, max: 130, dots: true, fmt: num(1) },
  { key: 'quality', label: 'pulse quality', color: '--ch-heart', min: 0, max: 1, fmt: num(2) },
  { key: 'rms', label: 'voice level', color: '--ch-voice', min: -90, max: 0, fmt: num(0, ' dB') },
  { key: 'f0', label: 'voice pitch', color: '--ch-voice', min: 60, max: 400, dots: true, fmt: num(0, ' Hz') },
]

type Hist = Record<string, { t: number[]; v: (number | null)[] }>

function makeHist(): Hist {
  const h: Hist = {}
  for (const m of METERS) h[m.key] = { t: [], v: [] }
  return h
}

function pushHist(h: Hist, key: string, t: number, v: number | null): void {
  const s = h[key]
  s.t.push(t)
  s.v.push(v)
  if (s.t.length > 1200) {
    s.t.splice(0, 300)
    s.v.splice(0, 300)
  }
}

const HINT: Record<PhaseKey, string> = {
  settle: 'Look at the screen and rest',
  nod: 'Nod when you are ready',
  laugh: 'Laughter plays (after 1 s)',
  speak: 'Say a sentence out loud',
  breathe: 'Breathe slowly: 5 s in, 5 s out',
}

const MINI: { key: PhaseKey; ms: number }[] = [
  { key: 'laugh', ms: 8000 },
  { key: 'breathe', ms: 10000 },
]

const CSS = `
.lab { min-height: 100%; padding: 14px 14px 48px; max-width: 560px; margin: 0 auto; }
.lab h1 { font-size: var(--text-h3); }
.lab-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.lab-card { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 12px; margin-bottom: 12px; }
.lab-btn { min-height: 44px; }
.lab-btn.on, .lab-btn.on:hover:not(:disabled) { background: var(--ink); color: var(--paper); }
.lab-row { display: flex; gap: 12px; }
.lab-video { width: 84px; height: 112px; border-radius: var(--radius-s); background: var(--stage); object-fit: cover; transform: scaleX(-1); flex: none; }
.lab-big { flex: 1; min-width: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; align-content: center; }
.lab-big div span { display: block; font-size: var(--text-caption); color: var(--ink-3); }
.lab-big div b { font-size: var(--text-title); font-weight: 600; font-variant-numeric: tabular-nums; }
.lab-big div b.ok { color: var(--ok-ink); }
.lab-big div b.warn { color: var(--warn-ink); }
.lab-kv { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; font-size: var(--text-small); align-content: start; min-width: 0; flex: 1; }
.lab-kv dt { color: var(--ink-3); white-space: nowrap; }
.lab-kv dd { margin: 0; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; min-width: 0; }
.lab-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.lab-chip { font-size: var(--text-caption); padding: 2px 8px; border-radius: var(--radius-pill); border: 1px solid var(--line); color: var(--ink-3); }
.lab-chip.yes { background: var(--ok-ink); border-color: var(--ok-ink); color: var(--card); }
.lab-meter { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-top: 1px solid var(--line); }
.lab-meter:first-child { border-top: 0; }
.lab-meter .lbl { width: 104px; flex: none; }
.lab-meter .lbl span { display: block; font-size: var(--text-caption); color: var(--ink-3); }
.lab-meter .lbl b { font-size: var(--text-lead); font-weight: 600; font-variant-numeric: tabular-nums; }
.lab-meter canvas { flex: 1; min-width: 0; height: 40px; width: 100%; background: var(--paper); border-radius: var(--radius-xs); }
.lab-wrap { display: flex; flex-wrap: wrap; gap: 8px; }
.lab-err { background: var(--ember-soft); color: var(--bad-ink); border-radius: var(--radius-s); padding: 10px 12px; margin-bottom: 12px; font-size: var(--text-label); }
.lab-phase { font-family: var(--font-display); font-size: var(--text-title); margin: 10px 0 2px; }
.lab-sub { color: var(--ink-2); font-size: var(--text-label); }
.lab pre { background: var(--stage); color: var(--stage-ink); border-radius: var(--radius-s); padding: 12px; font-size: var(--text-caption); line-height: 1.4; overflow: auto; max-height: 60vh; margin: 10px 0 0; white-space: pre-wrap; word-break: break-word; }
.lab-small { font-size: var(--text-caption); color: var(--ink-3); margin-top: 6px; }
`

// one instance for the page (StrictMode renders twice; a second instance would be an orphan)
let labSense: SenseWithDebug | null = null

export default function Lab() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const histRef = useRef<Hist>(makeHist())
  const canvases = useRef<Record<string, HTMLCanvasElement | null>>({})
  const laughOnset = useRef<number | null>(null)
  const runToken = useRef(0)
  const [status, setStatus] = useState<'idle' | 'starting' | 'running'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [, setTick] = useState(0)
  const [recording, setRecording] = useState(false)
  const [phase, setPhase] = useState<{ key: PhaseKey; until: number | null } | null>(null)
  const [result, setResult] = useState('')
  const [withTraces, setWithTraces] = useState(false)
  const lastResult = useRef<{ features: unknown; traces: unknown } | null>(null)

  if (!labSense) labSense = createSense() as SenseWithDebug
  const sense = labSense

  // wire events once
  useEffect(() => {
    const h = histRef.current
    const offs = [
      sense.on('face', (f) => {
        pushHist(h, 'smile', f.t, f.present ? f.smile : null)
        pushHist(h, 'cheek', f.t, f.present ? f.cheek : null)
      }),
      sense.on('head', (f) => {
        pushHist(h, 'pitch', f.t, f.pitch)
        pushHist(h, 'yaw', f.t, f.yaw)
      }),
      sense.on('pulse', (p) => {
        pushHist(h, 'wave', p.t, p.wave)
        pushHist(h, 'bpm', p.t, p.bpm)
        pushHist(h, 'quality', p.t, p.quality)
      }),
      sense.on('voice', (v) => {
        pushHist(h, 'rms', v.t, v.rms)
        pushHist(h, 'f0', v.t, v.voiced ? v.f0 : null)
      }),
      sense.on('caps', () => setTick((x) => x + 1)),
    ]
    // for headless tests and the Safari console
    ;(window as unknown as Record<string, unknown>).__vireLab = { sense, hist: h, lastResult }
    const iv = setInterval(() => setTick((x) => x + 1), 250)
    return () => {
      offs.forEach((off) => off())
      clearInterval(iv)
      runToken.current++
      sense.stop()
    }
  }, [sense])

  // sparklines
  useEffect(() => {
    let raf = 0
    const css = getComputedStyle(document.documentElement)
    const colors: Record<string, string> = {}
    for (const m of METERS) colors[m.key] = css.getPropertyValue(m.color).trim() || '#888'
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const now = performance.now()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      for (const m of METERS) {
        const c = canvases.current[m.key]
        if (!c) continue
        const w = Math.round(c.clientWidth * dpr)
        const hgt = Math.round(c.clientHeight * dpr)
        if (w === 0 || hgt === 0) continue
        if (c.width !== w || c.height !== hgt) {
          c.width = w
          c.height = hgt
        }
        const g = c.getContext('2d')
        if (!g) continue
        g.clearRect(0, 0, w, hgt)
        const s = histRef.current[m.key]
        const x = (t: number) => ((t - (now - WINDOW_MS)) / WINDOW_MS) * w
        const y = (v: number) => hgt - 2 * dpr - ((Math.min(m.max, Math.max(m.min, v)) - m.min) / (m.max - m.min)) * (hgt - 4 * dpr)
        g.strokeStyle = colors[m.key]
        g.fillStyle = colors[m.key]
        g.lineWidth = 1.5 * dpr
        g.lineJoin = 'round'
        let pen = false
        g.beginPath()
        for (let i = 0; i < s.t.length; i++) {
          if (s.t[i] < now - WINDOW_MS) continue
          const v = s.v[i]
          if (v === null || !Number.isFinite(v)) {
            pen = false
            continue
          }
          if (m.dots) {
            g.fillRect(x(s.t[i]) - dpr, y(v) - dpr, 2 * dpr, 2 * dpr)
          } else if (!pen) {
            g.moveTo(x(s.t[i]), y(v))
            pen = true
          } else g.lineTo(x(s.t[i]), y(v))
        }
        if (!m.dots) g.stroke()
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  const start = useCallback(async () => {
    if (!videoRef.current) return
    setError(null)
    setStatus('starting')
    try {
      await sense.start({ video: videoRef.current, audio: !/[?&]audio=0/.test(location.href) })
      setStatus('running')
    } catch (err) {
      setStatus('idle')
      setError((err as Error)?.message ?? String(err))
    }
  }, [sense])

  const stop = useCallback(() => {
    runToken.current++
    sense.stop()
    setStatus('idle')
    setRecording(false)
    setPhase(null)
  }, [sense])

  const begin = useCallback(() => {
    laughOnset.current = null
    sense.beginRecording()
    setRecording(true)
    setPhase(null)
    setResult('')
  }, [sense])

  const mark = useCallback(
    (key: PhaseKey, until: number | null = null) => {
      sense.mark(key)
      setRecording(true)
      setPhase({ key, until })
    },
    [sense],
  )

  const show = useCallback((r: { features: unknown; traces: unknown }, traces: boolean) => {
    setResult(JSON.stringify(traces ? r : r.features, null, 2))
  }, [])

  const end = useCallback(() => {
    runToken.current++
    const r = sense.endRecording({ laughOnsetT: laughOnset.current })
    lastResult.current = r
    setRecording(false)
    setPhase(null)
    show(r, withTraces)
  }, [sense, show, withTraces])

  const laughNow = useCallback(() => {
    laughOnset.current = performance.now()
    // real stimulus when the file exists; silence is fine
    try {
      const a = new Audio(new URL('audio/laugh-1.mp3', document.baseURI).toString())
      void a.play().catch(() => {})
    } catch {
      /* no audio */
    }
  }, [])

  const run = useCallback(
    async (plan: { key: PhaseKey; ms: number }[]) => {
      const token = ++runToken.current
      begin()
      for (const p of plan) {
        if (token !== runToken.current) return
        mark(p.key, performance.now() + p.ms)
        if (p.key === 'laugh') {
          setTimeout(() => {
            if (token === runToken.current) laughNow()
          }, 1000)
        }
        await new Promise((r) => setTimeout(r, p.ms))
      }
      if (token === runToken.current) end()
    },
    [begin, mark, end, laughNow],
  )

  const running = status === 'running'
  const latest = sense.latest()
  const dbg: SenseDebug = sense.debug()
  const caps = sense.caps
  const now = performance.now()
  const lastOf = (key: string): number | null => {
    const s = histRef.current[key]
    const i = s.t.length - 1
    return i >= 0 && now - s.t[i] < 3000 ? s.v[i] : null
  }
  const left = phase?.until ? Math.max(0, (phase.until - now) / 1000) : null

  return (
    <div className="lab">
      <style>{CSS}</style>
      <div className="lab-top">
        <h1>Sense lab</h1>
        {running ? (
          <button className="lab-btn" onClick={stop}>
            Stop
          </button>
        ) : (
          <button className="lab-btn primary" onClick={start} disabled={status === 'starting'} data-testid="start">
            {status === 'starting' ? 'Starting…' : 'Start'}
          </button>
        )}
      </div>

      {error && (
        <div className="lab-err" data-testid="error">
          {error}
        </div>
      )}

      <div className="lab-card">
        <div className="lab-row">
          <video ref={videoRef} className="lab-video" playsInline muted autoPlay />
          <div className="lab-big">
            <div>
              <span>frames / s (target 20+)</span>
              <b data-testid="fps" className={!running ? '' : dbg.fps >= 20 ? 'ok' : 'warn'}>
                {dbg.fps.toFixed(1)}
              </b>
            </div>
            <div>
              <span>ms per frame</span>
              <b>{dbg.frameMs.toFixed(1)}</b>
            </div>
            <div>
              <span>face</span>
              <b className={!running ? '' : latest.face?.present ? 'ok' : 'warn'}>{latest.face?.present ? 'yes' : 'no'}</b>
            </div>
            <div>
              <span>bpm · quality</span>
              <b>
                {num(0)(latest.pulse?.bpm ?? null)} · {num(2)(latest.pulse?.quality ?? null)}
              </b>
            </div>
          </div>
        </div>
        <div className="lab-row" style={{ marginTop: 10 }}>
          <dl className="lab-kv">
            <dt>frame time</dt>
            <dd>
              {dbg.frameMs.toFixed(1)} ms mean · {dbg.frameMsP95.toFixed(1)} ms p95
            </dd>
            <dt>model</dt>
            <dd>
              {dbg.delegate} · {dbg.videoW}×{dbg.videoH} · model {dbg.modelMs.toFixed(1)} ms · skin {dbg.skinMs.toFixed(1)} ms
            </dd>
            <dt>face</dt>
            <dd>
              {latest.face?.present ? 'yes' : 'no'} · jaw {num(2)(latest.face?.jawOpen ?? null)} · blink {num(2)(latest.face?.blink ?? null)} · brow {num(2)(latest.face?.brow ?? null)}
            </dd>
            <dt>head</dt>
            <dd>
              {latest.head?.source ?? '–'} · roll {num(1, '°')(latest.head?.roll ?? null)}
            </dd>
            <dt>pulse</dt>
            <dd>
              {latest.pulse?.source ?? '–'} · snr {num(1, ' dB')(dbg.pulseSnrDb)} · gate {dbg.pulseGate.toFixed(2)}
            </dd>
            <dt>voice</dt>
            <dd>
              {dbg.voiceMode} · {dbg.sampleRate ? `${dbg.sampleRate} Hz` : '–'} · {latest.voice?.voiced ? 'voiced' : 'quiet'}
            </dd>
            <dt>mic</dt>
            <dd data-testid="mic" title={dbg.micLabel}>
              {dbg.micLabel || '–'}
            </dd>
            <dt>camera</dt>
            <dd title={dbg.cameraLabel}>{dbg.cameraLabel || '–'}</dd>
          </dl>
        </div>
        <div className="lab-chips" data-testid="caps">
          {(['camera', 'mic', 'native', 'airpodsMotion', 'airpodsHr'] as const).map((k) => (
            <span key={k} className={`lab-chip${caps[k] ? ' yes' : ''}`}>
              {k}
            </span>
          ))}
        </div>
      </div>

      <div className="lab-card">
        {METERS.map((m) => (
          <div className="lab-meter" key={m.key}>
            <div className="lbl">
              <span>{m.label}</span>
              <b data-testid={`v-${m.key}`}>{m.fmt(lastOf(m.key))}</b>
            </div>
            <canvas
              ref={(el) => {
                canvases.current[m.key] = el
              }}
            />
          </div>
        ))}
        <div className="lab-small">Last {WINDOW_MS / 1000} s. Pulse quality under 0.3 means: do not trust the bpm.</div>
      </div>

      <div className="lab-card">
        <div className="lab-wrap">
          <button className="lab-btn primary" onClick={() => void run(PING_PHASES)} disabled={!running || recording}>
            Run full ping (58 s)
          </button>
          <button className="lab-btn" onClick={() => void run(MINI)} disabled={!running || recording}>
            Run mini (18 s)
          </button>
        </div>
        {phase && (
          <>
            <div className="lab-phase" data-testid="phase">
              {phase.key}
              {left !== null ? ` · ${left.toFixed(0)} s` : ''}
            </div>
            <div className="lab-sub">{HINT[phase.key]}</div>
          </>
        )}
        <div className="lab-small" style={{ margin: '12px 0 6px' }}>
          Or by hand:
        </div>
        <div className="lab-wrap">
          <button className={`lab-btn${recording && !phase ? ' on' : ''}`} onClick={begin} disabled={!running}>
            Begin
          </button>
          {PING_PHASES.map((p) => (
            <button key={p.key} className={`lab-btn${phase?.key === p.key ? ' on' : ''}`} onClick={() => mark(p.key)} disabled={!running}>
              {p.key}
            </button>
          ))}
          <button className="lab-btn" onClick={laughNow} disabled={!recording}>
            Laughter starts now
          </button>
          <button className="lab-btn primary" onClick={end} disabled={!recording} data-testid="end">
            End
          </button>
        </div>
        {result && (
          <>
            <div className="lab-wrap" style={{ marginTop: 12 }}>
              <button
                className="lab-btn"
                onClick={() => {
                  setWithTraces(!withTraces)
                  if (lastResult.current) show(lastResult.current, !withTraces)
                }}
              >
                {withTraces ? 'Hide traces' : 'Show traces'}
              </button>
              <button className="lab-btn" onClick={() => void navigator.clipboard?.writeText(result).catch(() => {})}>
                Copy
              </button>
            </div>
            <pre data-testid="features">{result}</pre>
          </>
        )}
      </div>
    </div>
  )
}
