# Junction submission form

Limits: name 30 characters, punchline 200, description 5000 (markdown). Fill the slots listed at the bottom, then recount. The form also wants a demo link (use `https://vire.fly.dev`, the first screen), a source link, a pitch deck PDF and a video of at most 2:00 (`FILM_PLAN.md`). Every sentence below has a row in `claims.md` (rows 1 to 3, 30, 69, 104 to 136).

## Project name

Vire

## Punchline

Like Meru Health, but your AirPods sense every step. After TMS for depression, Vire spots drift from your usual, plays a practice in your ears, learns what helps you and tells your clinic.

(188 characters, counted with `python3`.)

## Description (paste from here)

### Try it

- **Start here:** https://vire.fly.dev and tap "Watch a run": a whole Today run in 40 seconds, no AirPods needed.
- **AirPods in:** Today, in our iPhone app (at our table), or https://vire.fly.dev/#/today on a Mac with the Vire Ears helper. Five minutes, camera off.
- **The clinic:** https://vire.fly.dev/#/clinic and the big screen https://vire.fly.dev/#/clinic/live
- **No AirPods?** On a phone: https://vire.fly.dev/#/try (the breathing, phone on your chest) or https://vire.fly.dev/#/visit (one minute with the camera).

### Problem

A TMS course for depression is 20 to 30 clinic visits over 4 to 6 weeks. Then you go home. A year later only 46% of the people it worked for still respond (Senova 2019). Bringing TMS back when people got worse regained the benefit for 32 of 38 in an open study with no control group (Janicak 2010). But once you're home, the clinic doesn't see you.

### Solution: two loops

Vire runs while your AirPods are in.

**You.** The AirPods sense your head movement, how long your head is down, your walks, your nods and, on AirPods Pro 3, your heart rate. When that drifts from your own usual, Vire offers a short practice in your ears: slow breathing, a body scan or a short walk. The AirPods measure what it did, and Vire learns which practice works for you, and how long.

**Your clinic.** Drift the practices don't fix goes to the top of the clinic's list, with what we tried and what worked. The clinic can book a TMS booster then, not on a fixed schedule.

A signal for the clinic, not a diagnosis.

### How it works

- **Today**, camera off, five minutes: a quick check (asked nods and smiles, then sitting still for head movement and heart rate), the practice, the same check again. "Calmer after" comes only from heart rate and stillness.
- **Breathing:** a sea in your ears rises as you breathe in and falls as you breathe out. It slows from your own pace to 6 a minute, but only when the AirPods read your breath following it (or a still head).
- **The walk** counts only if the AirPods felt your steps.
- **Learning**, from your own practices only: which one calmed your head movement most. It says "Vire learned" only when 80% sure which is best, after 3 scored runs of it.
- **Heart rate:** the app checks it came from the AirPods.
- **Setup, once:** a minute where the camera labels your nods and head shakes while the AirPods feel them.

### Working today

- The whole Today loop is online, tested with a script in place of AirPods.
- From my AirPods alone, on a whole minute the model never saw: nod 0.97, head shake 0.97 (1.00 is never wrong, 0.50 is luck). Smile 0.64, too weak to count yet.
- Four hours later, camera off, the same model heard 3 of 3 asked nods and 3 of 3 head shakes, and none unasked. That's one check, on me.
- The clinic list and booster booking, on simulated patients.

### Not yet

- No patient or clinic has used Vire, and nobody has compared it with a questionnaire, or a practice with just sitting still.
- Nobody knows if drift comes before relapse, or if an earlier booster helps more. The booster evidence is rated low (Wilson 2022).
- A practice is not a treatment.
- It senses while Vire is open, not in the background.

### What is next

Daily runs on my own AirPods. Then a pilot with a TMS clinic: 20 patients, from the last two weeks of the course to 12 weeks after, with a weekly depression questionnaire.

### Usefulness

You get a practice when you drift. If it doesn't help, the clinic sees what was tried and can book a booster.

### Ease of use

AirPods in, tap Start, breathe with the sea. No camera after setup, nothing to type.

### Smart sensing

Everything is against your own usual. Vire learns each person: in one earbud study a model for the person read face movements 89.9% right, one for everyone 42.1% (ExpressEar 2021).

### Creativity

The AirPods sense you and answer you: a sea made as you breathe, that stays put as you turn your head.

### Best use of Modal

What ran on Modal:

- **A locked box per patient.** Each person's data gets its own Modal Sandbox with the network blocked. On my three setup minutes it tried 366 models in 46 seconds, each scored on a minute it never saw.
- **The whole clinic at once.** The 50 simulated patients on the clinic list, one Sandbox each, all running together, a shorter search each: 9,595 models in all, in 27 seconds. Each Sandbox also re-learns which practice helps that patient. Press "Re-train the whole clinic" on https://vire.fly.dev/#/clinic/live?cohort=1
- **The sea, on a GPU.** MusicGen-small on a T4: thirty 20-second pieces made ahead, and during a practice the phone asks Modal for a new one from the pace and stillness the AirPods just read.
- **A shared model, tried.** Pretrained on a public earbud dataset (EarSet, 30 people) on a T4, fine-tuned per person. It didn't clearly win, so each person keeps their own.

## (stop pasting here)

Current count of the paste region: **4,892** characters, markdown included (counted with `python3`: `len()` of the stripped text between the "Description (paste from here)" heading and "(stop pasting here)"). Room left: 108. This text is what the Junction draft holds (project 2079, "Vire", Beyond the Clinic, Draft, "Best use of Modal" ticked; saved Sunday 01:28 Helsinki time with `python3 /home/ubuntu/junction/tools/junction_draft.py /bulk3/runs/depression/junction-draft/fields.json --save`, Save Draft only). It has no open slots. Not in the draft yet: the video link and the deck PDF.

## Slots to fill on Sunday morning

- "Watch a run" on the first screen plays the scripted run until the founder's own run is picked as the public replay (`POST /api/ear/replay`, see `server/earreplay.ts`); then the button says "Watch a real run". The sentence under "Try it" holds for both.
- When the founder's own Today run exists, add to the first line under "Working today": "On my own AirPods: [REAL: ran], heart rate [REAL: heart], head movement [REAL: still]." and save the draft again.
- `[REAL: ran]`: from the founder's own Today run (the phone's result screen, and `/#/clinic/live?practice=1`). Write "the whole loop ran" or say which step did not.
- `[REAL: heart]`: the result screen, "your heart rate came down N beats a minute" (before and after from the still checks). Keep it only if the screen names the AirPods as the source. Otherwise write "no heart rate from the AirPods yet".
- `[REAL: still]`: the result screen, "your head sat N% stiller" or "moved N% more".
- The shared model sentence (EarSet, 30 people; smile 0.78 against 0.66, head shake 0.95 against 0.97): `pitch/evidence-shared-model.md`, the 6-epoch run fixed as the result before looking. Filled on Saturday night.
- 46 seconds, 366 models, 0.97 / 0.97 / 0.64: production job `ej_f4d4185419864d00a87c4f6c32804718` (`GET /api/ear/jobs/latest`). If a newer job is on the screen, use its numbers.
- 50 patients, 27 seconds (9,595 models, not in the text): production cohort run `cr_231f14871d724b76875d8f64c010688d` (`GET /api/ear/cohort/latest`), Sunday 00:54. The 50 are the people on the clinic list (`server/cohort.ts`). If someone presses "Re-train the whole clinic" again, the latest run changes: recheck.
- "Four hours later, camera off": `claims.md` row 134.
- After filling, recount: it must stay at or under 5,000 characters.
