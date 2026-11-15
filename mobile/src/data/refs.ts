// 60 studies, each DOI checked on 14 Nov 2026 (see research/refs-notes.md). None of them shows that Vire works.
import raw from '../../research/refs.json'

export interface Ref {
  id: string
  topic: Topic
  authors: string
  year: number
  title: string
  journal: string
  doi: string
  url: string
  finding: string
  sample: string
  limit: string
  strength: string
}
export type Topic = 'calls' | 'face' | 'music' | 'sleep' | 'heart' | 'movement' | 'earables' | 'practices' | 'meru' | 'loop' | 'tms'

export const ALL = raw as Ref[]
export const REFS: Record<string, Ref> = Object.fromEntries(ALL.map((r) => [r.id, r]))
const count = (t: Topic) => ALL.filter((r) => r.topic === t).length

interface TopicInfo {
  name: string
  lead: [string, string]
  /** what the studies do and do not show, in one breath */
  honest: string
  count: number
}
const topic = (t: Topic, name: string, lead: [string, string], honest: string): TopicInfo => ({ name, lead, honest, count: count(t) })

export const TOPICS: Record<Topic, TopicInfo> = {
  tms: topic('tms', 'After TMS', ['senova-2019', 'janicak-2010'], 'About half of the people TMS helped still respond a year later. Bringing TMS back when someone starts to slip rests on open studies only.'),
  earables: topic('earables', 'What earbuds can feel', ['verma-2021', 'gashi-2021'], 'Research earbuds have read nods, expressions, breathing and steps in small lab studies. A model per person did far better than one for everyone. None used AirPods or patients.'),
  loop: topic('loop', 'A model per person, a clinic in the loop', ['pratap-2019', 'zhu-2021'], 'Personal models beat one shared model for mood in one phone study, and clinics that see ratings get more people well. No trial shows that passive sensing prevents relapse.'),
  calls: topic('calls', 'Talking', ['yamamoto-2020', 'mundt-2012'], 'Slower speech and longer pauses are the best supported voice signal. Time spent talking is supported only in students.'),
  face: topic('face', 'Face and head', ['girard-2014', 'davies-2016'], 'Less head movement and fewer smiles when depression is worse, seen on camera in clinic interviews. Small samples, and several studies found nothing.'),
  music: topic('music', 'Music', ['aalbers-2017', 'garrido-2015'], 'Music therapy with a therapist helps in short trials. What a person chooses to play is thinly studied, and no study links streaming data to one person’s depression.'),
  sleep: topic('sleep', 'Sleep', ['baglioni-2011', 'siddi-2023'], 'Poor sleep about doubles the risk of later depression, and wrist wearables show night heart rate follows symptoms. None of this is earbud data.'),
  heart: topic('heart', 'Heart', ['koch-2019', 'doherty-2026'], 'Lower heart rate variability in depression is a solid group difference. AirPods Pro 3 heart rate has one outside check: 40 healthy adults, workouts, beats a minute only.'),
  movement: topic('movement', 'Movement', ['burton-2013', 'bizzozero-peroni-2024'], 'Less activity and fewer steps go with depression across many studies, but those only watched people. Posture and head-down rest on small lab studies.'),
  practices: topic('practices', 'Practices', ['kuyken-2016', 'fincham-2023'], 'Strong for full programmes over weeks. Small to medium for breathing on its own. Nothing shows one short session lowers depression.'),
  meru: topic('meru', 'Meru Health, the model for the programme', ['forman-hoffman-2024', 'raevuori-2021'], 'Two trials of the whole programme: one beat a waitlist, one found no difference from usual care on depression. Both are shown.'),
}

export const TOPIC_ORDER: Topic[] = ['tms', 'earables', 'loop', 'calls', 'face', 'music', 'sleep', 'heart', 'movement', 'practices', 'meru']
export const refsOf = (t: Topic): Ref[] => ALL.filter((r) => r.topic === t)
