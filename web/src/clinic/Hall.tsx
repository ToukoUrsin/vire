import { useEffect, useState } from 'react'
import type { HallToday } from '@shared/types'
import { apiUrl } from '../shared/api'
import { Qr } from '../wall/Qr'
import './hall.css'

const fmtTime = (at: string) => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(at))
const fmt = (v: number | null) => v == null ? 'not read' : Number.isInteger(v) ? String(v) : v.toFixed(1)

export default function Hall() {
  const [state, setState] = useState<HallToday | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let live = true
    const load = () => fetch(apiUrl('hall/today'), { cache: 'no-store' }).then((r) => r.ok ? r.json() as Promise<HallToday> : Promise.reject()).then((x) => { if (live) { setState(x); setError(false) } }).catch(() => { if (live) setError(true) })
    void load()
    const t = window.setInterval(load, 4000)
    return () => { live = false; clearInterval(t) }
  }, [])
  if (!state) return <main className="cl-page va-hall"><p>{error ? 'The hall feed is not available yet.' : 'Loading Hall today…'}</p></main>
  return (
    <main className="cl-page va-hall">
      <header className="va-hall-head">
        <div><h1>Hall today</h1><p>{state.count} {state.count === 1 ? 'person' : 'people'} tried Vire on their own faces today. Here is what the clinic saw.</p></div>
        <a className="va-hall-download" href={apiUrl('hall/today.jsonl')}>Download JSON lines</a>
      </header>
      {!state.count ? <section className="va-hall-empty"><div><h2>Waiting for the first guest</h2><p>Scan the QR at table A157. The first row will appear here when someone finishes.</p><a href="#/visit">Open the guest flow</a></div><Qr text={new URL('#/visit', document.baseURI).toString()} /></section> : <>
        <section className="va-hall-channels" aria-label="Hall channel summaries">
          {state.channels.map((c) => <article key={c.channel}><header><b>{c.channel}</b><span>{c.read} of {c.total} read</span></header><strong>{c.median == null ? 'not read' : fmt(c.median)} <small>{c.unit}</small></strong><p>{c.min == null ? 'No readings yet' : `${fmt(c.min)} to ${fmt(c.max)} ${c.unit}`}</p><div className="va-hall-dots">{state.people.map((p) => <i key={p.guest} data-read={p.readings[c.channel].readable} />)}</div></article>)}
        </section>
        <p className="va-hall-note">One reading per person says nothing about how anyone is. It shows that the measurement works on strangers’ phones in a loud hall, and how often each sensor reads.</p>
        <section className="va-hall-people"><h2>People</h2>{state.people.map((p) => <article key={p.guest}><header><b>Guest {p.guest}</b><span>{fmtTime(p.at)} · {p.family}</span><span>{p.tune ? 'face learned' : 'general ranges'}</span></header><div>{state.channels.map((c) => <span key={c.channel}><b>{c.channel}</b> {p.readings[c.channel].readable ? `${fmt(p.readings[c.channel].value)} ${p.readings[c.channel].unit}` : `not read · ${p.readings[c.channel].reason ?? 'sensor unavailable'}`}</span>)}</div></article>)}</section>
      </>}
    </main>
  )
}
