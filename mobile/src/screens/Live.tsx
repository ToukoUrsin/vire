// What the person's own model reads right now, from the AirPods' motion alone: nods and head shakes counted as
// they happen, the head drawn as it turns. The camera can be switched on to keep the smile (the AirPods alone
// did not pass their check for smiles), and it stands in for the AirPods on a phone that has none.
import { useCallback, useEffect, useRef, useState } from 'react'
import { postNative } from '@web/sense/native'
import { go } from '../router'
import { Follow, SEEN, type Now, type Seen } from '../live/follow'
import { keepAwake, onHead, onPhone, sense, useModel, usePods, wakePods } from '../live/pods'
import { HeadView, MotionStrip, type Pose } from '../live/views'
import { Meter } from '../ui/charts'
import { Badge, Btn, Chip, RunsOn, Screen, Section } from '../ui/kit'
import { NAMES } from './Train'
import './train.css'

const ICON = { nod: 'nod', shake: 'shake', smile: 'smile' } as const
const TONE = { nod: 'move', shake: 'move', smile: 'face' } as const

export function Live() {
  const pods = usePods()
  const model = useModel()
  const follow = useRef<Follow | null>(null)
  if (!follow.current) follow.current = new Follow(model)
  const pose = useRef<Pose | null>(null)
  const smile = useRef(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const podsOn = useRef(pods.on)
  podsOn.current = pods.on
  const camSubs = useRef(new Set<(s: { t: number; pitch: number; yaw: number }) => void>())
  const [now, setNow] = useState<Now>(() => follow.current!.snapshot())
  const [cam, setCam] = useState<'off' | 'starting' | 'on'>('off')
  const [heart, setHeart] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => follow.current!.use(model), [model])

  useEffect(() => {
    const f = follow.current!
    let lastHead = 0
    const offs = [
      onHead((h) => {
        lastHead = performance.now()
        pose.current = { t: lastHead, pitch: h.pitch, yaw: h.yaw, roll: h.roll }
        f.head(h, true)
      }),
      sense.on('face', (face) => {
        f.camera(face.smile, face.present, face.t)
        // no AirPods on this device: the camera's own head pose stands in for them
        if (!podsOn.current && face.present) {
          pose.current = { t: performance.now(), pitch: face.pitch, yaw: face.yaw, roll: -face.roll }
          const s = { t: face.t, pitch: face.pitch, yaw: face.yaw }
          f.head(s, false)
          camSubs.current.forEach((cb) => cb(s))
        }
      }),
    ]
    const tick = setInterval(() => {
      if (performance.now() - lastHead > 1500 && podsOn.current) f.idle()
      const snap = f.snapshot()
      smile.current = snap.p.smile
      setNow(snap)
    }, 110)
    let sleep = () => {}
    void keepAwake().then((off) => (sleep = off))
    return () => {
      offs.forEach((off) => off())
      clearInterval(tick)
      sleep()
      sense.setHeartSession(false)
      sense.stop()
      postNative({ cmd: 'start' })
    }
  }, [])

  const camera = useCallback(async (on: boolean) => {
    setError(null)
    if (!on) {
      sense.stop()
      postNative({ cmd: 'start' })
      follow.current!.cameraOff()
      setCam('off')
      return
    }
    if (!videoRef.current) return
    setCam('starting')
    try {
      await sense.start({ video: videoRef.current, audio: false })
      setCam('on')
    } catch (e) {
      setCam('off')
      setError((e as Error)?.message || 'The camera did not start.')
    }
  }, [])
  const subCam = useCallback((cb: (s: { t: number; pitch: number; yaw: number }) => void) => {
    camSubs.current.add(cb)
    return () => void camSubs.current.delete(cb)
  }, [])

  const standIn = !pods.on && cam === 'on'
  const reading = pods.on || cam === 'on'
  const flash = now.last && performance.now() - now.last.t < 1300 ? now.last : null
  const by = (e: Seen): string => {
    if (standIn) return 'Camera stand-in'
    const b = now.by[e]
    if (!reading) return b === 'model' ? 'Your model' : e === 'smile' ? 'Needs the camera' : 'Plain rule'
    const auc = model?.events[e]?.score.auc
    if (b === 'model') return `AirPods alone${auc ? ` · ${auc.toFixed(2)}` : ''}`
    if (b === 'camera') return 'Camera'
    if (b === 'rule') return 'AirPods, plain rule'
    return auc ? `Camera keeps it · ${auc.toFixed(2)}` : 'Needs the camera'
  }

  return (
    <Screen
      nav="Live"
      backTo="/you"
      glow="ember"
      right={
        pods.on ? (
          <Chip tone="live" dot pulse>
            {pods.hz} a second
          </Chip>
        ) : cam === 'on' ? (
          <Chip tone="ember" dot>
            Camera
          </Chip>
        ) : undefined
      }
    >
      <div className="pad rise" style={{ '--i': 0 } as React.CSSProperties}>
        <h1 className="title-l">{pods.on ? 'Your AirPods, reading you' : standIn ? 'Your camera, standing in' : 'No AirPods here'}</h1>
        <p className="body-2" style={{ marginTop: 6 }}>
          {pods.on ? (cam === 'on' ? 'Head from the AirPods. The camera keeps the smile.' : 'From their motion alone. The camera is off.') : standIn ? 'With AirPods in, the same reading comes from their motion, camera off.' : onPhone() ? 'AirPods run in the Vire iPhone app. Here the camera can stand in.' : 'In the Vire iPhone app this reads your AirPods. Here the camera can stand in.'}
        </p>
      </div>

      <div className="live-stage rise" style={{ '--i': 1 } as React.CSSProperties}>
        <HeadView pose={pose} smile={smile} drift={!standIn} />
        <div className={`live-cam ${cam === 'on' ? 'is-on' : ''}`}>
          <video ref={videoRef} playsInline muted autoPlay />
        </div>
        <div className="live-word" aria-live="polite">
          {flash ? <span key={`${flash.e}${now.counts[flash.e]}`}>{NAMES[flash.e]}</span> : <span className="live-idle" key="idle">{reading ? 'Nod, shake your head, smile' : ''}</span>}
        </div>
      </div>

      <div className="pad tiles rise" style={{ '--i': 2, marginTop: 14 } as React.CSSProperties}>
        {SEEN.map((e) => (
          <div key={e} className={`tile ${now.on[e] ? 'is-on' : ''}`}>
            <div className="tile-top">
              <Badge icon={ICON[e]} tone={now.on[e] ? 'ember' : TONE[e]} size={34} />
              <span className="tile-n num">{now.counts[e]}</span>
            </div>
            <div className="tile-name">{NAMES[e]}</div>
            <Meter p={now.p[e]} tone={TONE[e]} on={now.on[e]} />
            <div className="tile-by">{by(e)}</div>
          </div>
        ))}
      </div>

      {!reading && (
        <div className="pad train-go rise" style={{ '--i': 3 } as React.CSSProperties}>
          <Btn wide icon="camera" onClick={() => void camera(true)} disabled={cam === 'starting'}>
            Try it with your camera
          </Btn>
          {!pods.app && !onPhone() && (
            <Btn wide kind="quiet" onClick={() => void wakePods().then((ok) => !ok && setError('Vire Ears did not answer on this Mac.'))}>
              Connect AirPods on this Mac
            </Btn>
          )}
        </div>
      )}
      {error && (
        <p className="pad train-error" role="alert">
          {error}
        </p>
      )}

      {reading && (
        <Section title="The last six seconds" i={3}>
          <div className="card">
            <MotionStrip sub={pods.on ? onHead : subCam} key={pods.on ? 'pods' : 'cam'} />
          </div>
        </Section>
      )}

      {pods.app && (
        <Section title="Heart rate" i={4}>
          <div className="card live-heart">
            <Badge icon="heart" tone="heart" size={46} />
            {heart && pods.bpm != null ? (
              <div>
                <div className="title-l num">{pods.bpm}</div>
                <div className="row-sub" style={{ marginTop: 2 }}>
                  beats a minute, from the AirPods{pods.bpmAge != null && pods.bpmAge > 8 ? `, ${pods.bpmAge} s ago` : ''}
                </div>
              </div>
            ) : (
              <div style={{ flex: 1 }}>
                <div className="row-title">{heart ? 'Waiting for the first reading' : 'AirPods Pro 3 read it in the ear'}</div>
                <div className="row-sub">{heart ? 'It takes a few seconds' : 'Through a workout session on the iPhone'}</div>
              </div>
            )}
            {!heart && (
              <Btn
                small
                kind="quiet"
                onClick={() => {
                  sense.setHeartSession(true)
                  setHeart(true)
                }}
              >
                Start
              </Btn>
            )}
          </div>
        </Section>
      )}

      <Section title="Your model" i={5}>
        <div className="card">
          <p className="body-2">
            {model
              ? `Taught on ${model.minutes ?? 1} of your ${(model.minutes ?? 1) === 1 ? 'minute' : 'minutes'}. ${model.tried} models tried${model.by === 'sandbox' ? ', in a Modal Sandbox of your own with the network blocked' : ' on this phone'}.`
              : 'No model on this device yet. Until you teach one, a plain rule on the head angles counts nods and head shakes.'}
          </p>
          {model?.by === 'sandbox' && (
            <div style={{ marginTop: 12 }}>
              <RunsOn />
            </div>
          )}
          <p className="small" style={{ marginTop: 12 }}>
            Nods and head shakes come from the AirPods alone. Smiles need the camera until the AirPods pass their own check.
          </p>
        </div>
        <div className="train-go" style={{ marginTop: 14 }}>
          {pods.on && (
            <Btn wide kind="quiet" icon="camera" onClick={() => void camera(cam !== 'on')} disabled={cam === 'starting'}>
              {cam === 'on' ? 'Camera off' : 'Keep smiles with the camera'}
            </Btn>
          )}
          {standIn && (
            <Btn wide kind="quiet" onClick={() => void camera(false)}>
              Camera off
            </Btn>
          )}
          <Btn
            wide
            kind="quiet"
            onClick={() => {
              follow.current!.clear()
              setNow(follow.current!.snapshot())
            }}
          >
            Count from zero
          </Btn>
          <Btn wide kind="ghost" onClick={() => go('/train')}>
            {model ? 'Teach another minute' : 'Teach your AirPods'}
          </Btn>
        </div>
      </Section>
    </Screen>
  )
}
