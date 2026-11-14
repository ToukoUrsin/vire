# Table demo (table A157), 60 seconds

For a judge standing at the table. You wear the AirPods, they watch the iPhone and the laptop. If they have time, they put the AirPods in and breathe with the sea for 30 seconds.

**Set up:** iPhone with the Vire app on Today (`/#/today`), AirPods connected to it. Laptop on `#/clinic/live?practice=1` (your newest practice), next tab `#/clinic` (the list), next `#/clinic/live?cohort=1`. Printed QR to https://vire.fly.dev for people without AirPods: "Watch a run" plays a Today run in 40 seconds, and "No AirPods?" is the breathing on their own phone, held on the chest (the one-minute camera check is under it). The 50 people on tab 3 are the same simulated patients as the list on tab 2.

Before the first judge: do one full Today run, so the big screen has a real practice on it. Fill `[REAL: ...]` from its result screen.

---

## The 60 seconds

**0:00** AirPods in. Show the day card on the iPhone.
> These are just AirPods. While they're in, an app called Vire follows how my head moves and compares it with my usual. The camera is off.

**0:10** Look at them.
> It's for people at home after TMS, a clinic treatment for depression. About half lose the benefit within a year, and once you're home the clinic doesn't see you.

**0:20** Tap Start on the iPhone, or show this morning's run on the big screen (tab 1).
> Every day, and when my day drifts, it offers a breathing practice: a sea in my ears that slows down only when I keep up. When the AirPods can't feel my breath, it goes by how still I sit, and says so.

**0:32** Point at the big screen.
> It measures me before and after. Heart rate **[REAL: heart]**, head movement **[REAL: still]**. Over days it learns which practice settles me most.

**0:42** Switch to `#/clinic`.
> If my days keep looking different anyway, I go to the top of the clinic's list, with what Vire tried. The clinic can then book me in for more TMS. These patients are simulated, and no patient has used it yet. Want to try the breathing?

**If they stay (20 s):** switch to `?cohort=1` and press "Re-train the whole clinic".
> Each patient's model trains in its own sandbox on Modal, with no network. 50 simulated patients, each in its own box. Watch them fill: usually about 30 seconds. The sea sound is made there too, on a GPU.

---

## 15 seconds (they're walking past)

AirPods in, show the sea on the iPhone.
> After TMS for depression, your AirPods notice when you drift. Vire plays a practice in your ears, learns what helps you and tells your clinic. Want to see?

If they know Meru Health, start with: "Like Meru Health, but your AirPods sense every step."

---

## If they ask one thing

The names in brackets are for you, not to say. Sources are in `claims.md`.

- **"What's TMS?"** Magnetic pulses to the brain, in a clinic, daily for four to six weeks, for depression that medicines haven't helped. *(Perera 2016, rows 1, 1a)*
- **"Does it detect depression?"** No. It sees change from your own usual and tells the clinic. The clinic decides what it means.
- **"Do AirPods read the brain?"** No. They have no such sensor. They feel head movement, and AirPods Pro 3 give heart rate in beats a minute. *(row 133)*
- **"Does the breathing help?"** Slow breathing around six a minute makes your heart rate swing more with each breath while you do it. As a programme of weeks, breathing with heart-rate feedback lowered depressive symptoms a little, mostly in people whose main problem was something else. A practice isn't a treatment. *(rows 124, 125)*
- **"How does it know the breath follows the sound?"** From the small movement of the head with each breath, when you sit still. Earbud motion has read breathing rate in research when people kept still, but not on AirPods and not at six a minute, so when it can't read the breath it goes by a still head and says so. *(rows 106, 128)*
- **"Where does the heart rate come from?"** AirPods Pro 3, through a workout session on the iPhone. That's the only way Apple gives apps heart rate. The app checks the source is the AirPods. *(rows 30, 111)*
- **"How does it learn?"** It scores each practice by how much stiller my head was after. It says "Vire learned" only after at least three of the best one, and before that "too early to say". *(row 108)*
- **"What does Modal do?"** Three things: each person's model in their own network-blocked box, the whole clinic at once, and the sound on a GPU. *(rows 113, 119 to 121)*
- **"Can AirPods read a smile?"** Not well enough yet. On my minutes, nods and head shakes 0.97, smiles 0.64, so the camera keeps smiles. *(row 119)*
- **"Is the booster earlier better?"** Nobody knows. Bringing TMS back when people got worse worked for 32 of 38 in an open study without a control group, and the evidence is rated low. That's what a pilot would test. *(rows 3, 130)*
- **"Is it tested on patients?"** No. No patient or clinic has used it. The clinic's patients are simulated.
- **"Does it run all day?"** It runs while your AirPods are in and Vire is open. Not in the background.
- **"What leaves the phone?"** Numbers: AirPods angles, heart-rate samples, what was asked when. No video, no sound. *(row 118)*

## Slots to fill

- `[REAL: heart]`, `[REAL: still]` from this morning's result screen. If the heart rate didn't come from the AirPods, drop it and say only the head movement.
