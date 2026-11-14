// The clinic re-trains every patient at once: one network-blocked sandbox per patient, all started together.
// The patients of such a run are always simulated (a script makes their teaching minutes and practice history), never people.
import type { SessionKind } from './earsession'

export type CohortState = 'queued' | 'running' | 'done' | 'failed'
export type CohortPatientState = 'waiting' | 'running' | 'done' | 'failed'

/**
 * What helps this simulated patient most, learned again in the patient's sandbox from their simulated practice history
 * (sandbox/works.py, the same learner as shared/earlearn.ts). Said only as far as the counts allow.
 */
export interface CohortWorks {
  /** the practice with the highest believed score among those tried; null before any */
  best: SessionKind | null
  said: 'learned' | 'leaning' | 'early'
  /** how often `best` came out on top over 2,000 draws, 0..1 */
  sure: number
  /** what the app would offer next */
  next: SessionKind
  /** practices that could be scored, all kinds */
  total: number
  /** per kind: how many practices, and their mean score (percent stiller after than before; null when none) */
  kinds: { kind: SessionKind; n: number; mean: number | null }[]
}

export interface CohortPatient {
  /** 1-based number of the simulated patient */
  n: number
  state: CohortPatientState
  /** models tried for this patient so far */
  tried: number
  /** seconds this patient's sandbox has been searching */
  seconds: number
  /** the held-out score of the model found (mean over smile, nod, head shake), null until done */
  auc: number | null
  /** what helps this patient most, once the sandbox has learned it again */
  works?: CohortWorks
}

/** where the sandboxes ran: Modal, or this worker's own machine (VIRE_MODAL_LOCAL=1, a test run) */
export type CohortWhere = 'modal' | 'local'

export interface CohortRun {
  id: string
  state: CohortState
  /** always true: every patient in a cohort run is made by a script */
  simulated: true
  patients: CohortPatient[]
  /** when the run was asked for */
  at: number
  /** when a worker took it */
  startedAt: number | null
  endedAt: number | null
  /** wall seconds since the worker took it */
  seconds: number
  /** sandboxes running right now */
  sandboxes: number
  /** the most sandboxes that ran at the same moment */
  peak: number
  /** models tried, all patients together */
  tried: number
  where: CohortWhere | null
  /** times the sandbox provider refused to start a sandbox at first (each was tried again) */
  refused: number
  error?: string
}

/** what a worker gets when it claims a run */
export interface CohortClaim {
  id: string
  patients: number
  /** seeds the simulated minutes, so two runs differ */
  seed: number
}

/** what a worker posts while the run goes, and with done */
export interface CohortProgress {
  patients: CohortPatient[]
  seconds: number
  sandboxes: number
  peak: number
  where: CohortWhere
  refused?: number
}

export const COHORT_DEFAULT = 50
export const COHORT_MAX = 60
