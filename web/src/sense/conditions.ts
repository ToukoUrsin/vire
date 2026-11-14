// When to ask the person to fix the picture before trusting the readings. The limits are measured, not guessed:
// validation/README.md ("Thresholds") has the numbers behind each one. Pure functions, no browser needed.
//
//   const issues = cameraIssues((sense as SenseWithDebug).debug(), lastFaceFrame)
//   if (issues.includes('too-dark')) ...
//
// Readings are still produced outside the limits; they were measurably worse there on real video.

import type { SenseDebug } from './index'

export const CAMERA_LIMITS = {
  /** cheek-to-cheek face width in camera pixels. Below it a neutral face was read as a smile 28 % of the time (6 % above). */
  minFaceWidthPx: 100,
  /** head turn away from the camera, degrees. Smile false positives: 8 % under 10 deg, 17 % at 10-20, 29 % beyond. */
  maxYawDeg: 20,
  /** mean skin brightness, 0..255. Around 16 the face was found in only 55 % of frames; from 33 up in 94 % or more. */
  minSkinLuma: 40,
  /**
   * Below this the camera pulse is untested: it was measured on faces at 87-184. Brightness alone is not enough, though.
   * What stops the pulse is camera noise (a number shown 82 % of the time on clean video, 23 % with noise of 3 grey
   * levels, never a wrong one), and a camera short of light adds noise. Smile and face tracking are fine here.
   */
  pulseSkinLuma: 80,
} as const

export type CameraIssue =
  /** no face in the picture */
  | 'no-face'
  /** face smaller than minFaceWidthPx: come closer */
  | 'too-far'
  /** head turned more than maxYawDeg: face the camera */
  | 'turned'
  /** skin darker than minSkinLuma: face tracking and smile start to fail */
  | 'too-dark'
  /** skin darker than pulseSkinLuma: expect no heart rate from the camera */
  | 'dim-for-pulse'

/** mean skin brightness 0..255 from the pulse patches (Rec. 601 luma), null without a reading */
export function skinLuma(rgb: [number, number, number] | null): number | null {
  return rgb ? 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] : null
}

/** what is wrong with the picture right now, most serious first; empty when the conditions match what was validated */
export function cameraIssues(d: Pick<SenseDebug, 'faceW' | 'rgb'>, face: { present: boolean; yaw: number } | null): CameraIssue[] {
  if (!face || !face.present || !(d.faceW > 0)) return ['no-face']
  const out: CameraIssue[] = []
  const luma = skinLuma(d.rgb)
  if (luma !== null && luma < CAMERA_LIMITS.minSkinLuma) out.push('too-dark')
  if (d.faceW < CAMERA_LIMITS.minFaceWidthPx) out.push('too-far')
  if (Math.abs(face.yaw) > CAMERA_LIMITS.maxYawDeg) out.push('turned')
  if (luma !== null && luma >= CAMERA_LIMITS.minSkinLuma && luma < CAMERA_LIMITS.pulseSkinLuma) out.push('dim-for-pulse')
  return out
}
