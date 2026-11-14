// A hyphenated word ("re-learned", "PHQ-2", "cut-off") stays whole: a line never breaks at its hyphen.
import type { ReactNode } from 'react'

export const whole = (t: string): ReactNode[] =>
  t.split(/(\b\w+-\w+\b)/).map((part, i) => (i % 2 ? <span key={i} className="nb">{part}</span> : part))
