// The measures live in shared/earday.ts: the server works out the same numbers for the clinic's screen.
// (a plain path, not @shared: bun runs the tests and the search's command line without the alias)
export { earMeasures } from '../../../../shared/earday'
export type { EarDay } from '../../../../shared/earday'
