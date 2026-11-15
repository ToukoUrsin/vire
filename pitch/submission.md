# Junction submission form

Limits: name 30 characters, punchline 200, description 5000 (markdown). Fill the slots listed at the bottom, then recount. The form also wants a demo link (use `https://vire.fly.dev`, the first screen), a source link, a pitch deck PDF and a video of at most 2:00 (`mobile/FILM.md`). Every sentence below has a row in `claims.md` (rows 1 to 3, 30, 69, 104 to 136).

## Project name

Vire

## Punchline

Your AirPods sense every step. After TMS for depression, when you move less than usual, Vire guides a walk or slow breathing in your ears and learns which helps. If neither does, your clinic knows.

(197 characters, counted with `python3`.)

## Description (paste from here)

### Try it

- **Start here:** https://vire.fly.dev and tap "Watch a run": the daily five minutes in 40 seconds, scripted for now.
- **No AirPods?** On a phone: https://vire.fly.dev/#/try (phone on your chest: the sea slows only if your breath follows).
- **The phone app:** https://vire.fly.dev/app/ "Live" reads your nods by camera; AirPods need our iPhone app. The rest is sample data.
- **With AirPods:** the daily five minutes, on our iPhone (at our table) or https://vire.fly.dev/#/today on a Mac with our helper app. Camera off.
- **The clinic (simulated patients):** https://vire.fly.dev/#/clinic and the big screen https://vire.fly.dev/#/clinic/live?practice=1

### Problem

A TMS course for depression is 20 to 30 clinic visits in 4 to 6 weeks. A year later only 46% of the people it worked for still respond (Senova 2019). Bringing TMS back when people got worse regained the benefit for 32 of 38 (Janicak 2010, no control group). But once you're home, the clinic doesn't see you.

### Solution: two loops

Vire senses all the time your AirPods are in.

**You.** The AirPods sense your head movement, how long your head is down, your walks, your nods and, on AirPods Pro 3, your heart rate (built, not yet read on a real run). When that drifts from your own usual, Vire offers a short practice in your ears: slow breathing, a body scan or a short walk. The AirPods measure what it did, and Vire learns which practice calms you most.

**Your clinic.** Drift the practices don't fix goes to the top of the clinic's list, with what we tried and what worked. The clinic can book a TMS booster then, not on a fixed schedule.

A signal for the clinic, not a diagnosis.

### How it works

- **The daily five minutes**, camera off: a check (asked nods and smiles, then sitting still), the practice, the check again. "Calmer after" needs a lower heart rate; stillness alone is "Stiller after".
- **Breathing:** a sea in your ears rises as you breathe in and falls as you breathe out. It slows from your own pace to 6 a minute, but only while the AirPods sense you keeping up (or sitting still).
- **The walk** counts only if the AirPods felt your steps.
- **Learning**, from your own practices only: which one calmed your head movement most. "Vire learned" shows only when 80% sure, after 3 scored runs of the best one and 2 of another.
- **Setup, a minute at a time:** the camera labels your nods and head shakes while the AirPods feel them.

### Working today

- The whole daily loop is online, tested with a script in place of AirPods.
- From my AirPods alone, on a whole minute the model never saw: nod 0.97, head shake 0.97 (1.00 is perfect, 0.50 is luck). Smile 0.64, too weak to count.
- Four hours later, camera off, the same model heard 3 of 3 asked nods and 3 of 3 head shakes, none unasked (0.94 and 0.95 that time). One check, on me: https://vire.fly.dev/#/heard
- The clinic list and booster booking, on simulated patients.
- Our write-up of what we measured and what failed is in the phone app.

### Not yet

- No patient or clinic has used Vire, and nobody has compared it with a questionnaire, or a practice with just sitting still.
- Nobody knows if drift comes before relapse, or if an earlier booster helps more. The booster evidence is rated low (Wilson 2022).
- A practice is not a treatment.
- Sensing with the iPhone locked is next.

### What is next

Daily runs on my own AirPods. Then a pilot with a TMS clinic: 20 patients, from the end of the course to 12 weeks after, with a weekly depression questionnaire. Later: calls, music and sleep (sample data in the phone app).

### Usefulness

A practice when you drift. If it doesn't help, the clinic sees what was tried and can book a booster.

### Ease of use

AirPods in, tap Start, breathe with the sea. No camera after setup, nothing to type.

### Smart sensing

Everything is against your own usual, and the model is yours: in one earbud study a personal model read face movements 89.9% right, a shared one 42.1% (ExpressEar 2021).

### Creativity

The AirPods sense you and answer you: a sea made as you breathe, that stays put as you turn your head.

### Best use of Modal

- **A locked box per patient.** Each person's data gets its own Modal Sandbox with the network blocked. On my three setup minutes it tried 366 models in 46 seconds, each scored on a minute it never saw.
- **The whole clinic at once.** The 50 simulated patients on the clinic list, one Sandbox each, all together, a shorter search each: around 10,000 models in about half a minute. Each Sandbox also re-learns which practice helps that patient. Run it yourself: https://vire.fly.dev/#/clinic/live?cohort=1
- **The sea, on a GPU.** MusicGen-small on a T4: 30 pieces made ahead; during a practice the phone asks for a new one from the pace and stillness the AirPods just read.
- **A shared model, tried.** Pretrained on a public earbud dataset (EarSet, 30 people) on a T4, fine-tuned on me. It didn't clearly win, so each person keeps their own.

## (stop pasting here)

Current count of the paste region: **4,990** characters, markdown included (counted with `python3`: `len()` of the stripped text between the "Description (paste from here)" heading and "(stop pasting here)"). Room left: 10. The Junction draft is project 2079, "Vire", Beyond the Clinic, Draft, "Best use of Modal" ticked; it is saved with `python3 /home/ubuntu/junction/tools/junction_draft.py /bulk3/runs/depression/junction-draft/fields.json --save` (Save Draft only). The text has no open slots. Not in the draft yet: the video link.

## Slots to fill on Sunday morning

- "Watch a run" on the first screen plays the scripted run until the founder's own run is picked as the public replay (`POST /api/ear/replay`, see `server/earreplay.ts`); then the button says "Watch a real run". The sentence under "Try it" holds for both.
- When the founder's own Today run exists, add to the first line under "Working today": "On my own AirPods: [REAL: ran], heart rate [REAL: heart], head movement [REAL: still]." and save the draft again.
- `[REAL: ran]`: from the founder's own Today run (the phone's result screen, and `/#/clinic/live?practice=1`). Write "the whole loop ran" or say which step did not.
- `[REAL: heart]`: the result screen, "your heart rate came down N beats a minute" (before and after from the still checks). Keep it only if the screen names the AirPods as the source. Otherwise write "no heart rate from the AirPods yet".
- `[REAL: still]`: the result screen, "your head sat N% stiller" or "moved N% more".
- The shared model sentence (EarSet, 30 people; smile 0.78 against 0.66, head shake 0.95 against 0.97): `pitch/evidence-shared-model.md`, the 6-epoch run fixed as the result before looking. Filled on Saturday night.
- 46 seconds, 366 models, 0.97 / 0.97 / 0.64: production job `ej_f4d4185419864d00a87c4f6c32804718` (`GET /api/ear/jobs/latest`). If a newer job is on the screen, use its numbers.
- 50 patients, "about half a minute", "around 10,000 models": the screen shows each run's own numbers and anyone can press the button, so the text pins no single run. Runs so far with all 50: 27 s and 9,595 models (`cr_231f14871d724b76875d8f64c010688d`, Sunday 00:54), 34.8 s and 9,886 (`cr_07bb74dc724f4f16851d03adbfb76d27`, Sunday 01:25, a judge's press), 27 s and 8,921 (another judge's press), 26 s and 11,201 and 26 s and 9,559 (round-5 judges, Sunday about 04:00). The 50 are the people on the clinic list (`server/cohort.ts`). If someone presses "Re-train the whole clinic" again, the latest run changes: recheck.
- "Four hours later, camera off": `claims.md` row 134. The link plays that recording (`#/heard`, `GET /api/ear/check`; the bundle is made by `scripts/realcheck.ts` and sent with the worker token, it is not in the repo).
- The phone app line and "Later: calls, music and sleep": `claims.md` row 135. The film (`mobile/FILM.md`) says the same: teaching and the live reading are real, the rest of the phone app is sample data.
- The first line under "Working today" has no room for the `[REAL]` sentence as it stands: when the run exists, replace "tested with a script in place of AirPods" with it.
- After filling, recount: it must stay at or under 5,000 characters.
