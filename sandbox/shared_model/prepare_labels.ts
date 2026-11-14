// Add the exact Vire camera/microphone labels to an experiment envelope before
// it enters the network-blocked per-person sandbox.  The recordings themselves
// are never written to the repository.
import { makeEarLabels } from '../../web/src/tune/ear/labels'

const input = process.argv[2]; const output = process.argv[3]
if (!input || !output) throw new Error('usage: bun prepare_labels.ts in.json out.json')
const envelope = await Bun.file(input).json() as { minutes?: any[]; recording?: any }
const minutes = envelope.minutes ?? (envelope.recording ? [envelope.recording] : [])
for (const rec of minutes) (rec as any)._labels = makeEarLabels(rec)
await Bun.write(output, JSON.stringify({ minutes }))
