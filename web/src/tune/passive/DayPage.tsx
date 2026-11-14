// /#/day: the "Today, from your AirPods" card on its own, live, for checking it. Connect the AirPods as on
// /#/ears (inside the iPhone app they come by themselves; on a Mac through Vire Ears) and keep the page open.
import { useCallback, useEffect, useState } from 'react'
import { createSense } from '../../sense'
import { connectEars, onEars, onNative, postNative } from '../../sense/native'
import type { EarsInfo } from '../../sense/native'
import type { Sense } from '../../sense/types'
import { loadEarModel } from '../ear'
import DayCard from './DayCard'
import { usePassive } from './usePassive'
import '../ears-lab.css'

let daySense: Sense | null = null
const inApp = () => !!(window as unknown as { webkit?: { messageHandlers?: { vire?: unknown } } }).webkit?.messageHandlers?.vire

export default function DayPage() {
  if (!daySense) daySense = createSense()
  const sense = daySense
  const [model] = useState(() => loadEarModel())
  const [info, setInfo] = useState<EarsInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const state = usePassive(sense, model)

  useEffect(() => onEars(setInfo), [])
  // a browser that used the Mac helper before is connected again by itself: ask it for the AirPods then too
  useEffect(() => {
    if (!inApp() && info?.state === 'on') postNative({ cmd: 'start' })
  }, [info?.state])
  // inside the iPhone app there is nothing to connect to: ask for the AirPods at once
  useEffect(() => {
    if (!inApp()) return
    const off = onNative(() => {})
    postNative({ cmd: 'start' })
    return off
  }, [])

  const connect = useCallback(async () => {
    setError(null)
    if (inApp()) return postNative({ cmd: 'start' })
    const ok = await connectEars()
    if (!ok) setError('Vire Ears did not answer on this Mac.')
  }, [])

  const linked = inApp() || info?.state === 'on'
  return (
    <main className="el" data-page="day">
      <header className="el-top">
        <span className="el-mark">Vire</span>
        <span className="el-where">Today, from your AirPods</span>
      </header>
      {!linked && (
        <p>
          <button type="button" className="lab-btn primary" onClick={() => void connect()}>
            Connect AirPods
          </button>
        </p>
      )}
      {error && <p className="el-err">{error}</p>}
      <DayCard state={state} />
    </main>
  )
}
