// The pieces every screen is built from. Class names live in app.css.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { back, go, useScrollMemory } from '../router'
import { REFS, TOPICS, type Ref, type Topic } from '../data/refs'
import { I, type IconName } from './icons'

export type Tone = 'face' | 'voice' | 'move' | 'heart' | 'ember' | 'plain'
const rise = (i?: number): CSSProperties | undefined => (i == null ? undefined : ({ '--i': i } as CSSProperties))

/**
 * One screen. With `nav` it is a pushed screen: a bar with back and a title that appears once the big title has
 * scrolled away. Without it, it is a tab root. `flow` screens cover the tab bar.
 */
export function Screen({ nav, backTo, right, flow, children, className = '', glow }: { nav?: string; backTo?: string; right?: ReactNode; flow?: boolean; children: ReactNode; className?: string; glow?: Tone }) {
  const ref = useRef<HTMLDivElement>(null)
  const [solid, setSolid] = useState(false)
  useScrollMemory(ref)
  useEffect(() => {
    const el = ref.current
    if (!el || nav == null) return
    const on = () => setSolid(el.scrollTop > 44)
    on()
    el.addEventListener('scroll', on, { passive: true })
    return () => el.removeEventListener('scroll', on)
  }, [nav])
  return (
    <>
      {nav != null && (
        <header className={`navbar ${solid ? 'is-solid' : ''}`}>
          <button className="navbar-back" onClick={() => back(backTo)} aria-label="Back">
            {flow ? <I.close size={22} /> : <I.left size={22} />}
            {!flow && <span>Back</span>}
          </button>
          <div className="navbar-title">{nav}</div>
          <div className="navbar-right">{right}</div>
        </header>
      )}
      <div ref={ref} className={`screen ${nav != null ? 'has-nav' : ''} ${flow ? 'no-tabs' : ''} ${className}`}>
        {glow && <div className={`glow ${glow === 'ember' ? '' : `is-${glow}`}`} aria-hidden="true" />}
        {children}
      </div>
    </>
  )
}

export function Section({ title, more, to, children, i, flush }: { title?: string; more?: string; to?: string; children: ReactNode; i?: number; flush?: boolean }) {
  return (
    <section className="section rise" style={rise(i)}>
      {title && (
        <div className="section-head">
          <h2 className="title-m">{title}</h2>
          {more && to && (
            <button className="section-more" onClick={() => go(to)}>
              {more}
            </button>
          )}
        </div>
      )}
      <div className={flush ? '' : 'pad'}>{children}</div>
    </section>
  )
}

export function Badge({ icon, tone = 'plain', size = 38 }: { icon: IconName; tone?: Tone; size?: number }) {
  const C = I[icon]
  return (
    <span className={`badge ${tone === 'plain' ? '' : `is-${tone}`}`} style={{ width: size, height: size }}>
      <C size={Math.round(size * 0.55)} />
    </span>
  )
}

export function Row({ icon, tone, title, sub, right, to, onClick, chevron = true, lead }: { icon?: IconName; tone?: Tone; title: ReactNode; sub?: ReactNode; right?: ReactNode; to?: string; onClick?: () => void; chevron?: boolean; lead?: ReactNode }) {
  const act = to ? () => go(to) : onClick
  const body = (
    <>
      {lead ?? (icon ? <Badge icon={icon} tone={tone} /> : <span />)}
      <span>
        <span className="row-title" style={{ display: 'block' }}>
          {title}
        </span>
        {sub && (
          <span className="row-sub" style={{ display: 'block' }}>
            {sub}
          </span>
        )}
      </span>
      <span className="row-right">
        {right}
        {act && chevron && <I.right size={18} />}
      </span>
    </>
  )
  return act ? (
    <button className="row" onClick={act}>
      {body}
    </button>
  ) : (
    <div className="row">{body}</div>
  )
}

export function Chip({ children, tone, dot, pulse }: { children: ReactNode; tone?: 'live' | 'ember'; dot?: boolean; pulse?: boolean }) {
  return (
    <span className={`chip ${tone ? `is-${tone}` : ''}`}>
      {dot && <span className={`dot ${pulse ? 'is-pulse' : ''}`} />}
      {children}
    </span>
  )
}

export function Btn({ children, kind = 'primary', wide, small, onClick, to, disabled, icon }: { children: ReactNode; kind?: 'primary' | 'ember' | 'quiet' | 'ghost'; wide?: boolean; small?: boolean; onClick?: () => void; to?: string; disabled?: boolean; icon?: IconName }) {
  const C = icon ? I[icon] : null
  return (
    <button className={`btn btn-${kind} ${wide ? 'btn-wide' : ''} ${small ? 'btn-s' : ''}`} onClick={to ? () => go(to) : onClick} disabled={disabled}>
      {C && <C size={small ? 17 : 19} />}
      {children}
    </button>
  )
}

export function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: Array<{ id: T; label: string }> }) {
  return (
    <div className="seg" role="group">
      {options.map((o) => (
        <button key={o.id} aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** a sheet from the bottom, drawn over the whole phone */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  const host = typeof document === 'undefined' ? null : document.getElementById('overlay')
  if (!open || !host) return null
  return createPortal(
    <>
      <div className="sheet-scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        {title && (
          <h2 className="title-m" style={{ marginBottom: 12 }}>
            {title}
          </h2>
        )}
        {children}
        <div style={{ marginTop: 22 }}>
          <Btn kind="quiet" wide onClick={onClose}>
            Close
          </Btn>
        </div>
      </div>
    </>,
    host,
  )
}

const KIND: Record<string, string> = { 'meta-analysis': 'Meta-analysis', review: 'Review', rct: 'Trial', cohort: 'Cohort', lab: 'Lab study', 'cross-sectional': 'One-time study', dataset: 'Dataset', docs: 'Maker' }

export function Evidence({ r }: { r: Ref }) {
  return (
    <div className="evidence">
      <p className="evidence-find">{r.finding}</p>
      <p className="evidence-src">
        <span className="evidence-kind">{KIND[r.strength] ?? r.strength}</span>
        <a href={r.url} target="_blank" rel="noreferrer">
          {r.authors} {r.year}
        </a>
        , <i>{r.journal}</i>
        {r.sample ? `. ${r.sample}` : ''}
      </p>
      {r.limit && <p className="evidence-limit">Limit: {r.limit}</p>}
    </div>
  )
}

/** the two lead studies of a topic, the honest sentence about them, and the way to the rest */
export function Research({ topic, i, title = 'What the research says' }: { topic: Topic; i?: number; title?: string }) {
  const t = TOPICS[topic]
  return (
    <Section title={title} i={i}>
      <div className="card">
        {t.lead.map((id) => (REFS[id] ? <Evidence key={id} r={REFS[id]} /> : null))}
        <p className="small" style={{ marginTop: 4, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
          {t.honest}
        </p>
      </div>
      <div style={{ marginTop: 10 }}>
        <Btn kind="ghost" small to={`/research/${topic}`}>
          All {t.count} studies on this <I.right size={16} />
        </Btn>
      </div>
    </Section>
  )
}

export function SampleNote({ children }: { children: ReactNode }) {
  return (
    <div className="sample-note">
      <I.info size={16} />
      <span>{children}</span>
    </div>
  )
}

/** the big title block at the top of a screen */
export function Head({ title, sub, chip, i = 0 }: { title: ReactNode; sub?: ReactNode; chip?: ReactNode; i?: number }) {
  return (
    <div className="pad rise" style={rise(i)}>
      {chip && <div style={{ marginBottom: 14 }}>{chip}</div>}
      <h1 className="title-xl">{title}</h1>
      {sub && (
        <p className="lede" style={{ marginTop: 10 }}>
          {sub}
        </p>
      )}
    </div>
  )
}

/** where the heavy work runs, named on every screen that shows a model being made */
export function RunsOn({ what = 'one locked Sandbox per person', bare }: { what?: string; bare?: boolean }) {
  return (
    <div className="runs-on">
      {!bare && <I.box size={16} />}
      <span>
        <b>Runs on Modal</b> · {what}
      </span>
    </div>
  )
}

/** one reading, said large. In a `.stat-grid` two sit side by side; `wide` takes the whole row. */
export function Stat({ icon, tone = 'plain', label, value, unit, sub, to, onClick, wide, children }: { icon?: IconName; tone?: Tone; label: ReactNode; value: ReactNode; unit?: ReactNode; sub?: ReactNode; to?: string; onClick?: () => void; wide?: boolean; children?: ReactNode }) {
  const act = to ? () => go(to) : onClick
  const body = (
    <>
      <span className="stat-top">
        {icon && <Badge icon={icon} tone={tone} size={26} />}
        {label}
      </span>
      {children && <span className="stat-chart">{children}</span>}
      <span className="stat-v">
        {value}
        {unit && <small>{unit}</small>}
      </span>
      {sub && <span className="stat-sub">{sub}</span>}
    </>
  )
  return act ? (
    <button className={`stat ${wide ? 'stat-wide' : ''}`} onClick={act}>
      {body}
    </button>
  ) : (
    <div className={`stat ${wide ? 'stat-wide' : ''}`}>{body}</div>
  )
}

/** a small pill that says how a reading sits against your own usual */
export function Delta({ children, tone }: { children: ReactNode; tone?: 'off' | 'ok' }) {
  return <span className={`delta ${tone ? `is-${tone}` : ''}`}>{children}</span>
}

// ---------- cover art ----------
export type ArtKind = 'breath' | 'body' | 'sit' | 'stretch' | 'walk' | 'sleep' | 'call' | 'music'
const COVER: Record<ArtKind, { a: string; b: string }> = {
  breath: { a: '#e4f4ef', b: '#bfe3db' },
  body: { a: '#eeecfc', b: '#cfcbf4' },
  sit: { a: '#fdeedd', b: '#f8cfa8' },
  stretch: { a: '#fdeaf0', b: '#f5c6d6' },
  walk: { a: '#eaf5e6', b: '#c3e2cb' },
  sleep: { a: '#e3e8fb', b: '#bcc7f0' },
  call: { a: '#e2f3ef', b: '#c2e2e4' },
  music: { a: '#fdf1d6', b: '#f6d89c' },
}
function Cover({ kind }: { kind: ArtKind }) {
  const id = `art-${kind}`
  const c = COVER[kind]
  return (
    <svg viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={c.a} />
          <stop offset="1" stopColor={c.b} />
        </linearGradient>
        <radialGradient id={`${id}-orb`} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#fff" stopOpacity="0.95" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.35" />
        </radialGradient>
      </defs>
      <rect width="320" height="200" fill={`url(#${id}-bg)`} />
      {kind === 'breath' && (
        <g>
          {[118, 96, 74, 52].map((r, i) => (
            <circle key={r} cx="236" cy="78" r={r} fill="#1f9486" fillOpacity={0.06 + i * 0.05} />
          ))}
          <circle cx="236" cy="78" r="30" fill="#ffffff" fillOpacity="0.96" />
          <circle cx="236" cy="78" r="30" fill={`url(#${id}-orb)`} fillOpacity="0.6" />
        </g>
      )}
      {kind === 'body' && (
        <g>
          <path d="M0 96 C60 70 110 118 170 92 S270 70 320 98 V200 H0Z" fill="#6c63d9" fillOpacity="0.14" />
          <path d="M0 124 C70 98 120 146 190 120 S280 100 320 126 V200 H0Z" fill="#6c63d9" fillOpacity="0.2" />
          <path d="M0 152 C60 132 130 172 200 150 S290 136 320 156 V200 H0Z" fill="#6c63d9" fillOpacity="0.28" />
          <circle cx="238" cy="56" r="20" fill="#ffffff" fillOpacity="0.96" />
          <circle cx="238" cy="56" r="38" fill="#ffffff" fillOpacity="0.4" />
        </g>
      )}
      {kind === 'sit' && (
        <g>
          <circle cx="232" cy="104" r="86" fill="#f08a4b" fillOpacity="0.12" />
          <circle cx="232" cy="104" r="62" fill="#f08a4b" fillOpacity="0.18" />
          <circle cx="232" cy="104" r="40" fill="#f6a05a" />
          <rect y="118" width="320" height="82" fill="#f9dcc0" fillOpacity="0.94" />
          <rect x="176" y="130" width="112" height="3" rx="1.5" fill="#ee8f4c" fillOpacity="0.7" />
          <rect x="196" y="144" width="72" height="3" rx="1.5" fill="#ee8f4c" fillOpacity="0.45" />
          <rect x="212" y="158" width="40" height="3" rx="1.5" fill="#ee8f4c" fillOpacity="0.28" />
        </g>
      )}
      {kind === 'stretch' && (
        <g fill="none" strokeLinecap="round">
          <path d="M150 220 A150 150 0 0 1 300 70" stroke="#d45c8a" strokeOpacity="0.62" strokeWidth="14" />
          <path d="M182 220 A118 118 0 0 1 300 102" stroke="#d45c8a" strokeOpacity="0.4" strokeWidth="14" />
          <path d="M214 220 A86 86 0 0 1 300 134" stroke="#d45c8a" strokeOpacity="0.24" strokeWidth="14" />
          <path d="M246 220 A54 54 0 0 1 300 166" stroke="#d45c8a" strokeOpacity="0.13" strokeWidth="14" />
        </g>
      )}
      {kind === 'walk' && (
        <g>
          <circle cx="250" cy="52" r="20" fill="#f7c85a" fillOpacity="0.95" />
          <path d="M0 130 C50 96 96 96 150 124 S250 150 320 104 V200 H0Z" fill="#3f9d6c" fillOpacity="0.26" />
          <path d="M0 158 C70 126 130 140 190 156 S280 164 320 140 V200 H0Z" fill="#3f9d6c" fillOpacity="0.42" />
          <path d="M118 200 C150 176 132 160 176 150 S232 138 252 122" fill="none" stroke="#ffffff" strokeOpacity="0.95" strokeWidth="3" strokeLinecap="round" strokeDasharray="1 9" />
        </g>
      )}
      {kind === 'sleep' && (
        <g>
          <circle cx="238" cy="70" r="58" fill="#ffffff" fillOpacity="0.32" />
          <circle cx="238" cy="70" r="30" fill="#fff3c9" />
          <circle cx="252" cy="60" r="27" fill="#d6ddf7" />
          {[
            [60, 44, 1.6],
            [112, 78, 1.1],
            [164, 36, 1.4],
            [92, 128, 1.2],
            [176, 108, 1.7],
            [286, 132, 1.2],
            [36, 96, 1],
          ].map(([x, y, r]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill="#ffffff" fillOpacity="0.95" />
          ))}
        </g>
      )}
      {kind === 'call' && (
        <g>
          {[14, 26, 44, 30, 56, 38, 20, 48, 64, 34, 22, 40, 28, 16].map((h, i) => (
            <rect key={i} x={126 + i * 13} y={72 - h / 2} width="6" height={h} rx="3" fill="#0f7f74" fillOpacity={0.8 - (i % 3) * 0.16} />
          ))}
          {[10, 18, 12, 30, 22, 44, 26, 14, 36, 20, 12, 24, 16, 10].map((h, i) => (
            <rect key={i} x={126 + i * 13} y={132 - h / 2} width="6" height={h} rx="3" fill="#ffffff" fillOpacity={0.95 - (i % 3) * 0.12} />
          ))}
        </g>
      )}
      {kind === 'music' && (
        <g>
          <circle cx="240" cy="92" r="70" fill="#e9a23b" fillOpacity="0.14" />
          <circle cx="240" cy="92" r="52" fill="#e9a23b" fillOpacity="0.22" />
          <circle cx="240" cy="92" r="34" fill="#eeaa45" fillOpacity="0.95" />
          <circle cx="240" cy="92" r="9" fill="#fff6e2" />
          {[34, 58, 44, 76, 52, 30].map((h, i) => (
            <rect key={i} x={30 + i * 17} y={170 - h} width="9" height={h} rx="4.5" fill="#d08a1e" fillOpacity={0.3 + (i % 2) * 0.22} />
          ))}
        </g>
      )}
    </svg>
  )
}

/** a drawn cover with words on it: a practice, a kind of signal. Height in px; it fills its width. */
export function Art({ kind, title, sub, tag, h = 168, to, onClick, children, className = '' }: { kind: ArtKind; title?: ReactNode; sub?: ReactNode; tag?: ReactNode; h?: number; to?: string; onClick?: () => void; children?: ReactNode; className?: string }) {
  const act = to ? () => go(to) : onClick
  const body = (
    <>
      <Cover kind={kind} />
      {tag && <span className="art-tag">{tag}</span>}
      <span className="art-body">
        {children}
        {title && <span className="art-title">{title}</span>}
        {sub && <span className="art-sub">{sub}</span>}
      </span>
    </>
  )
  return act ? (
    <button className={`art ${className}`} style={{ height: h }} onClick={act}>
      {body}
    </button>
  ) : (
    <div className={`art ${className}`} style={{ height: h }}>
      {body}
    </div>
  )
}
