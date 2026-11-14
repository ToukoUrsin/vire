// One small authored icon set: 24 px grid, 1.6 stroke, round joins.
import type { ReactNode } from 'react'
import type { DoseKind } from '@shared/types'

function Svg({ children, size = 24 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const IconClose = () => (
  <Svg>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
)
export const IconSettings = () => (
  <Svg>
    <path d="M4 8h9M17 8h3M4 16h3M11 16h9" />
    <circle cx="15" cy="8" r="2" />
    <circle cx="9" cy="16" r="2" />
  </Svg>
)
export const IconArrow = () => (
  <Svg size={20}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
)
export const IconCheck = () => (
  <Svg size={20}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
)

const DOSE_PATHS: Record<DoseKind, ReactNode> = {
  // three slow waves
  breathe: <path d="M3 8c3-3 6 3 9 0s6 3 9 0M3 13c3-3 6 3 9 0s6 3 9 0M3 18c3-3 6 3 9 0s6 3 9 0" />,
  // a smile line under two eyes
  smile: (
    <>
      <path d="M7 13.5c1.4 2.4 3 3.5 5 3.5s3.6-1.1 5-3.5" />
      <path d="M8.5 8.5v1M15.5 8.5v1" />
    </>
  ),
  // a leaf with its vein
  forest: (
    <>
      <path d="M5 19C5 10 10 5 19 5c0 9-5 14-14 14z" />
      <path d="M5 19l9-9" />
    </>
  ),
  // two footsteps
  walk: (
    <>
      <ellipse cx="8.5" cy="14" rx="2.6" ry="4" transform="rotate(-12 8.5 14)" />
      <ellipse cx="15.5" cy="9" rx="2.6" ry="4" transform="rotate(12 15.5 9)" />
    </>
  ),
  // a speech bubble with a small voice wave
  reach: (
    <>
      <path d="M4 6.5A2.5 2.5 0 016.5 4h11A2.5 2.5 0 0120 6.5v7a2.5 2.5 0 01-2.5 2.5H11l-4.5 4v-4A2.5 2.5 0 014 13.5z" />
      <path d="M9 10v1M12 8.5v4M15 10v1" />
    </>
  ),
  wait: <circle cx="12" cy="12" r="7" />,
}

export function DoseIcon({ dose, size = 24 }: { dose: DoseKind; size?: number }) {
  return <Svg size={size}>{DOSE_PATHS[dose]}</Svg>
}
