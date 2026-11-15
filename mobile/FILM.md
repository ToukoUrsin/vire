# Vire film, 1:57

The film is built, not shot. Nothing more needs filming.

It lives outside git because it is large: `/bulk2/runs/depression/film/launch/`

- `vire-film/` is the HyperFrames project. `index.html` is the cut, `compositions/` has one file per scene.
- `clips/` holds the phone app's screens, recorded from this build by `mobile/scripts/capture.mjs`.
- `vire-film/out/vire-launch.mp4` is the film.

## The cut

| At | Scene | What is on screen |
| --- | --- | --- |
| 0:00 | Opening | The 11 s opening clip. |
| 0:11 | Team | Take 2 (`IMG_0743.MOV`): Anni, Manu, Touko, "something almost everyone has", AirPods. |
| 0:22 | Teach | "This is Vire." One minute with the camera: nod, shake your head, smile. 366 models tried in 46 seconds. Runs on Modal: one locked Sandbox per person. |
| 0:41 | Proof | Touko's own check with the camera off: 3 of 3 nods, 3 of 3 head shakes, nothing heard outside an ask. Smiles stay with the camera. Then 50 simulated patients, one Sandbox each. |
| 0:59 | The app | The day, calls, music, sleep, a practice and its result, the clinic. "Sample data" stays on screen the whole time. |
| 1:36 | Close | "A loop that closes. Your AirPods sense every step." 60 studies, the paper, `vire.fly.dev/app`. |
| 1:53 | End | The team waves, then the end card. |

## What is real and what is sample

Real: the teaching minute, the model search on Modal (366 models in 46 s), the camera-off check drawn from its recording, the 50-patient simulated clinic, the 60 studies and the paper.

Sample: every screen between 0:59 and 1:36. No patient or clinic has used Vire.

## Rules the film keeps

- No caption says detect, cure, treat or remediate. The team says "track and remediate" aloud in the take; it is not written on screen.
- Modal is named wherever a model is trained or Sandboxes are shown.
- Vire senses all the time the AirPods are in, not only when the app is on screen.
- A signal for the clinic, not a diagnosis. A practice is not a treatment.

## To change it

1. Build the app and serve the build: `bun run build`, then `node_modules/.bin/vite preview --port 5883 --host 127.0.0.1`.
2. Record a scene: `node scripts/capture.mjs <scene>` (scenes are in `scripts/scenes.mjs`). Timing shifts a little between runs, so check each tap against its scene file afterwards.
3. In `vire-film/`: `npx hyperframes check`, then `npx hyperframes render -o out/vire-launch.mp4 -f 30 --video-frame-format png`.
4. The film's own notes are in `vire-film/REVIEW.md`.
