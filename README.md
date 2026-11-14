# Vire

Like Meru Health, but your AirPods sense every step. For people at home after TMS, a clinic treatment for depression.

A year after a TMS course, it has stopped working for about half of the people it helped (46.3% still respond at 12 months, Senova et al. 2019). Once you're home, the clinic doesn't see you.

Vire runs while your AirPods are in. Two loops:

- **You, in the AirPods, camera off.** Vire senses head movement, how long the head is down, walks, nods and, on AirPods Pro 3, heart rate, and sets them against your own usual. When that drifts, it offers a short practice in your ears (slow breathing, a body scan or a short walk), measures what it did from the AirPods, and learns which practice works for you and how long.
- **Your clinic.** Drift the practices don't fix goes to the top of the clinic's list with what was tried and what worked, and the clinic can book a TMS booster then, not on a fixed schedule.

A signal for the clinic, not a diagnosis. No patient or clinic has used Vire; the clinic's patients are simulated.

**Today** ([/#/today](https://vire.fly.dev/#/today), in the iPhone app or in Chrome on a Mac with the Vire Ears helper), about five minutes: 65 seconds of asked smiles, nods and head shakes against your own earlier minutes, a 22-second still check (head movement and heart rate), a practice of about two and a half minutes, the same check again, and a result said only from the heart-rate and stillness change ("Calmer after", "Not calmer today", "Mixed today", "No change today"). For breathing, a sea in the ears rises on the in-breath and falls on the out-breath; it starts at your own pace and steps down toward six a minute only when the AirPods read your breath following it (or a still head, when no breath can be read), and eases back after two misses. A walk counts only when the AirPods felt steps for a third of it. The learner says "Vire learned: for you, X helps most" only after 3 scored practices of the best kind, 2 each of two kinds, and that one on top in 80% of 2,000 draws. Heart rate comes from AirPods Pro 3 through an iPhone workout session, and the app checks the source is the AirPods. It runs while Vire is open, not in the background. So far it has run end to end with stand-in AirPods in tests.

**The sound** is made on a Modal GPU by MusicGen-small on a T4: thirty 20-second pieces made ahead, and new ones asked for during a practice from the pace and stillness the AirPods just read. The phone places it around the head and holds it in the room as you turn, from the AirPods' own head angles. A bell marks the steps; no voice.

**Your day** ([/#/day](https://vire.fly.dev/#/day), also on the Today screen): one record a minute while the AirPods are in and Vire is open (time worn, walks, calls, head down, head movement), against the middle of your own earlier days, and at most one offered practice in half an hour, with its numbers.

**Setup, once** ([/#/ears](https://vire.fly.dev/#/ears)): the camera labels 65 seconds of smiles, nods and head shakes while the AirPods feel them, and a Modal Sandbox of your own, network blocked, tries 366 models on all your minutes, each chosen without the minute it is scored on. On the founder's three minutes: 46 seconds; on a whole minute the models never saw, nod 0.97, head shake 0.97, smile 0.64 (1.00 is never wrong, 0.50 is luck). So nods and head shakes are read from the AirPods alone, and the camera keeps smiles.

**The whole clinic** re-learns at once on Modal: the 50 simulated patients on the clinic list, one network-blocked Sandbox each, a shorter search each (12 s against 40 s for a real person), over 9,000 models in all in about half a minute, and each Sandbox re-learns which practice helps that patient ("Re-train the whole clinic" on the big screen).

Without AirPods: breathe with the sea for a minute with a phone on your chest ([/#/try](https://vire.fly.dev/#/try)), or the camera visit, one minute on any phone ([/#/visit](https://vire.fly.dev/#/visit)). The evidence behind the loop, and what it does not show: [pitch/evidence-loop.md](pitch/evidence-loop.md), [pitch/evidence-tms.md](pitch/evidence-tms.md), [pitch/evidence-airpods.md](pitch/evidence-airpods.md).

Built at Junction 2026 (13 to 15 November, Espoo) for Aalto University's challenge "Beyond the Clinic".

**Live:** https://vire.fly.dev

| Page | What it is |
|---|---|
| [/](https://vire.fly.dev/) | the first screen: what Vire is, then the replay, Today and the clinic |
| [/#/watch](https://vire.fly.dev/#/watch) | a Today run played back in about 40 seconds, no AirPods needed (a scripted run with stand-in AirPods, labelled so, until a real run is picked) |
| [/#/heard](https://vire.fly.dev/#/heard) | a real check played back in 22 seconds: the founder's own check-in, camera off, four hours after setup, with what his AirPods felt and what his model heard (3 of 3 asked nods, 3 of 3 head shakes, none unasked; one check, one person) |
| [/#/today](https://vire.fly.dev/#/today) | the loop: check-in, still check, practice in the ears, re-check, what was learned (AirPods, camera off) |
| [/#/day](https://vire.fly.dev/#/day) | the passive day from the AirPods, against your own earlier days |
| [/#/ears](https://vire.fly.dev/#/ears) | the one-off setup: the camera teaches the AirPods your nods and head shakes |
| [/#/clinic](https://vire.fly.dev/#/clinic) | the clinic's list (simulated patients): drift the practices didn't answer comes first, booster booking on the patient page |
| [/#/clinic/live](https://vire.fly.dev/#/clinic/live) | the big screen. `?practice=1` keeps the newest practice from a phone up, `?cohort=1` the whole-clinic re-training, `?board=1` the newest model search |
| [/#/eeg](https://vire.fly.dev/#/eeg) | a two-minute recording page for the EEG booth: AirPods motion and heart rate logged next to the booth's EEG (AirPods have no EEG) |
| [/#/try](https://vire.fly.dev/#/try) | the breathing on a phone held on the chest, about a minute: the phone's motion sensor stands in for the AirPods |
| [/#/visit](https://vire.fly.dev/#/visit) | the 60-second camera visit, no sign-up, no AirPods needed |
| [/#/clinic/hall](https://vire.fly.dev/#/clinic/hall) | the real people who tried the camera visit at Junction |
| [/#/wall](https://vire.fly.dev/#/wall) | the hall wall |
| [/#/science](https://vire.fly.dev/#/science) | the evidence, the checks and what is not claimed |

## What is real, what is simulated

**Real, the AirPods loop**

- Today, the passive day, the learner and the clinic's outer loop run on production. The Today loop has run end to end in tests with stand-in AirPods (a script, labelled as such); stand-in AirPods are kept apart from a person's days. A real person's run on their own AirPods is not written up yet.
- Heart rate in beats a minute from AirPods Pro 3 through an iPhone workout session, with the source checked. A swing with each breath is said only with at least three samples a breath; otherwise only that it settled. No HRV, no beat-to-beat timing.
- The founder's own setup minutes and the whole-clinic run on Modal (numbers above, sources in [pitch/claims.md](pitch/claims.md) rows 119 and 120).

**Real, the camera visit, running on the phone**

- The face: 478 landmarks from MediaPipe, turned into a smile reading by a small model taught on your own resting face and smile (Tune, about 15 seconds).
- The heart: pulse from the camera (rPPG), and how far it swings with two paced breaths, fitted on the beat times, with its own error bar. A number is shown only when the signal passes its gates. Otherwise the app says "not read".
- The voice: pitch movement while you answer one question. The nod: its speed, from the face or from AirPods motion in the iPhone shell.
- The loop: echo against your own usual (after three pings), one dose, a short second measurement, and a per-person learner that keeps count of what was followed by a lift.
- Nothing but numbers leaves the phone. No video, no audio.

**Checked** (details and limits in [validation/README.md](validation/README.md))

- Heart rate from the camera against a finger oximeter on 16 people: off by 1.2 bpm on average when a number is shown (72% of the time).
- Heart swing against the same oximeter on the same 16 people: off by 1.3 bpm on average (r 0.96). On a steady heart it called a swing 0 times in 10. Our first version did 10 in 10, and a judge caught it.
- Smile on 72 clips of 62 people: 97% of clear smiles found, 16% of neutral frames called a smile (3% when facing the camera).

**Simulated, and labelled so on screen**

- The clinic's patients: made-up people with made-up courses, practices, drift and boosters, so the list has something to show. Every clinic screen says Simulated patients. The whole-clinic re-training runs on 50 simulated patients. No patient has used Vire.
- The detection numbers on the science page come from a simulation of made-up people ([validation/detect.ts](validation/detect.ts)).
- `?mock=1` runs the app on scripted signals without a camera. It is for layout work and is never shown as a result.

**Not shown, not claimed**

- That any of this detects relapse, that drift comes before relapse, that a practice or a dose treats anything, or that an earlier booster works better. The link between these readings and depression is cited literature, not our result.
- That AirPods read brain activity (they have no such sensor) or read smiles on their own (the camera keeps smiles).
- That the sound adapting to you beats a fixed pacer, or that picking a practice per person beats picking at random.
- Paced breathing against an oximeter: the 16 people breathed as they liked.
- Smile size, voice, head movement, AirPods breathing and AirPods heart rate have no reference check of ours yet.

## Models and services

- Face, voice, heart and nod are computed on the device. No cloud model sees them.
- Each person's AirPods model is made on the phone first (13 small models), then in a Modal Sandbox of its own with the network blocked (366 models on all their minutes). No language model is in that search. The whole-clinic run starts one such Sandbox per simulated patient, all at once.
- The practice sound is made by the open model MusicGen-small (Meta) on a Modal T4 GPU (`sound/modal_app.py`). Placed around the head in the phone's own audio engine.
- The clinician's one-line reasons and summaries are worded by Claude Opus 5.5 from facts the server computed. Every text has a plain fallback, and an output that adds or drops a figure is thrown away.
- For the camera visit, the day's laugh and the spoken question are generated each morning with ElevenLabs (sound effects and text to speech). The other voice lines were generated once with ElevenLabs.
- The forest panorama is Poly Haven's "Mossy Forest" by Greg Zaal (CC0).

## Prior work

None. The first commit is Friday 13 November 2026, 19:54, at the venue.

## Run it

```sh
cd server && bun install && bun index.ts          # http://127.0.0.1:8871 , also serves web/dist
cd web && bun install && bun run build            # or: bun run dev
```

Tests: `cd server && bun test`, `cd web && bun test tests`, `bun test validation`.
A whole loop in a real browser with a recorded face as the camera: `node web/tests/e2e/full-loop.mjs`.

Environment (all optional): `VIRE_DB` (SQLite file), `CLIPROXY_API_KEY` (Claude for the clinician texts; off without it), `ELEVENLABS_API_KEY` (the day's laugh and question; the shipped clips play without it).

## Layout

```
shared/types.ts   the types both sides agree on
web/src/sense/    camera face, camera pulse, voice, head, the feature math
web/src/app/      the patient app: Tune, ping, echo, doses
web/src/tune/     the AirPods: setup minute, Today (session/), the passive day (passive/), the EEG page (eeg/)
web/src/clinic/   the clinic list, the patient page, the big-screen mirror, the hall page
web/src/wall/     the hall wall
web/src/science/  the evidence page
server/           Bun + Hono + SQLite: API, the learner, the simulated cohort, the live relay
validation/       the sensor checks, their code and every result
ios/              the iPhone shell (WKWebView + AirPods motion bridge)
sandbox/          the Modal search for each person's AirPods model, and the whole-clinic run
sound/            the practice sound on a Modal GPU (MusicGen-small)
pitch/            submission text, deck, and claims.md: every claim with its source
```

A signal for the clinic, not a diagnosis. MIT licence.
