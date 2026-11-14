// ?debug=1: message rates and timing, in a corner of the stage.
import { useEffect, useState } from 'react'
import { loopStats } from './loop'
import type { Stage, View } from './store'

export function Debug({ stage, view }: { stage: Stage; view: View }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 500)
    return () => clearInterval(id)
  }, [])
  const now = performance.now()
  const r = stage.rates
  const age = (t: number) => (t ? `${((now - t) / 1000).toFixed(1)} s ago` : 'never')
  const rows: [string, string][] = [
    ['socket', view.conn],
    ['mode', `${view.mode} / ${view.phase}${view.cold ? ' (joined mid-ping)' : ''}`],
    ['frames', `${(r.frame ?? 0).toFixed(1)} /s, every ${stage.frameMs.toFixed(0)} ms, last ${age(stage.lastFrameAt)}`],
    ['mesh', `${(r.mesh ?? 0).toFixed(1)} /s, every ${stage.meshMs.toFixed(0)} ms, last ${age(stage.lastMeshAt)}`],
    ['other', `phase ${(r.phase ?? 0).toFixed(1)}  tune ${(r.tune ?? 0).toFixed(1)}  echo ${(r.echo ?? 0).toFixed(1)}  hello ${(r.hello ?? 0).toFixed(1)} /s`],
    ['wire', `${(stage.bytes / 1024).toFixed(1)} kB/s, ${stage.frames.length} samples kept`],
    ['fields', `${view.ownMesh ? 'mesh' : 'no mesh'}, ${view.ownMuscles ? 'muscles' : 'no muscles'}, ${view.hasEar ? 'earSmile' : 'no earSmile'}, head ${view.headSource ?? '?'}, heart ${view.heartSource ?? '?'}`],
    ['paint', `${loopStats.fps.toFixed(0)} fps, worst frame ${loopStats.worst.toFixed(0)} ms, ${loopStats.cost.toFixed(1)} ms of painting a frame`],
  ]
  return (
    <dl className="sg-debug">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}
