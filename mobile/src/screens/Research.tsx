// The evidence: every checked study, by topic. Each topic leads with its honest sentence, then the studies,
// the two lead ones first. Nothing here is a result of Vire's own.
import type { CSSProperties } from 'react'
import { go } from '../router'
import { ALL, REFS, TOPICS, TOPIC_ORDER, refsOf, type Topic } from '../data/refs'
import type { IconName } from '../ui/icons'
import { Badge, Chip, Evidence, Row, Screen, Section, type Tone } from '../ui/kit'
import './research.css'

const isTopic = (t?: string): t is Topic => !!t && Object.prototype.hasOwnProperty.call(TOPICS, t)
const studies = (n: number) => `${n} ${n === 1 ? 'study' : 'studies'}`
const rise = (i: number) => ({ '--i': i }) as CSSProperties

const LOOK: Record<Topic, { icon: IconName; tone: Tone }> = {
  tms: { icon: 'clinic', tone: 'ember' },
  earables: { icon: 'airpods', tone: 'move' },
  loop: { icon: 'loop', tone: 'ember' },
  calls: { icon: 'call', tone: 'voice' },
  face: { icon: 'smile', tone: 'face' },
  music: { icon: 'music', tone: 'face' },
  sleep: { icon: 'sleep', tone: 'move' },
  heart: { icon: 'heart', tone: 'heart' },
  movement: { icon: 'walk', tone: 'move' },
  practices: { icon: 'breath', tone: 'voice' },
  programme: { icon: 'practices', tone: 'plain' },
}

export function Research({ topic }: { topic?: string }) {
  return isTopic(topic) ? <TopicPage topic={topic} /> : <Index />
}

function Index() {
  return (
    <Screen nav="Evidence" backTo="/you" glow="face">
      <div className="pad rise" style={rise(0)}>
        <h1 className="ev-hero">
          <span className="big-num num">{ALL.length}</span>
          <span className="title-l">studies, each one checked</span>
        </h1>
        <p className="voice ev-none">None of them shows that Vire works.</p>
        <div className="pills ev-hero-pills">
          <span className="pill num">{TOPIC_ORDER.length} topics</span>
          <span className="pill">Every limit stated</span>
        </div>
      </div>

      <div className="pad ev-topics">
        {TOPIC_ORDER.map((id, n) => {
          const t = TOPICS[id]
          const look = LOOK[id]
          return (
            <button key={id} className="card ev-topic rise" style={rise(Math.min(n + 1, 6))} onClick={() => go(`/research/${id}`)}>
              <span className="ev-topic-top">
                <Badge icon={look.icon} tone={look.tone} size={42} />
                <span className="ev-topic-n num">
                  {t.count}
                  <small>{t.count === 1 ? 'study' : 'studies'}</small>
                </span>
              </span>
              <span className="title-m ev-topic-name">{t.name}</span>
              <span className="body-2 ev-topic-say">{t.honest}</span>
            </button>
          )
        })}
      </div>

      <Section i={7}>
        <div className="group">
          <Row icon="paper" tone="move" title="The paper" sub="Vire written up in full, with its limits" to="/paper" />
        </div>
      </Section>
    </Screen>
  )
}

function TopicPage({ topic }: { topic: Topic }) {
  const t = TOPICS[topic]
  const look = LOOK[topic]
  const lead = t.lead.map((id) => REFS[id]).filter(Boolean)
  const rest = refsOf(topic).filter((r) => !t.lead.includes(r.id))
  const all = [...lead, ...rest]
  return (
    <Screen nav={t.name} backTo="/research" glow={look.tone}>
      <div className="pad rise" style={rise(0)}>
        <div className="ev-top">
          <Badge icon={look.icon} tone={look.tone} size={46} />
          <Chip>{studies(all.length)}, checked</Chip>
        </div>
        <h1 className="title-xl">{t.name}</h1>
      </div>

      <div className="pad rise ev-honest-wrap" style={rise(1)}>
        <div className="card ev-honest">
          <p className="voice">{t.honest}</p>
        </div>
      </div>

      <Section title="The studies" i={2}>
        {all.map((r) => (
          <div key={r.id} className="card ev-study">
            <Evidence r={r} />
          </div>
        ))}
        <p className="small ev-foot">Tap a name to open the study. None of them tested Vire.</p>
      </Section>

      <Section i={3}>
        <div className="group">
          <Row icon="spark" tone="face" title="All the evidence" sub={`${ALL.length} studies in ${TOPIC_ORDER.length} topics`} to="/research" />
        </div>
      </Section>
    </Screen>
  )
}
