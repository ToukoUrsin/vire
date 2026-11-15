// One drawn set: 24 px, 1.6 px stroke, round caps. Nothing borrowed, no emoji.
import type { ReactNode, SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }
const make =
  (body: ReactNode, fill = false) =>
  ({ size = 24, ...rest }: P) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {body}
    </svg>
  )

export const I = {
  // tabs
  today: make(
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 3.8a8.2 8.2 0 0 1 7.1 4.1" strokeWidth={3.2} />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </>,
  ),
  signals: make(<path d="M3 13h3l2.2-6 3.4 11 2.6-8 1.6 3H21" />),
  practices: make(
    <>
      <circle cx="12" cy="12" r="2.6" />
      <circle cx="12" cy="12" r="5.8" opacity=".7" />
      <circle cx="12" cy="12" r="9" opacity=".4" />
    </>,
  ),
  care: make(<path d="M4.5 6.5a2.5 2.5 0 0 1 2.5-2.5h10a2.5 2.5 0 0 1 2.5 2.5v7a2.5 2.5 0 0 1-2.5 2.5h-5l-4.2 3.6V16H7a2.5 2.5 0 0 1-2.5-2.5z" />),
  you: make(
    <>
      <circle cx="12" cy="8.4" r="3.6" />
      <path d="M4.8 20c.9-3.6 3.7-5.6 7.2-5.6s6.3 2 7.2 5.6" />
    </>,
  ),

  // senses
  airpods: make(
    <>
      <path d="M8.6 4.2a3.4 3.4 0 0 0-3.4 3.4v2.2a2.6 2.6 0 0 0 2.6 2.6h.6v6.2a1.3 1.3 0 0 0 2.6 0V6.6a2.4 2.4 0 0 0-2.4-2.4z" />
      <path d="M15.4 4.2a3.4 3.4 0 0 1 3.4 3.4v2.2a2.6 2.6 0 0 1-2.6 2.6h-.6v6.2a1.3 1.3 0 0 1-2.6 0V6.6a2.4 2.4 0 0 1 2.4-2.4z" />
    </>,
  ),
  face: make(
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M8.4 14.2c.9 1.5 2.1 2.2 3.6 2.2s2.7-.7 3.6-2.2" />
      <path d="M9 9.6v.6M15 9.6v.6" strokeWidth={2} />
    </>,
  ),
  voice: make(<path d="M4 12v0M7.2 9v6M10.4 5.5v13M13.6 8v8M16.8 10.2v3.6M20 12v0" strokeWidth={1.9} />),
  move: make(
    <>
      <circle cx="13.6" cy="4.8" r="1.7" />
      <path d="M9 21l2.4-5.2-2-3 1.2-4.4 3.4-.4 1.8 3.2 2.8 1M10.6 8.4L7.4 9.8l-1 3M13.6 14.6l2.2 2.2.8 4.2" />
    </>,
  ),
  heart: make(<path d="M12 19.6s-7.4-4.3-7.4-9.7a4 4 0 0 1 7.4-2.1 4 4 0 0 1 7.4 2.1c0 5.400-7.400 9.700-7.400 9.700z" />),
  call: make(<path d="M6.200 3.800l2.600-.400 1.700 4-2 1.600a11 11 0 0 0 6.500 6.500l1.600-2 4 1.700-.400 2.600a2.300 2.300 0 0 1-2.500 2A16 16 0 0 1 4.200 6.300a2.300 2.300 0 0 1 2-2.500z" />),
  music: make(
    <>
      <path d="M9.400 17.400V6.200l9.200-2v10.600" />
      <circle cx="7" cy="17.400" r="2.400" />
      <circle cx="16.200" cy="14.800" r="2.400" />
    </>,
  ),
  sleep: make(<path d="M19.400 14.200A8 8 0 0 1 9.800 4.600a8 8 0 1 0 9.600 9.600z" />),
  nod: make(
    <>
      <path d="M12 4v16M8 7.800L12 4l4 3.800M8 16.200L12 20l4-3.800" />
    </>,
  ),
  shake: make(
    <>
      <path d="M4 12h16M7.800 8L4 12l3.800 4M16.200 8L20 12l-3.800 4" />
    </>,
  ),
  smile: make(
    <>
      <path d="M5.500 10.500c1.600 4.600 3.800 6.500 6.500 6.500s4.900-1.900 6.500-6.500" strokeWidth={2} />
    </>,
  ),

  // practices
  breath: make(
    <>
      <path d="M3.500 9.500h9.700a2.700 2.700 0 1 0-2.600-3.400" />
      <path d="M3.500 13.500h13.200a2.900 2.900 0 1 1-2.800 3.700" />
      <path d="M3.500 17.500h6" />
    </>,
  ),
  body: make(
    <>
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7.600v7M7 10l5-.800 5 .800M12 14.600L9.400 20.500M12 14.600l2.600 5.900" />
      <path d="M3.500 12.500h2.400M18.100 12.500h2.400" opacity=".55" />
    </>,
  ),
  sit: make(
    <>
      <circle cx="12" cy="5.400" r="2.200" />
      <path d="M12 8.400v5.200M12 9.800l-4.400 3.400M12 9.800l4.400 3.400M5 18.600c2-1.800 4.300-2.600 7-2.600s5 .800 7 2.600" />
    </>,
  ),
  stretch: make(
    <>
      <circle cx="6.400" cy="7.200" r="2" />
      <path d="M8 9.200l3.600 4.400h8.900M11.600 13.600L9 19.500M14 13.600l1.800 5.900M8.600 10l5-4.600" />
    </>,
  ),
  walk: make(
    <>
      <path d="M8.400 4.500c1.700 0 2.900 1.500 2.900 3.800s-1.100 3.700-2.600 3.700S6 10.600 6 8.300s.800-3.800 2.400-3.800zM6.300 14.200l4.200-.300.300 2.300a2.200 2.200 0 0 1-4.300.600z" />
      <path d="M15.800 8c-1.700 0-2.900 1.500-2.900 3.800s1.100 3.700 2.600 3.700 2.700-1.400 2.700-3.700-.800-3.800-2.400-3.800zM17.900 17.700l-4.200-.300-.300 2.300a2.200 2.200 0 0 0 4.300.600z" opacity=".7" />
    </>,
  ),

  // interface
  right: make(<path d="M9.500 5.500L16 12l-6.500 6.500" />),
  left: make(<path d="M14.500 5.500L8 12l6.500 6.500" />),
  down: make(<path d="M5.500 9.500L12 16l6.500-6.500" />),
  close: make(<path d="M6 6l12 12M18 6L6 18" />),
  check: make(<path d="M5 12.600l4.400 4.400L19 7.400" strokeWidth={2} />),
  plus: make(<path d="M12 5v14M5 12h14" />),
  play: make(<path d="M8 5.200v13.600a.600.600 0 0 0 .900.500l11-6.800a.600.600 0 0 0 0-1L8.900 4.700a.600.600 0 0 0-.900.500z" />, true),
  pause: make(<path d="M7 5h3.400v14H7zM13.600 5H17v14h-3.400z" />, true),
  info: make(
    <>
      <circle cx="12" cy="12" r="8.600" />
      <path d="M12 11v5.400M12 7.600v.200" strokeWidth={1.900} />
    </>,
  ),
  lock: make(
    <>
      <rect x="5.500" y="10.500" width="13" height="9.500" rx="2.400" />
      <path d="M8.500 10.500V8a3.500 3.500 0 0 1 7 0v2.500" />
    </>,
  ),
  box: make(
    <>
      <path d="M12 3.400l7.600 4.300v8.600L12 20.600l-7.600-4.300V7.700z" />
      <path d="M4.400 7.700L12 12l7.600-4.300M12 12v8.600" />
    </>,
  ),
  paper: make(
    <>
      <path d="M7 3.500h7l4.500 4.500v10.500a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z" />
      <path d="M14 3.500V8h4.500M8.500 12.500h7M8.500 16h5" />
    </>,
  ),
  camera: make(
    <>
      <path d="M4 8.500a2 2 0 0 1 2-2h1.800L9.200 4.500h5.600l1.400 2H18a2 2 0 0 1 2 2v8.500a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="12.600" r="3.300" />
    </>,
  ),
  calendar: make(
    <>
      <rect x="4" y="5.500" width="16" height="14.500" rx="2.500" />
      <path d="M4 10h16M8.500 3.500v3.500M15.500 3.500v3.500" />
    </>,
  ),
  clock: make(
    <>
      <circle cx="12" cy="12" r="8.600" />
      <path d="M12 7.400V12l3.200 2" />
    </>,
  ),
  shield: make(<path d="M12 3.400l7 2.600v5.400c0 4.300-2.800 7.600-7 9.200-4.200-1.600-7-4.900-7-9.200V6z" />),
  share: make(
    <>
      <path d="M12 15V3.600M8 7.400l4-3.800 4 3.800" />
      <path d="M7.500 11H6.200A1.700 1.700 0 0 0 4.500 12.700v6.100a1.700 1.700 0 0 0 1.700 1.700h11.600a1.700 1.700 0 0 0 1.700-1.700v-6.100A1.700 1.700 0 0 0 17.800 11h-1.300" />
    </>,
  ),
  out: make(<path d="M9.500 5.500H6.500a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3M13 4.500h6.500V11M19.500 4.500l-8.500 8.500" />),
  loop: make(
    <>
      <path d="M19.500 12a7.500 7.500 0 0 1-13.300 4.800M4.500 12a7.500 7.500 0 0 1 13.300-4.800" />
      <path d="M18.500 3.600v4h-4M5.500 20.400v-4h4" />
    </>,
  ),
  clinic: make(
    <>
      <path d="M4.500 20V8.600L12 4l7.500 4.600V20z" />
      <path d="M12 10.500v5M9.500 13h5" strokeWidth={1.900} />
    </>,
  ),
  send: make(<path d="M4.500 11.600L19.500 4.500l-5.100 15-3.100-6.300z" />),
  spark: make(<path d="M4 16.500l4.200-5 3.600 3 4.400-7.500L20 10.500" />),
}
export type IconName = keyof typeof I
