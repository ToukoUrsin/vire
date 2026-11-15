// The evidence: every checked study, by topic. Each topic leads with its honest sentence, then the studies,
// the two lead ones first. Nothing here is a result of Vire's own.
import type { CSSProperties } from 'react'
import { go } from '../router'
import { ALL, REFS, TOPICS, TOPIC_ORDER, refsOf, type Topic } from '../data/refs'
import { I } from '../ui/icons'
import { Evidence, Head, Row, Screen, Section } from '../ui/kit'
import './research.css'

const isTopic = (t?: string): t is Topic => !!t && Object.prototype.hasOwnProperty.call(TOPICS, t)
const studies = (n: number) => `${n} ${n === 1 ? 'study' : 'studies'}`

export function Research({ topic }: { topic?: string }) {
  return isTopic(topic) ? <TopicPage topic={topic} /> : <Index />
}

function Index() {
  return (
    <Screen nav="Evidence" backTo="/you">
      <Head
        title="The evidence"
        sub={
          <>
            <span className="num">{ALL.length}</span> studies, each one checked. <b className="ev-none">None of them shows that Vire works.</b>
          </>
        }
      />

      <div className="pad ev-topics">
        {TOPIC_ORDER.map((id, n) => {
          const t = TOPICS[id]
          return (
            <button key={id} className="card ev-topic rise" style={{ '--i': Math.min(n + 1, 6) } as CSSProperties} onClick={() => go(`/research/${id}`)}>
              <span className="title-m ev-topic-name">{t.name}</span>
              <span className="body-2 ev-topic-say">{t.honest}</span>
              <span className="ev-topic-foot">
                <span className="num">{studies(t.count)}</span>
                <I.right size={16} />
              </span>
            </button>
          )
        })}
      </div>

      <Section i={7}>
        <div className="group">
          <Row icon="paper" title="The paper" sub="Vire written up in full, with its limits" to="/paper" />
        </div>
      </Section>
    </Screen>
  )
}

function TopicPage({ topic }: { topic: Topic }) {
  const t = TOPICS[topic]
  const lead = t.lead.map((id) => REFS[id]).filter(Boolean)
  const rest = refsOf(topic).filter((r) => !t.lead.includes(r.id))
  const all = [...lead, ...rest]
  return (
    <Screen nav={t.name} backTo="/research">
      <Head title={t.name} sub={t.honest} />

      <Section title={studies(all.length)} i={1}>
        <div className="card">
          {all.map((r) => (
            <Evidence key={r.id} r={r} />
          ))}
        </div>
        <p className="small ev-foot">The first two are the ones shown on the other screens. Tap a name to open the study. None of them tested Vire.</p>
      </Section>

      <Section i={2}>
        <div className="group">
          <Row icon="paper" title="All the evidence" sub={`${ALL.length} studies in ${TOPIC_ORDER.length} topics`} to="/research" />
        </div>
      </Section>
    </Screen>
  )
}
