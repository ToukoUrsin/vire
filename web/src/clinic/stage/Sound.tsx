// The hall hears what the person hears. The laughter plays in their ears; without this the big screen is silent and
// a passer-by sees a face light up for no reason. One click turns it on (browsers want a gesture before sound).
import { useCallback, useEffect, useRef, useState } from 'react'
import type { View } from './store'
import { pageQuery } from './store'

const LAUGHS = ['laugh-1', 'laugh-2', 'laugh-3']
const src = (name: string) => new URL(`audio/${name}.mp3`, document.baseURI).toString()

export function Sound({ view }: { view: View }) {
  const [on, setOn] = useState(false)
  const ctx = useRef<AudioContext | null>(null)
  const clips = useRef(new Map<string, AudioBuffer>())
  const voice = useRef<AudioBufferSourceNode | null>(null)
  const timer = useRef<number | null>(null)
  const last = useRef<string | null>(null)
  const turn = useRef(0)

  const load = useCallback(async (name: string) => {
    const c = ctx.current
    if (!c || clips.current.has(name)) return
    try {
      const res = await fetch(src(name))
      if (!res.ok) return
      clips.current.set(name, await c.decodeAudioData(await res.arrayBuffer()))
    } catch {
      /* a missing clip is silence, never an error on the big screen */
    }
  }, [])

  const play = useCallback((name: string, gain: number) => {
    const c = ctx.current
    const buf = clips.current.get(name)
    if (!c || !buf || c.state !== 'running') return null
    const node = c.createBufferSource()
    const g = c.createGain()
    g.gain.value = gain
    node.buffer = buf
    node.connect(g).connect(c.destination)
    node.start()
    return node
  }, [])

  const hush = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    try {
      voice.current?.stop()
    } catch {
      /* already ended */
    }
    voice.current = null
  }, [])

  const start = useCallback(async () => {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return
      ctx.current ??= new AC()
      await ctx.current.resume()
      setOn(true)
      await Promise.all([...LAUGHS, 'chime', 'found'].map(load))
    } catch {
      setOn(false)
    }
  }, [load])

  const stop = useCallback(() => {
    hush()
    void ctx.current?.suspend()
    setOn(false)
  }, [hush])

  // `?sound=1`: on from the first tap or key anywhere, for a laptop set up before the demo
  useEffect(() => {
    if (pageQuery().get('sound') !== '1') return
    const go = () => void start()
    window.addEventListener('pointerdown', go, { once: true })
    window.addEventListener('keydown', go, { once: true })
    return () => {
      window.removeEventListener('pointerdown', go)
      window.removeEventListener('keydown', go)
    }
  }, [start])

  // follow the ping: a soft chime at each step, the laughter one second into the laugh step (as on the phone)
  useEffect(() => {
    const key = `${view.mode}:${view.phase}:${view.runKind ?? ''}`
    const before = last.current
    last.current = key
    if (!on || before === null || before === key) return
    hush()
    if (view.mode === 'ping' && view.phase === 'laugh') {
      const name = LAUGHS[turn.current++ % LAUGHS.length]!
      timer.current = window.setTimeout(() => {
        voice.current = play(name, 1)
      }, 1000)
    } else if (view.mode === 'ping' && view.phase !== 'idle') play('chime', 0.5)
    else if (view.mode === 'echo' || view.mode === 'again') play('found', 0.6)
  }, [on, view.mode, view.phase, view.runKind, hush, play])

  useEffect(() => () => hush(), [hush])

  return (
    <button type="button" className="sg-sound" aria-pressed={on} onClick={() => (on ? stop() : void start())} title="Play the laughter on this screen too">
      <span aria-hidden="true" className="sg-sound-dot" />
      {on ? 'Sound on' : 'Sound off'}
    </button>
  )
}
