# Vire: build contract

Junction 2026, Aalto challenge "Beyond the Clinic": keep people well at home after TMS treatment for depression.
Judged 25% each on usefulness, ease of use, smart sensing, creativity. Deadline is hours away: working beats complete.

## The product in five lines

1. **Ping.** Once a day, 60 seconds, phone in hand, earbuds in. The app plays a fixed set of small stimuli and measures how the body answers: a nod, a smile to contagious laughter, one spoken sentence, two slow breaths.
2. **Echo.** The answer is four numbers (smile, voice, heart, move), each compared with *this person's own* baseline. It is the home version of the TMS-evoked response the Aalto lab measures with EEG: stimulate, read the response, adapt.
3. **Dose.** If the echo is flat, Vire offers one 3-minute thing through the same earbuds (slow breathing with heart feedback, a head-tracked forest where you find birds by turning your head, a tempo-led walk, a voice note to a friend), then re-measures with a 20 s mini ping.
4. **Learn.** A per-person bandit keeps what moved that person's echo. Nothing but numbers leaves the phone: no video, no audio.
5. **Clinic.** The echo is calibrated during the TMS course (ill to well = the person's "well signature"). At home, drift from that signature puts the person on the clinician's short list and can request a booster TMS session.

Honest framing everywhere: a measured loop, **not a diagnosis**. Never claim to detect depression.

## Layout and ownership

```
shared/types.ts        shared types. Source of truth. Do not change without telling the lead.
web/                   Vite + React 19 + TS. `base: './'` + HashRouter (runs under any path prefix).
  src/sense/           SENSE: camera face (MediaPipe), camera pulse (rPPG), voice, head, native bridge, feature math, /#/lab test page
  src/app/             APP: patient app: onboarding, ping flow, echo, doses, audio
  src/clinic/          CLINIC: clinician dashboard + live view
  src/shared/          theme.css (design tokens), api.ts (apiUrl/wsUrl/api helpers). Lead-owned; ask before changing.
  public/models/face_landmarker.task, public/wasm/   MediaPipe model + wasm, self-hosted
  public/audio/        stimuli and soundscapes (lead generates; see "Audio" below)
server/                SERVER: Bun + Hono + bun:sqlite. API, learning engine, synthetic cohort, live relay.
ios/                   lead: native shell (WKWebView + AirPods bridge)
```

Stay inside your folder. If you need something from another folder, write to the interface below and stub it.
No git commands (the lead commits). No new top-level dependencies beyond what your part needs; add with `bun add` in `web/` or `server/`.
TS config has `erasableSyntaxOnly` + `verbatimModuleSyntax`: no enums, use `import type`.

## Run

```
cd server && hsec exec --only CLIPROXY_API_KEY -- bun run index.ts     # API on 127.0.0.1:8871 (also serves web/dist)
cd web && bun run dev                                                   # http://127.0.0.1:5871, proxies /api to 8871
cd web && bun run build                                                 # tsc -b && vite build -> web/dist
```

Public URL: `https://vire.fly.dev/` (Fly app `vire`, `fly.toml`; data on its volume). The old `/vire` mount on the dev box redirects there (`scripts/moved.ts`).
The proxy strips `/vire`. All URLs in the web app must be relative: use `apiUrl()`, `wsUrl()`, `api()` from `src/shared/api.ts`
and `new URL('audio/x.mp3', document.baseURI)` for assets. Never a leading `/`.

Headless browser for tests: `/usr/bin/google-chrome` (and Playwright chromium in `~/.cache/ms-playwright`).
Fake camera/mic: `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-video-capture=<file.y4m|.mjpeg> --use-file-for-fake-audio-capture=<file.wav>`.

## Ping protocol v1 (`PING_PHASES` in shared/types.ts)

| phase | ms | what the person does | what is measured |
|---|---|---|---|
| settle | 8000 | looks at the screen, rests | resting smile level, resting pulse, stillness |
| nod | 6000 | "Nod when you're ready" | nod amplitude (deg), peak velocity (deg/s), count |
| laugh | 12000 | hears contagious laughter (starts at +1000 ms) | smile latency, peak, area, Duchenne (cheek raise), duration |
| speak | 12000 | answers one prompt out loud | speech fraction, pauses, pitch variability, syllable rate |
| breathe | 20000 | two slow breaths, 5 s in / 5 s out | heart-rate swing (max - min), resting bpm |

A **mini ping** is laugh (8 s) + one breath (10 s); same feature structs, voice/move left at their zero values.

Echo channel values (what the server baselines):
- `smile` = `smile.auc` (smile-seconds). Unit "smile·s".
- `voice` = `voice.f0SdSemitones` (falls back to `speechFraction * 4` when pitch is null). Unit "st".
- `heart` = `heart.swingBpm`. Unit "bpm". Null when quality < 0.3.
- `move` = `move.nodPeakVelDegS`. Unit "°/s".

Why these four (cite in UI copy where useful, never overclaim):
- Girard et al. 2014: the same 19 patients smiled less and moved their heads smaller and slower when severely depressed; both came back on remission.
- Speech rate, pauses and pitch variability track depression severity in several cohorts (RADAR-MDD and others).
- TMS on the left DLPFC slows the heart (frontal-vagal pathway; Iseger et al., replicated in healthy volunteers); slow-breathing heart swing is a standard vagal test.
- Many Smiles Collaboration (n=3,878): smiling lifts mood only slightly. Smile is a sensor here, not a therapy.

## Sense interface

`web/src/sense/types.ts` is the interface (`Sense`, `FaceFrame`, `HeadFrame`, `PulseSample`, `VoiceFrame`).
`web/src/sense/index.ts` exports `createSense(): Sense`. APP imports only from `../sense` and `@shared/types`.

Sources, in priority order:
- face: MediaPipe FaceLandmarker blendshapes from the front camera (`mouthSmileLeft/Right`, `cheekSquintLeft/Right`, `browDownLeft/Right`, `jawOpen`, `eyeBlink*`) + head pose from the facial transformation matrix.
- head: AirPods motion via the native bridge when present (25 Hz), else camera head pose.
- pulse: AirPods Pro 3 heart rate via the native bridge when present, else camera rPPG (POS or green-channel on forehead/cheek ROI, 0.7-3 Hz band).
- voice: mic via Web Audio (RMS, voicing, f0 by autocorrelation/YIN).

### Native bridge (iOS shell)

Present when `window.webkit?.messageHandlers?.vire` exists.

JS -> native: `window.webkit.messageHandlers.vire.postMessage({ cmd })` with
`{cmd:'start'}`, `{cmd:'stop'}`, `{cmd:'heart', on:boolean}`.

native -> JS: calls `window.__vireNative(msg)`; `t` is epoch ms (`Date.now()` clock):
- `{k:'caps', airpodsMotion:boolean, airpodsHr:boolean}`
- `{k:'head', s:[[t,pitchDeg,yawDeg,rollDeg,ax,ay,az,rxDegS,ryDegS,rzDegS], ...]}` batched every ~100 ms, 25 Hz samples, acceleration in g, rotation rate in deg/s
- `{k:'hr', t, bpm}`
- `{k:'status', airpods:'connected'|'disconnected', hr:'off'|'starting'|'on'|'denied'}`

## Server API (JSON, all under `/api`)

Types are in `shared/types.ts`.

| method | path | body -> response |
|---|---|---|
| POST | `/api/users` | `{ name?: string, clinicCode?: string }` -> `{ userId: string, name: string }` |
| POST | `/api/pings` | `PingUpload` -> `Echo` |
| GET | `/api/users/:id/echoes` | -> `Echo[]` (oldest first) |
| POST | `/api/doses` | `DoseUpload` -> `DoseResult` |
| GET | `/api/users/:id/suggestion` | -> `DoseSuggestion \| null` |
| GET | `/api/users/:id/notice` | -> `{ booster: boolean, message: string \| null }` (clinic asked for a check-in) |
| GET | `/api/clinic/patients` | -> `PatientRow[]` sorted by priority desc |
| GET | `/api/clinic/patients/:id` | -> `PatientDetail` |
| POST | `/api/clinic/patients/:id/booster` | `{ on: boolean }` -> `{ ok: true }` |
| WS | `/api/live?room=CODE&role=sensor\|viewer&name=NAME` | relays `LiveMessage` JSON from sensors to viewers in the room |
| GET | `/api/live/rooms` | -> `{ code: string, name: string, since: string }[]` rooms with a connected sensor, newest first |
| GET | `/api/health` | -> `{ ok: true }` |

Room code for a person = first 6 chars of `userId`, uppercased. The clinic page can open `#/clinic/live/CODE`.

Learning engine (server):
- Baseline per person per channel: median + MAD over that person's pings (clinic-setting "well" pings at the end of the course define the signature; otherwise the first 7 home pings). Under 3 pings: status `calibrating`, strength from population priors.
- `z` = (value - center) / spread. `strength` = clamp(50 + 15*z, 0, 100). Overall = mean of available channels.
- `drift` = EWMA (alpha 0.3) of the daily mean z. `status`: `steady` (drift > -0.75), `dipping` (-0.75..-1.5), `low` (< -1.5 for 3+ days).
- Dose bandit: Thompson sampling, Normal-Gamma posterior per (person, dose) on reward = post strength - pre strength, prior from the cohort mean.
- LLM (short patient message, clinician summary/reason): Claude through the seat pool only: `ANTHROPIC_BASE_URL=http://127.0.0.1:8317`, key env `CLIPROXY_API_KEY`. Always have a deterministic fallback string; never block a response on the LLM for more than 4 s.

## Design

Tokens in `web/src/shared/theme.css` (import it once in `main.tsx`, already done). Warm paper, ink, one ember accent, Fraunces for display, Inter for UI.
The four channel colours are fixed: smile amber, voice teal, heart rose, move indigo.
The ping itself runs on the dark "stage" tokens. Phone first (360-430 px wide); the clinic view is desktop first.
People recovering from depression use this daily: one thing per screen, large touch targets, no streak-shaming, no red alarms on the patient side, plain words.
Voice: second person, warm, short. "Your smile came a little slower today." Not "Smile latency +0.4 s".

## Audio (in `web/public/audio/`, lead generates)

`laugh-1.mp3` .. `laugh-3.mp3` (contagious laughter, 8-10 s), `chime.mp3`, `breath-in.mp3`, `breath-out.mp3`,
`forest-bed.mp3` (loopable ambience), `bird-1.mp3` .. `bird-6.mp3` (single bird calls, mono, for spatial placement), `stream.mp3`,
`found.mp3` (sparkle when a bird is found),
voice guide lines `vo-settle.mp3`, `vo-nod.mp3`, `vo-listen.mp3` (before the laughter), `vo-speak-1.mp3`..`vo-speak-3.mp3`, `vo-breathe.mp3`, `vo-in.mp3`, `vo-out.mp3`, `vo-done.mp3`, `vo-mini.mp3`,
`vo-dose-breathe.mp3`, `vo-dose-forest.mp3`, `vo-dose-walk.mp3`, `vo-dose-reach.mp3`. All of these exist now (texts in `assets/gen_audio.py`).
Until they exist, code must not crash on a missing file (catch the fetch/decode error and carry on silently).

## Round 2 (Friday night): proof, hardening, the hall wall, the science page

The loop works end to end (see `web/tests/e2e/full-loop.mjs`). Nothing has been tried on a real face yet and Touko has no
time to recruit people or talk to mentors, so this round gets the evidence and the robustness without him.
Submission closes Sunday 15.11 at 10:00; in-person peer review at our table (A157) runs 10:00-14:00.

Ownership this round (stay inside it; no git commands; the lead builds `web/dist` and commits):

| name | owns | dev port |
|---|---|---|
| VALIDATE | `validation/`, `web/src/sense/`, `web/tests/sense/`, writes `web/public/validation.json` | 5872 |
| HARDEN | `web/src/app/` | 5873 |
| WALL | `web/src/wall/`, `server/`, `web/src/clinic/Today.tsx` + `data.ts` (small changes), may append types to `shared/types.ts` | 5874 |
| SCIENCE | `web/src/science/`, `pitch/` | 5875 |
| TUNE | `web/src/tune/`, `web/tests/tune/` | 5876 |
| STAGE | `web/src/clinic/Live.tsx` and new files under `web/src/clinic/stage/` | 5877 |
| lead | `shared/`, `ios/`, `CONTRACT.md`, `web/src/App.tsx`, `web/index.html` | |

Do not run `bun run build` (it writes `web/dist`, which is live at the public URL). Typecheck with `bunx tsc -b --noEmit`;
if you need a production build, use `bunx vite build --outDir /tmp/<yourname>-dist`.
The server runs as the systemd user unit `vire-server` (`bun --watch`, reloads on save; `systemctl --user restart vire-server`,
log in `server/server.log`). Do not start another server on 8871; use 8872 for a test instance with a temp DB.

Shared additions:
- `PingUpload.unreadable?: Channel[]` (already in `shared/types.ts`): channels the phone could not measure. Server: value null for those.
- `POST /api/users` also takes `visitor?: boolean`. Visitors are hall guests: they appear on the wall, not in the clinic lists.
- Visitor entry URL (the QR on the wall and poster): `<base>#/visit`. HARDEN builds that flow inside the patient app.
- `GET /api/wall` -> `WallState` (WALL defines the type in `shared/types.ts`).
- `web/public/validation.json` (VALIDATE writes, SCIENCE reads with `fetch(new URL('validation.json', document.baseURI))`, every field optional):
  ```
  { "generatedAt": ISO,
    "pulse": { "dataset", "url", "subjects", "minutes", "maeBpm", "rmseBpm", "within5Pct", "coveragePct", "reference", "note" },
    "smile": { "clips", "people", "sensitivityPct", "falsePositivePct", "faceFoundPct", "source", "note" },
    "robustness": [ { "condition", "faceFoundPct", "pulseCoveragePct", "smileSensitivityPct" } ],
    "limits": [ string ] }
  ```
Honesty rule for every number and sentence: we validate that the sensors read the body correctly; the link to depression is cited
literature, not our result. Hall data shows tiredness over a hackathon weekend, never depression.

### What Touko asked for on Friday night (this outranks everything else in round 2)

1. It must work very well and the demo must be **visual**. He demos it himself with **AirPods Pro 3 in his ears** (native shell
   on his iPhone: AirPods head motion at 25 Hz and AirPods heart rate; the camera fills in when they are absent).
2. A **personal face model as the onboarding step**: he makes a few faces (rest, big smile, sad, angry, surprised) and Vire learns
   his face and its muscles, then uses that model from then on.

How that becomes product:
- **Tune** (TUNE builds, HARDEN mounts it in onboarding and settings): 5 faces, about 3 s each, drawn live as a glowing wireframe
  of his own face with the working muscle groups lit. A model is trained in the browser in under a second. It gives
  (a) his own range per muscle group, so every reading is "share of your own biggest smile", (b) a small classifier that
  reads which of the five faces is on now, with an honest held-out accuracy, and (c) when AirPods motion is present, an
  **ear model**: the camera's smile signal is the teacher and the AirPods motion (attitude, acceleration, rotation rate) is
  the student, so the AirPods learn to feel his smile with no camera. Show its held-out accuracy and hide it when it is poor.
  Science behind (c): ExpressEar (earbud IMU, 32 facial action units, 89.9% per user but 42.1% across users: it only works
  personalised) and Kinetic Earables (Lee 2019: smile and talk from an in-ear IMU, F1 0.85 sitting).
  Honest wording: we measure muscle movement against the person's own range. We do not read emotions; "sad" and "angry" are
  faces he was asked to make, used to find the range of the brow-lowering and lip-corner muscles (FACS AU4, AU15, AU12, AU6, AU1+2).
- **Stage** (STAGE builds): the big-screen mirror becomes the visual centre of the pitch: his face as a wireframe with muscles
  lighting up, his head turning in 3D from the AirPods, the heartbeat, the voice, the echo forming. A wireframe, never the picture.
- Shared types for this are in `shared/types.ts`: `MUSCLES`, `TUNE_FACES`, `LiveFrame` extras, `LiveMesh`, the `tune` live message,
  and `PingFeatures.muscles / faces / earSmileAuc`.
- Sense additions (done by the lead, in `web/src/sense/types.ts`): `sense.setDetail(true)` puts `detail: { blend, mesh }` on face
  frames (all blendshapes in `sense.blendNames()` order + the 478-point mesh); `sense.setCalibration({ smile:[rest,max], brow:[rest,max] })`
  scales `FaceFrame.smile` / `brow` and the ping's smile features to the person's own range; `HeadFrame.rx/ry/rz` is the AirPods
  rotation rate in deg/s (native shell v2 sends rows of 10 numbers).

`web/src/tune/index.ts` exports (TUNE writes it; HARDEN and STAGE import from `../tune`; do not reach into its other files):
```ts
export interface PersonalModel { version: 1; at: string; calibration: FaceCalibration; accuracy: number; earAccuracy: number | null /* + whatever TUNE needs */ }
export function loadModel(): PersonalModel | null            // localStorage key 'vire.model'
export function saveModel(m: PersonalModel): void
export function clearModel(): void
/** live reader: feed it frames, get muscles (MUSCLES order, 0..1 of own range), the face read, and the ear model's smile */
export function createReader(model: PersonalModel | null): {
  face(f: FaceFrame, blendNames: string[]): { muscles: number[]; face: { label: TuneFace; p: number } | null }
  head(h: HeadFrame): number | null                           // earSmile 0..1, null when there is no ear model
}
/** full-screen onboarding step. `sense` is already started (camera on); TuneFlow turns detail on and off itself. */
export function TuneFlow(props: { sense: Sense; onDone(model: PersonalModel): void; onSkip(): void; onLive?(msg: LiveMessage): void }): JSX.Element
/** the wireframe face with muscle groups lit. mesh = 478 x,y,z triples (image-normalised floats, or the x1000 ints of LiveMesh). */
export function MuscleMap(props: { mesh: ArrayLike<number> | null; muscles: number[] | null; scale?: 1 | 1000; mirrored?: boolean; className?: string }): JSX.Element
```
TUNE writes `MuscleMap` and the exported signatures first (within about 30 minutes) so HARDEN and STAGE can build against them.
The lead has put compiling stubs in `web/src/tune/index.ts`; TUNE replaces the bodies. `MuscleMap` with `mesh: null` draws a built-in
neutral face (so mock mode and an idle stage always have a face); `createReader().face()` works on frames without `detail`.
Routes: `/#/tune` is TUNE's standalone page (`web/src/tune/TuneLab.tsx`), `/#/wall/*` is WALL's (`/#/wall/poster` = printable poster).
Voice lines for Tune (lead generates into `web/public/audio/`, play them like the others, silent when missing): `vo-tune-intro`,
`vo-tune-rest`, `vo-tune-smile`, `vo-tune-sad`, `vo-tune-angry`, `vo-tune-surprised`, `vo-tune-done`.
Live mirror split: the patient app's session sends `LiveFrame` (with `muscles`, `face`, `earSmile`) and `LiveMesh`; TuneFlow only emits
the `tune` messages through `onLive`.

