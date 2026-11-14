import { Component, lazy, Suspense } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A page's code is fetched when it is first opened. On hall Wi-Fi that request drops: ask three times before giving up. */
function page<T extends ComponentType>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    let last: unknown
    for (const ms of [0, 600, 1800]) {
      if (ms) await wait(ms)
      try {
        return await load()
      } catch (e) {
        last = e
      }
    }
    throw last
  })
}

// Three areas, each owned by one folder. Keep this file a thin router.
const PatientApp = page(() => import('./app/PatientApp'))
const Clinic = page(() => import('./clinic/Clinic'))
const Lab = page(() => import('./sense/Lab'))
const Wall = page(() => import('./wall/Wall'))
const Science = page(() => import('./science/Science'))
const TuneLab = page(() => import('./tune/TuneLab'))
const EarsLab = page(() => import('./tune/EarsLab'))
const DayPage = page(() => import('./tune/passive/DayPage'))
const TodayLoop = page(() => import('./tune/session/Today'))
const Eeg = page(() => import('./tune/eeg/Eeg'))
const Home = page(() => import('./home/Home'))
const Watch = page(() => import('./tune/replay/Watch'))

/** A page that could not be fetched or that threw says so and offers the one thing that helps, never a blank screen. */
class Guard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="app-failed" role="alert">
        <h1>This page didn&rsquo;t load.</h1>
        <p>The connection dropped on the way. Nothing you did is lost.</p>
        <button type="button" className="lab-btn primary" onClick={() => location.reload()}>
          Try again
        </button>
      </main>
    )
  }
}

export default function App() {
  return (
    <HashRouter>
      <Guard>
        <Suspense fallback={<AppLoading />}>
          <Routes>
            <Route path="/clinic/*" element={<Clinic />} />
            <Route path="/lab" element={<Lab />} />
            <Route path="/wall/*" element={<Wall />} />
            <Route path="/science" element={<Science />} />
            <Route path="/tune" element={<TuneLab />} />
            <Route path="/ears" element={<EarsLab />} />
            <Route path="/day" element={<DayPage />} />
            <Route path="/today" element={<TodayLoop />} />
            <Route path="/eeg" element={<Eeg />} />
            <Route path="/watch" element={<Watch />} />
            <Route path="/" element={<Home />} />
            <Route path="/*" element={<PatientApp />} />
          </Routes>
        </Suspense>
      </Guard>
    </HashRouter>
  )
}

function AppLoading() {
  return (
    <main className="app-loading" role="status" aria-live="polite">
      <span className="app-loading-mark">Vire</span>
      <span className="app-loading-line" aria-hidden="true" />
      <p>Loading this page…</p>
    </main>
  )
}
