import { useMemo, type ReactNode } from 'react'
import { renderSVG } from 'uqr'
import { Stack, go, useLoc, type RouteMeta } from './router'
import { I, type IconName } from './ui/icons'
import { Today } from './screens/Today'
import { Loop } from './screens/Loop'
import { Signals, Calls, Music, Sleep, Movement } from './screens/Signals'
import { Practices, Programme } from './screens/Practices'
import { Practice } from './screens/Practice'
import { Care, CheckIn, Clinic } from './screens/Care'
import { You, Paper } from './screens/You'
import { Train } from './screens/Train'
import { Live } from './screens/Live'
import { Research } from './screens/Research'

const TABS: Array<{ id: string; path: string; label: string; icon: IconName }> = [
  { id: 'today', path: '/today', label: 'Today', icon: 'today' },
  { id: 'signals', path: '/signals', label: 'Signals', icon: 'signals' },
  { id: 'practices', path: '/practices', label: 'Practices', icon: 'practices' },
  { id: 'care', path: '/care', label: 'Care', icon: 'care' },
  { id: 'you', path: '/you', label: 'You', icon: 'you' },
]

interface Route extends RouteMeta {
  /** hides the tab bar without rising like a flow */
  bare?: boolean
  el: (arg: string) => ReactNode
}
const ROUTES: Array<[RegExp, Route]> = [
  [/^\/today$/, { tab: 'today', root: true, el: () => <Today /> }],
  [/^\/loop$/, { tab: 'today', el: () => <Loop /> }],
  [/^\/signals$/, { tab: 'signals', root: true, el: () => <Signals /> }],
  [/^\/signals\/calls$/, { tab: 'signals', el: () => <Calls /> }],
  [/^\/signals\/music$/, { tab: 'signals', el: () => <Music /> }],
  [/^\/signals\/sleep$/, { tab: 'signals', el: () => <Sleep /> }],
  [/^\/signals\/movement$/, { tab: 'signals', el: () => <Movement /> }],
  [/^\/practices$/, { tab: 'practices', root: true, el: () => <Practices /> }],
  [/^\/programme$/, { tab: 'practices', el: () => <Programme /> }],
  [/^\/practice\/([a-z]+)$/, { tab: 'practices', flow: true, el: (id) => <Practice id={id} /> }],
  [/^\/care$/, { tab: 'care', root: true, el: () => <Care /> }],
  [/^\/care\/checkin$/, { tab: 'care', flow: true, el: () => <CheckIn /> }],
  [/^\/care\/clinic$/, { tab: 'care', el: () => <Clinic /> }],
  [/^\/you$/, { tab: 'you', root: true, el: () => <You /> }],
  [/^\/paper$/, { tab: 'you', el: () => <Paper /> }],
  [/^\/train$/, { tab: 'you', flow: true, el: () => <Train /> }],
  [/^\/live$/, { tab: 'you', bare: true, el: () => <Live /> }],
  [/^\/research(?:\/([a-z]+))?$/, { tab: 'you', el: (t) => <Research topic={t} /> }],
]
function find(path: string): { route: Route; arg: string } {
  for (const [re, route] of ROUTES) {
    const m = re.exec(path)
    if (m) return { route, arg: m[1] ?? '' }
  }
  return { route: ROUTES[0][1], arg: '' }
}
const meta = (path: string): RouteMeta => find(path).route
const render = (path: string): ReactNode => {
  const { route, arg } = find(path)
  return route.el(arg)
}

function TabBar() {
  const loc = useLoc()
  const { route } = find(loc.path)
  return (
    <nav className={`tabbar ${route.flow || route.bare ? 'is-hidden' : ''}`} aria-label="Vire">
      {TABS.map((t) => {
        const C = I[t.icon]
        const here = route.tab === t.id
        return (
          <button key={t.id} className="tab" aria-current={here ? 'page' : undefined} onClick={() => go(t.path, here ? { move: 'pop', replace: true } : {})}>
            <C size={25} strokeWidth={here ? 1.9 : 1.6} />
            {t.label}
          </button>
        )
      })}
    </nav>
  )
}

function Aside() {
  const url = `${location.origin}/app/`
  const qr = useMemo(() => renderSVG(url, { border: 2, blackColor: '#14110d', whiteColor: '#f3ece0' }), [url])
  return (
    <>
      <div className="aside aside-left">
        <p className="aside-mark">Vire</p>
        <p className="aside-line">Your AirPods sense your day. A practice in your ears when you drift. Your clinic in the loop.</p>
        <p className="small" style={{ marginTop: 18 }}>
          For people at home after TMS, a clinic treatment for depression. Built at Junction 2026.
        </p>
      </div>
      <div className="aside">
        <div className="aside-qr" dangerouslySetInnerHTML={{ __html: qr }} />
        <p className="aside-how">Open it on your phone</p>
        <p className="small" style={{ marginTop: 6 }}>
          Scan, then Share and Add to Home Screen. It opens like an app.
        </p>
        <p className="small num" style={{ marginTop: 12, color: 'var(--ink-2)' }}>
          {url.replace(/^https?:\/\//, '')}
        </p>
      </div>
    </>
  )
}

export function App() {
  return (
    <div className="frame">
      <Aside />
      <main className="phone">
        <Stack render={render} meta={meta} />
        <TabBar />
        <div id="overlay" />
      </main>
    </div>
  )
}
