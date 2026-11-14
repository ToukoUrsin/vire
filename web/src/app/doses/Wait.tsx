// Just wait: one quiet minute. Nothing is asked and nothing is measured, so the other doses have a fair comparison.
import { useRef, useState } from 'react'
import { DOSE_SECONDS, DoseShell, DoseWords, createTimers, endHoldMs, leftOf, patched, useRun } from './shared'
import type { DoseProps } from './shared'

const TOTAL_MS = DOSE_SECONDS * 1000

interface View {
  /** 0..1 of the minute gone */
  gone: number
  left: string
  end: string | null
}

export default function Wait({ onFinish, onLeave }: DoseProps) {
  const [view, setView] = useState<View>({ gone: 0, left: leftOf(TOTAL_MS, 0), end: null })
  const done = useRef(() => {})

  useRun(() => {
    const timers = createTimers()
    const t0 = performance.now()
    let ended = false

    const end = () => {
      if (ended) return
      ended = true
      const waited = Math.min(DOSE_SECONDS, Math.round((performance.now() - t0) / 1000))
      const line = waited >= DOSE_SECONDS ? 'One quiet minute. Nothing was measured.' : `${waited} quiet seconds. Nothing was measured.`
      setView((v) => patched(v, { end: line }))
      timers.after(endHoldMs(line), () => onFinish({ quietSeconds: waited }, line))
    }
    done.current = end

    timers.every(250, () => {
      if (ended) return
      const ms = performance.now() - t0
      // the line moves once a second: slow enough to be looked away from
      setView((v) => patched(v, { gone: Math.min(1, Math.floor(ms / 1000) / DOSE_SECONDS), left: leftOf(TOTAL_MS, ms) }))
      if (ms >= TOTAL_MS) end()
    })
    return () => {
      ended = true
      timers.stop()
    }
  })

  const ended = view.end != null
  return (
    <DoseShell title="Just wait" count={view.left} ended={ended} onDone={() => done.current()} onLeave={onLeave}>
      <div className="va-wait">
        <div className="va-wait-line" aria-hidden="true">
          <i style={{ transform: `scaleX(${view.gone})` }} />
        </div>
      </div>
      <DoseWords line={view.end ?? 'Nothing to do.'} sub="Let the minute pass." end={ended} />
    </DoseShell>
  )
}
