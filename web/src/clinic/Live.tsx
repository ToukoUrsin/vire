// The big screen for the stage. Idle, it says what Vire is (AirPods in, camera off) and opens the practice and clinic
// views. A practice from someone's AirPods, the whole clinic re-learning, or a model search take it when they arrive.
// When a phone runs the camera minute it mirrors face, head, heart and voice as they are measured, the ping told
// as a story, and the echo it resolves into. The pieces live in ./stage; this file decides which one leads.
import { useEffect, useMemo } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { encode } from 'uqr'
import { api } from '../shared/api'
import { isMock } from './data'
import { mockRooms } from './mock'
import { Debug } from './stage/Debug'
import { AgainPanel } from './stage/Again'
import { EchoPanel } from './stage/Echo'
import { Bars, Face } from './stage/Face'
import { Head } from './stage/Head'
import { Heart } from './stage/Heart'
import { Lane } from './stage/Lane'
import { Sound } from './stage/Sound'
import { Story } from './stage/Story'
import { TunePanel } from './stage/Tune'
import { AirPodsOnly, SearchBoard, Teaching } from './stage/Ears'
import { pageQuery, useStage } from './stage/store'
import { useEarSearch } from './stage/search'
import { CohortBoard, CohortButton } from './stage/Cohort'
import { useCohort } from './stage/retrain'
import { PracticeBoard } from './stage/Practice'
import { usePractice } from './stage/practice'
import type { View } from './stage/store'
import { displayName } from '../shared/name'
import './stage/stage.css'

interface Room {
  code: string
  name: string
  since: string
}

function joinUrl(): string {
  const u = new URL('./', document.baseURI)
  u.hash = ''
  u.search = ''
  return u.toString()
}

/** what is being asked right now, for someone walking past */
function say(view: View, whose: string): { h: string; p: string } {
  const again = view.runKind === 'mini'
  if (view.mode === 'reading') return { h: 'Reading the camera minute', p: `Four answers, set against ${whose} own usual.` }
  if (view.mode === 'dose') return { h: 'The dose', p: 'One small thing. Then Vire measures again to see if it helped.' }
  switch (view.phase) {
    case 'settle':
      return { h: 'Settle', p: `A resting face and a resting pulse. This is ${whose} usual starting point.` }
    case 'nod':
      return { h: 'Nod', p: '“Nod when you’re ready.” How big is the nod, and how fast?' }
    case 'laugh':
      return again ? { h: 'Laugh again', p: 'The same laughter, after the dose. Does the face answer more now?' } : { h: 'Laugh', p: `Laughter plays in ${whose} ears. How much does the face answer, and how soon?` }
    case 'speak':
      return { h: 'Speak', p: 'One sentence, out loud. How much does the voice move?' }
    case 'breathe':
      return again ? { h: 'Breathe again', p: 'One slow breath. Does the heart swing further now?' } : { h: 'Breathe', p: 'Two slow breaths. How far does the heart swing?' }
    default:
      return { h: 'Ready', p: 'Sixty seconds. Five small questions for the body.' }
  }
}

export default function Live() {
  const { code: raw } = useParams()
  const code = raw ? (raw === '*' ? '*' : raw.toUpperCase()) : null
  const nav = useNavigate()
  const { stage, view } = useStage(code)
  const search = useEarSearch()
  // read again when the address changes: the idle screen links to ?practice=1 and ?cohort=1 on this same page
  const { search: qs } = useLocation()
  const debug = useMemo(() => pageQuery().get('debug') === '1', [qs])
  // ?board=1 keeps the newest finished search on the screen (for a talk: the board of this morning's minute)
  const hold = useMemo(() => pageQuery().get('board') === '1', [qs])
  // the whole clinic re-learning at once (simulated patients); ?cohort=1 keeps the newest run on the screen
  const cohort = useCohort()
  const holdCohort = useMemo(() => pageQuery().get('cohort') === '1', [qs])
  // a practice that just arrived from someone's AirPods; ?practice=1 keeps the newest one on the screen
  const practice = usePractice()
  const holdPractice = useMemo(() => pageQuery().get('practice') === '1', [qs])

  // no code: wait for the newest room with a phone in it and open it
  useEffect(() => {
    if (code || hold || holdCohort || holdPractice) return
    let dead = false
    const look = async () => {
      let rooms: Room[] = []
      if (isMock()) rooms = mockRooms()
      else {
        try {
          rooms = await api<Room[]>('live/rooms')
        } catch {
          rooms = []
        }
      }
      if (!dead && Array.isArray(rooms) && rooms[0]?.code) nav(`/clinic/live/${rooms[0].code}${isMock() ? '?mock=1' : ''}`, { replace: true })
    }
    void look()
    const id = setInterval(look, 2000)
    return () => {
      dead = true
      clearInterval(id)
    }
  }, [code, nav, hold, holdCohort, holdPractice])

  const url = useMemo(joinUrl, [])
  const devAddress = /^(?:127\.0\.0\.1|localhost)$/i.test(new URL(url).hostname)
  const shortUrl = devAddress ? '' : url.replace(/^https?:\/\//, '').replace(/\/$/, '')
  // the Modal search leads while it waits, runs, or has just finished, unless someone is in the middle of something
  const busy = view.mode === 'tune' || view.mode === 'ping' || view.mode === 'reading' || view.mode === 'dose' || (view.mode === 'teach' && view.teach?.state !== 'done')
  const held = hold && search.seen?.job.state === 'done'
  const searchLeads = !!((search.shows || held) && search.seen)
  const cohortLeads = !!((cohort.shows || holdCohort) && cohort.seen)
  // a person's own search takes the screen when it is newer than the clinic's run
  const searchAt = search.seen ? Math.max(search.seen.job.at ?? 0, search.seen.job.dailyAt ?? 0) : 0
  const cohortAt = cohort.seen?.run.at ?? 0
  const practiceLeads = !!((practice.shows || holdPractice) && practice.seen)
  const practiceAt = practice.seen?.arrivedAt ?? 0
  // the newest of the three takes the screen; a tab opened on ?practice=1 or ?cohort=1 keeps its own board whatever
  // else arrives (at a table the practice tab must not turn into the clinic run the next tab just started)
  const practiceFirst = practiceLeads && (holdPractice || ((!searchLeads || practiceAt > searchAt) && (!cohortLeads || practiceAt > cohortAt)))
  const cohortFirst = !practiceFirst && cohortLeads && (holdCohort || !searchLeads || cohortAt > searchAt)
  const rawMode = code && busy ? view.mode : practiceFirst ? 'practice' : cohortFirst ? 'cohort' : searchLeads ? 'search' : code ? view.mode : 'attract'
  // a phone that is connected but has not started the camera minute does not take the screen: it stays on the loop, with a line saying the phone is there
  const phoneHere = rawMode === 'ready'
  const mode = phoneHere ? 'attract' : rawMode
  const cohortGoing = cohort.seen?.run.state === 'queued' || cohort.seen?.run.state === 'running'
  const name = view.name && !/^(guest|stage|clinic)$/i.test(view.name.trim()) ? displayName(view.name) : ''
  const whose = name ? `${name}’s` : 'their'
  const measuring = mode === 'ping' || mode === 'dose' || mode === 'reading'
  const asked = mode === 'tune' && view.tuneStep !== null && view.tuneStep !== 'training' && view.tuneStep !== 'done'
  const showBars = (measuring || mode === 'tune') && (view.streaming || mode === 'reading')
  const copy = say(view, whose)
  // the face has done its work: the screen belongs to what it resolved into
  const resolved = (mode === 'echo' && !!view.echo) || mode === 'again'
  const airpodsOnly = view.camera === false && !['attract', 'teach', 'search', 'cohort', 'practice', 'echo', 'again'].includes(mode)

  const who = name || (code && code !== '*' ? `Room ${code}` : '')
  const note =
    view.conn === 'simulated'
      ? 'Simulated signal'
      : view.conn === 'open'
        ? view.streaming
          ? 'Live'
          : view.present
            ? 'Connected'
            : 'Waiting for a phone'
        : view.conn === 'closed'
          ? 'Reconnecting'
          : code
            ? 'Connecting'
            : 'Looking for a phone'
  const cap = view.ownMesh
    ? 'The camera minute: 478 points. No picture leaves the phone.'
    : view.streaming
      ? 'The camera minute: a standard face, moved by the measured numbers. No picture leaves the phone.'
      : asked
        ? 'The camera minute: a standard face, showing what is asked. No picture leaves the phone.'
        : 'The camera minute: a wireframe, never the camera picture.'
  const idle = mode === 'attract'

  return (
    <div className="sg" data-mode={mode} data-phase={view.phase}>
      <header className="sg-top">
        <div className="sg-who">
          <span className="sg-mark">Vire</span>
          {code && <span className="sg-rule" aria-hidden="true" />}
          {code && <span className={`sg-beacon${view.streaming ? ' is-on' : ''}`} aria-hidden="true" />}
          {/* idle, the screen names nobody and no room: a phone that is only connected is not this screen's story */}
          {!idle && who && <b>{who}</b>}
          {/* with no room open there is no phone to wait for: a practice or a clinic run needs none */}
          {!idle && code && (
            <small>
              {note}
              {name && code && code !== '*' ? `, room ${code}` : ''}
            </small>
          )}
        </div>
        {/* the hall's sound is the camera minute's laughter: only a room has it */}
        {code && <Sound view={view} />}
        {mode !== 'attract' && (
          <div className="sg-join">
            <div>
              <b>Try it on your phone</b>
              {shortUrl && <small>{shortUrl}</small>}
            </div>
            <Qr text={url} />
          </div>
        )}
      </header>

      {/* a practice or a clinic run needs no room: the note is only true when this phone follows one */}
      {!idle && code && mode !== 'practice' && mode !== 'cohort' && (
        <aside className="sg-phone-note" aria-label="Big screen">
          <b>Big screen</b>
          <span>
            This phone is connected to <strong>{code && code !== '*' ? `room ${code}` : 'the newest room'}</strong>. Open the big screen on a laptop for the full view.
          </span>
        </aside>
      )}

      <main className="sg-main" data-mode={mode}>
        {!idle && !resolved && !['teach', 'search', 'cohort', 'practice'].includes(mode) && !airpodsOnly && (
          <section className={`sg-left${showBars ? '' : ' is-solo'}`} aria-label="The camera minute: the face, as a wireframe">
            <div className="sg-facebox">
              <Face stage={stage} />
            </div>
            {showBars && <Bars stage={stage} own={view.ownMuscles} whose={whose} read={view.faceRead} />}
            <p className="sg-cap">{cap}</p>
          </section>
        )}

        {mode === 'attract' && (
          <section className="sg-right sg-attract sg-idle">
            <h1>AirPods in, camera off.</h1>
            <p className="sg-idle-lede">
              {holdCohort
                ? 'No clinic run on this screen yet. Start one and every simulated patient learns again in a sandbox of their own. The tiles fill in as they finish.'
                : holdPractice
                ? 'No practice has come in yet. When someone finishes one, it lands here with what Vire tried and what changed.'
                : 'When someone finishes a practice, it lands here with what Vire tried and what changed.'}
            </p>
            <nav className="sg-idle-links" aria-label="Open">
              <a href="#/watch">Watch a run</a>
              <a href="#/clinic/live?practice=1">The last practice</a>
              {holdCohort && !busy ? <CohortButton start={cohort.start} going={cohortGoing} here /> : <a href="#/clinic/live?cohort=1">The whole clinic, re-trained</a>}
            </nav>
            <div className="sg-attract-join">
              <Qr text={url} />
              <div>
                <b>Try it on your phone</b>
                {shortUrl && <small>{shortUrl}</small>}
              </div>
            </div>
            {phoneHere && (
              <p className="sg-idle-phone" aria-live="polite">
                A phone is connected for the camera minute. When it starts there, this screen follows along.
              </p>
            )}
          </section>
        )}

        {mode === 'tune' && <TunePanel stage={stage} view={view} whose={whose} />}

        {mode === 'teach' && <Teaching stage={stage} view={view} />}
        {mode === 'search' && search.seen && <SearchBoard seen={search.seen} />}
        {mode === 'cohort' && cohort.seen && <CohortBoard seen={cohort.seen} />}
        {mode === 'practice' && practice.seen && <PracticeBoard seen={practice.seen} />}
        {airpodsOnly && <AirPodsOnly stage={stage} view={view} />}

        {measuring && !airpodsOnly && (
          <section className="sg-right" aria-live="polite">
            <header className="sg-say" key={`${mode}-${view.phase}-${view.runKind}`}>
              <h1>{copy.h}</h1>
              <p>{copy.p}</p>
            </header>
            <div className="sg-panels">
              <Head stage={stage} source={view.headSource} dim={view.phase !== 'nod' || mode !== 'ping'} />
              <Lane stage={stage} mode={mode} headSource={view.headSource} hasEar={view.hasEar} camera={view.camera} />
              <Heart stage={stage} source={view.heartSource} dim={mode === 'reading' || (mode === 'ping' && view.phase !== 'breathe' && view.phase !== 'settle')} />
            </div>
          </section>
        )}

        {mode === 'echo' && view.echo && <EchoPanel echo={view.echo} before={view.before} name={name} whose={whose} phoneReadings={view.phoneReadings} />}
        {mode === 'again' && <AgainPanel stage={stage} whose={whose} />}
      </main>

      {!idle && !['tune', 'teach', 'search', 'cohort', 'practice'].includes(mode) && <Story stage={stage} view={view} />}
      {/* idle, the screen links to the clinic view; on ?cohort=1 the button sits with those links and starts the run */}
      {!busy && !idle && !holdPractice && <CohortButton start={cohort.start} going={cohortGoing} />}
      {debug && <Debug stage={stage} view={view} />}
    </div>
  )
}

function Qr({ text }: { text: string }) {
  const { d, n } = useMemo(() => {
    const q = encode(text, { ecc: 'M', border: 2 })
    let path = ''
    q.data.forEach((row, yy) => row.forEach((on, xx) => on && (path += `M${xx} ${yy}h1v1h-1z`)))
    return { d: path, n: q.size }
  }, [text])
  return (
    <svg className="sg-qr" viewBox={`0 0 ${n} ${n}`} role="img" aria-label={`QR code for ${text}`} shapeRendering="crispEdges">
      <rect width={n} height={n} fill="#f3ece0" />
      <path d={d} fill="#14110d" />
    </svg>
  )
}
