// The hero: the face as a wireframe (TUNE's MuscleMap), and the eight muscle groups as live bars beside it.
import { useCallback, useEffect, useRef } from 'react'
import type { TuneFace } from '@shared/types'
import { MuscleMap } from '../../tune'
import { onFrame } from './loop'
import type { Stage } from './store'

/** MUSCLES order, in plain words */
export const MUSCLE_WORDS = ['Smile', 'Cheeks', 'Brows down', 'Brows up', 'Lip corners down', 'Jaw', 'Eyelids', 'Nose']
export const FACE_WORDS: Record<TuneFace, string> = { rest: 'Resting', smile: 'Smile', sad: 'Corners down', angry: 'Brows down', surprised: 'Brows up' }

export function Face({ stage }: { stage: Stage }) {
  // polled by MuscleMap every animation frame: the person's own mesh between its last two frames, else the
  // standard face moved by the numbers that did arrive, else (nobody here) MuscleMap's own resting face
  const live = useCallback(() => {
    const now = performance.now()
    const own = stage.ownMesh(now)
    if (own) return { mesh: own, muscles: stage.sm.mus }
    const t = stage.tune
    const asked = t.step !== null && t.step !== 'training' && t.step !== 'done' && now - t.at < 30000
    if (now - stage.lastFrameAt < 2500 || asked) return { mesh: stage.posedMesh(), muscles: stage.sm.mus }
    return { mesh: null, muscles: stage.sm.mus }
  }, [stage])
  return <MuscleMap mesh={null} muscles={null} scale={1000} live={live} className="sg-map" />
}

export function Bars({ stage, own, whose, read }: { stage: Stage; own: boolean; whose: string; read: TuneFace | null }) {
  const fills = useRef<(HTMLElement | null)[]>([])
  const vals = useRef<(HTMLElement | null)[]>([])
  useEffect(() => {
    let lastText = 0
    return onFrame((now) => {
      const m = stage.sm.mus
      for (let i = 0; i < 8; i++) {
        const el = fills.current[i]
        if (el) el.style.transform = `scaleX(${Math.min(1, Math.max(0, m[i])).toFixed(3)})`
      }
      if (now - lastText < 110) return
      lastText = now
      for (let i = 0; i < 8; i++) {
        const el = vals.current[i]
        if (!el) continue
        const v = String(Math.round(Math.min(1, Math.max(0, m[i])) * 100))
        if (el.textContent !== v) el.textContent = v
      }
    })
  }, [stage])
  return (
    <aside className="sg-bars" aria-label="Face muscles">
      <header>
        <b>Face muscles</b>
            <small>{own ? `% of ${whose} own range` : 'general ranges, not yet tuned to this face'}</small>
      </header>
      <ul>
        {MUSCLE_WORDS.map((name, i) => (
          <li key={name} data-hue={i < 2 ? 'smile' : 'ember'} hidden={!own && i > 1}>
            <span>
              {name}
              <em
                ref={(el) => {
                  vals.current[i] = el
                }}
              >
                0
              </em>
            </span>
            <span className="sg-bar">
              <i
                ref={(el) => {
                  fills.current[i] = el
                }}
              />
            </span>
          </li>
        ))}
      </ul>
      {own && read && (
        <footer>
          <small>Closest of the five poses</small>
          <b key={read}>{FACE_WORDS[read]}</b>
        </footer>
      )}
    </aside>
  )
}
