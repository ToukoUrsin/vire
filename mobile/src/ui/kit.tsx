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
export function Screen({ nav, backTo, right, flow, children, className = '' }: { nav?: string; backTo?: string; right?: ReactNode; flow?: boolean; children: ReactNode; className?: string }) {
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

export function Btn({ children, kind = 'primary', wide, small, onClick, to, disabled, icon }: { children: ReactNode; kind?: 'primary' | 'quiet' | 'ghost'; wide?: boolean; small?: boolean; onClick?: () => void; to?: string; disabled?: boolean; icon?: IconName }) {
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
