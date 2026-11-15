// A made-up person's day and week, so the screens that are not built yet have something to show.
// Every screen that draws from here says "Sample" on it. Nothing in this file was measured.
import type { IconName } from '../ui/icons'
import type { Tone } from '../ui/kit'

export const NOW_H = 17.5 // the sample day is looked at from 17:30

// The sample day is a Thursday: the nurse wrote on Wednesday, and the night to Thursday is the sample night.
// Every week in the app is drawn as the last seven days with today last, so each screen shows the same seven days.
export const TODAY = 3
export const week = <T,>(v: T[]): T[] => [...v.slice(TODAY + 1), ...v.slice(0, TODAY + 1)]
export const DAYS = week(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']).map((d, i, a) => (i === a.length - 1 ? 'Today' : d))

export type RingKey = 'move' | 'talk' | 'heart'
export interface RingSeries {
  name: string
  unit: string
  /** hour of day for each point */
  h: number[]
  lo: number[]
  hi: number[]
  /** today so far: one value per hour from the first, the last one is "now" */
  today: number[]
  /** how to say one value */
  fmt: (v: number) => string
}
const H = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]
const band = (mid: number[], spread: number) => ({ lo: mid.map((m) => +(m - spread).toFixed(1)), hi: mid.map((m) => +(m + spread).toFixed(1)) })

export const RING: Record<RingKey, RingSeries> = {
  move: {
    name: 'Head movement',
    unit: 'turns a minute',
    h: H,
    ...band([9, 12, 13, 12, 13, 15, 13, 12, 12, 13, 14, 13, 11, 10, 8, 7, 6], 2.6),
    today: [9.5, 12.6, 13.8, 11.9, 12.4, 15.6, 8.1, 5.2, 4.6, 11.8, 13.6],
    fmt: (v) => `${v.toFixed(0)} turns a minute`,
  },
  talk: {
    name: 'Talking',
    unit: 'minutes an hour',
    h: H,
    ...band([4, 9, 16, 12, 10, 14, 11, 10, 9, 11, 13, 12, 10, 9, 6, 4, 2], 4),
    today: [3, 8, 24, 9, 7, 13, 2, 0, 0, 3, 18],
    fmt: (v) => `${v.toFixed(0)} min of talking`,
  },
  heart: {
    name: 'Heart rate',
    unit: 'beats a minute',
    h: H,
    ...band([66, 70, 72, 71, 71, 76, 72, 71, 70, 71, 73, 72, 70, 68, 66, 64, 62], 4),
    today: [67, 71, 74, 70, 72, 79, 76, 78, 79, 71, 72],
    fmt: (v) => `${v.toFixed(0)} beats a minute`,
  },
}

export interface Moment {
  t: string
  icon: IconName
  tone: Tone
  title: string
  sub: string
  to?: string
  /** the loop stepping in */
  loop?: boolean
}
export const DAY: Moment[] = [
  { t: '07:05', icon: 'airpods', tone: 'plain', title: 'AirPods in', sub: 'Vire starts sensing' },
  { t: '09:00', icon: 'call', tone: 'voice', title: 'Call with Aino', sub: '22 min · you nodded 28 times', to: '/signals/calls' },
  { t: '10:10', icon: 'music', tone: 'face', title: 'Music while working', sub: '1 h 40 min · head moved with the beat on 4 of 11 songs', to: '/signals/music' },
  { t: '12:30', icon: 'walk', tone: 'move', title: 'Walk', sub: '14 min · 1,480 steps', to: '/signals/movement' },
  { t: '13:10', icon: 'move', tone: 'move', title: 'Head down, hardly moving', sub: '2 h 20 min · no talking · heart rate 7 above your usual', loop: true },
  { t: '15:40', icon: 'breath', tone: 'ember', title: 'Vire offered slow breathing', sub: '3 min · heart rate 79 to 71 · head 38% stiller', to: '/practice/breathing', loop: true },
  { t: '16:20', icon: 'call', tone: 'voice', title: 'Call with Mum', sub: '14 min · you nodded 20 times', to: '/signals/calls' },
]

export interface Person {
  name: string
  who: string
  minutes: number
  calls: number
  /** per ten minutes of call. Nods only: the AirPods alone did not pass their check for smiles */
  nods: number
  /** share of the call you were the one talking */
  talk: number
  note: string
  week: number[]
}
export const PEOPLE: Person[] = [
  { name: 'Mum', who: 'Family', minutes: 64, calls: 4, nods: 14, talk: 0.52, note: 'You nod most on these calls.', week: [0, 0, 9, 14, 0, 20, 21] },
  { name: 'Aino', who: 'Work', minutes: 118, calls: 5, nods: 12.9, talk: 0.41, note: 'Steady. Close to your usual.', week: [28, 0, 0, 22, 24, 24, 20] },
  { name: 'Jussi', who: 'Work', minutes: 47, calls: 2, nods: 4.2, talk: 0.24, note: 'You go quiet and still here.', week: [24, 0, 0, 0, 23, 0, 0] },
  { name: 'Sanna', who: 'TMS nurse', minutes: 12, calls: 1, nods: 10, talk: 0.58, note: 'Check-in call on Tuesday.', week: [0, 12, 0, 0, 0, 0, 0] },
]
// minutes on calls a day, Monday first: the sum of the people above. Tuesday and Wednesday are the quiet days the nurse writes about.
export const CALL_WEEK = { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], minutes: [52, 12, 9, 36, 47, 44, 41], lo: 34, hi: 62 }

export interface Song {
  title: string
  by: string
  bpm: number
  at: string
  /** share of the song the head moved in time with it */
  beat: number
  /** heart rate change over the song */
  hr: number
  mood: 'lifts' | 'calms' | 'sinks' | 'flat'
}
export const SONGS: Song[] = [
  { title: 'Kesäyö', by: 'Aava', bpm: 118, at: '10:14', beat: 0.81, hr: 3, mood: 'lifts' },
  { title: 'Northern Line', by: 'Oda Vale', bpm: 104, at: '10:31', beat: 0.64, hr: 1, mood: 'lifts' },
  { title: 'Glass Harbour', by: 'Mirel', bpm: 72, at: '11:02', beat: 0.08, hr: -4, mood: 'calms' },
  { title: 'Hiljaa', by: 'Sointu & Kuu', bpm: 64, at: '11:20', beat: 0.03, hr: 2, mood: 'sinks' },
  { title: 'Run Home', by: 'Lantern Club', bpm: 126, at: '11:41', beat: 0.72, hr: 6, mood: 'lifts' },
]

/** the sample night: heart rate every 20 minutes from 23:40, and the usual band for each point */
export const NIGHT = {
  from: '23:40',
  to: '06:40',
  t: Array.from({ length: 22 }, (_, i) => i / 3), // hours since sleep started
  bpm: [66, 63, 61, 60, 59, 58, 58, 57, 58, 60, 59, 58, 57, 57, 58, 58, 59, 61, 60, 59, 60, 62],
  lo: [60, 58, 56, 54, 53, 52, 52, 52, 52, 53, 53, 52, 52, 52, 52, 53, 53, 54, 54, 55, 56, 57],
  hi: [66, 63, 61, 59, 58, 57, 56, 56, 56, 57, 57, 56, 56, 56, 56, 57, 57, 58, 59, 60, 61, 62],
  rest: 58,
  usual: 54,
  /** minutes the head moved, per 20-minute slot: the AirPods can feel turning over, not sleep stages */
  stir: [6, 2, 0, 0, 1, 0, 0, 0, 4, 9, 2, 0, 0, 0, 1, 0, 0, 5, 3, 0, 2, 7],
}
export const NIGHT_WEEK = { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], rest: [54, 55, 57, 58, 56, 54, 53], lo: 52, hi: 56 }

export const STEPS_WEEK = { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], steps: [6400, 3100, 2800, 5600, 6100, 8200, 7400], lo: 5200, hi: 7800 }
export const HEAD_DOWN_WEEK = { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], hours: [3.1, 5.4, 5.9, 3.6, 3.4, 1.8, 2.1], lo: 2.4, hi: 4.0 }

export interface PracticeInfo {
  id: string
  name: string
  icon: IconName
  minutes: number
  line: string
  /** what Vire reads while you do it */
  reads: string
  /** sample history: times done, average heart-rate change, share of the times the heart rate was lower after */
  done: number
  hr: number
  calmer: number
  steps: string[]
}
export const PRACTICES: PracticeInfo[] = [
  { id: 'breathing', name: 'Slow breathing', icon: 'breath', minutes: 3, line: 'Six breaths a minute, over a slow sound made for it.', reads: 'Heart rate, and how still your head sits.', done: 12, hr: -6.2, calmer: 0.917, steps: ['Sit however you like.', 'Breathe in as the circle grows, out as it falls.', 'Vire reads your head before and after.'] },
  { id: 'bodyscan', name: 'Body scan', icon: 'body', minutes: 5, line: 'Attention from your feet up to your face.', reads: 'How still your head sits, and heart rate.', done: 5, hr: -3.1, calmer: 0.4, steps: ['Sit or lie down.', 'A bell moves you on to the next part of the body.', 'Nothing to get right.'] },
  { id: 'sit', name: 'Sitting meditation', icon: 'sit', minutes: 10, line: 'Ten minutes with the breath. A bell at the start and the end.', reads: 'Stillness, minute by minute.', done: 2, hr: -1.4, calmer: 0.5, steps: ['Sit upright, eyes soft or closed.', 'When the mind wanders, come back to the breath.', 'The bell ends it.'] },
  { id: 'yoga', name: 'Neck and shoulders', icon: 'stretch', minutes: 8, line: 'Slow yoga for people who sit all day.', reads: 'Each move, from how your head turns and tips.', done: 5, hr: -2.2, calmer: 0.4, steps: ['Stand or sit.', 'Follow the voice: tip, turn, roll.', 'Vire counts the moves from your AirPods.'] },
  { id: 'walk', name: 'A walk', icon: 'walk', minutes: 10, line: 'Out the door, any pace.', reads: 'Steps, felt in the AirPods.', done: 8, hr: 4.8, calmer: 0.5, steps: ['AirPods in, phone in your pocket.', 'It counts once Vire has felt steps for a third of it.', 'Vire checks in when you are back.'] },
  { id: 'winddown', name: 'Wind down', icon: 'sleep', minutes: 15, line: 'Sound that fades as your head goes still.', reads: 'Head stillness, then heart rate through the night.', done: 3, hr: -4.0, calmer: 0.33, steps: ['In bed, lights off.', 'The sound fades once you have been still a while.', 'Nothing to switch off.'] },
]

export const PROGRAMME = {
  week: 3,
  of: 12,
  theme: 'Breath and heart',
  weeks: ['Home after TMS', 'Your own usual', 'Breath and heart', 'Moving again', 'Sleep', 'Thoughts that loop', 'People', 'Music and mood', 'Early signs', 'What helps you', 'Your plan with the clinic', 'Keeping it'],
  lessons: [
    { title: 'Why slow breathing', kind: 'Listen', minutes: 4, done: true },
    { title: 'Find your pace', kind: 'Practice', minutes: 3, done: true },
    { title: 'Heart rate, plainly', kind: 'Read', minutes: 3, done: false },
    { title: 'Breathe with the sound', kind: 'Practice', minutes: 5, done: false },
  ],
}

export const NURSE = { name: 'Sanna', role: 'TMS nurse', clinic: 'your TMS clinic' }
export const CHAT: Array<{ from: 'nurse' | 'you'; text: string; day?: string; fresh?: boolean }> = [
  { from: 'nurse', day: 'Wednesday', text: 'Hi! I saw your week. Tuesday and Wednesday afternoons were quieter than your usual. How did they feel to you?' },
  { from: 'you', text: 'Tired mostly. Worked from home both days and barely talked to anyone.' },
  { from: 'nurse', text: 'Thanks, that fits what Vire saw. The breathing brought your heart rate down both times, so keep that one.' },
  { from: 'nurse', day: 'Today', fresh: true, text: 'Today looks better after the breathing. I have kept Friday 10:30 free for a booster session in case the dip comes back. It is in your Clinic view, yours to book. No need to wait for the December visit.' },
  { from: 'nurse', fresh: true, text: 'Your weekly check-in is open. Two questions, two taps.' },
]

export const CHECKIN = {
  lead: 'Over the last week, how often have you been bothered by:',
  // the PHQ-2: the same two weekly questions the clinic side shows
  items: ['Little interest or pleasure in doing things', 'Feeling down, depressed or hopeless'],
  options: ['Not at all', 'Several days', 'More than half the days', 'Nearly every day'],
}
