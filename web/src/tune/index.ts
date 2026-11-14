// The personal face model: public surface of web/src/tune. Signatures are fixed by CONTRACT.md
// ("What Touko asked for on Friday night"). Import from here only; the other files in this folder may change.
//
//   model.ts      what a frame looks like to the model, training, the held-out checks, the live reader (pure maths)
//   MuscleMap.tsx the wireframe face with the muscle groups lit
//   TuneFlow.tsx  the onboarding step
//   TuneLab.tsx   /#/tune, the standalone page
export type { EarModel, FaceClassifier, MuscleRange, PersonalModel, Reader, ReaderOptions } from './model'
export { createReader } from './model'
export { MuscleMap, MUSCLE_NAMES } from './MuscleMap'
export type { MuscleMapProps } from './MuscleMap'
export { TuneFlow } from './TuneFlow'
export type { TuneFlowProps } from './TuneFlow'
export { clearModel, loadModel, saveModel } from './store'
