# Vire sensor validation

**What this is.** A test of whether Vire's camera sensors read the body correctly on video of real people: heart
rate against a finger oximeter, smile and face detection against labels made by eye, and both again in bad light.
The code under test is the app's own sensing code (`web/src/sense/`), running in Chrome, with each video fed in as
the camera.

**What this is not.** We validate that the sensors read the body. We do not validate any link between these
readings and depression: that link is cited literature, not our result. Voice and head movement were not tested here.

## Results

| Sensor | On whom | Compared with | Result |
|---|---|---|---|
| Heart rate from the camera | 16 people, 17 minutes (UBFC-rPPG) | finger oximeter | off by 1.2 bpm on average (RMSE 1.5); 99 % of readings within 5 bpm; a reading is shown 72 % of the time |
| Heart swing with the breath (what the echo uses) | the same 16 people, 46 twenty-second windows | finger oximeter, same reading | off by 1.3 bpm on average (r 0.96); a steady heart called a swing in 0 of 10 windows (the reading it replaced: 10 of 10); shown 78 % of the time. Not paced: see the section |
| Smile | 72 clips, 62 people (stock video) | frames labelled by eye | 97 % of clear smiles found; 16 % of neutral frames called a smile, 3 % when the person faces the camera with the face 100 px or wider |
| Face found | the same 72 clips | | 93 % of frames; 98 % when facing the camera with the face 100 px or wider |
| Dim or noisy picture | 8 + 16 of the videos above, degraded | the same references | smile and face hold down to a quarter of the light; with camera noise the pulse stops showing a number, and it never showed a wrong one |

The pulse error is low for three reasons that should be said next to it: the app only shows a number when the signal
is clean (the 72 %), the dataset is of people sitting still in good light, and the reference is computed over
exactly the same video frames. With nothing withheld the error is 1.8 bpm (RMSE 5.3), with single windows off by
up to 65 bpm. Details in section 1.

## How the videos were run

Each video is converted to a raw camera file and given to headless Chrome as its camera
(`--use-file-for-fake-video-capture`). Chrome opens the app's lab page (`/#/lab`), which runs the same `Sense` code
as the app, and every reading is saved (`run_lab.mjs`). A frame counter is drawn into the top-left 128 x 16 pixels
of each video, so every reading is tied to the exact frame it came from; nothing is matched by clock.

The test machine is a shared server under heavy load, with no GPU. In real time the pipeline reached only 8 to 21
frames a second there, which says nothing about a phone. So the reported runs play the video at 5 frames a second
and slow the page's clock by the same factor: the code sees a 24-30 fps camera on a device that keeps up
(25-29 fps analysed). **Frame rate on a phone was not measured.**

## 1. Heart rate against a finger oximeter

**Data.** UBFC-rPPG, dataset 2 (Bobbia et al. 2017, https://sites.google.com/view/ybenezeth/ubfcrppg): people at a
desk, about 1 m from a webcam (640 x 480, 30 fps, uncompressed), playing a number game that raises the heart rate,
with a CMS50E finger oximeter recorded in step with the video. We have 16 of its 42 people (subjects 1, 3-5, 8-18,
20): the first 16 in the public folder, after which Google Drive's download quota stopped us. They were not chosen
by result. The second dataset we tried, LGI-PPGI, could not be downloaded (its server did not answer).

**Reference.** The rate of the oximeter's pulse wave (spectral peak) over the same video frames, which is how the
dataset's authors score it. The oximeter's displayed rate is not used: it disagrees with its own pulse wave for 3 of
the 16 people (subject 20: display 53, wave 128, camera 125).

**Scoring.** Every 5 s: the bpm the app shows (median over 1 s) against the reference over the 10 s of frames that
estimate covers. A window counts as "shown" when the app displayed a number; it displays none when its signal
quality is under 0.3 or the face is moving. 172 windows, heart rates from 64 to 134 bpm.

| | Shown windows only (what the user sees) | Every window (nothing withheld) |
|---|---|---|
| Windows | 124 of 172 | 172 |
| Mean absolute error | **1.17 bpm** | 1.81 bpm |
| RMSE | 1.53 bpm | 5.31 bpm |
| Within 5 bpm | 99.2 % | 97.1 % |
| Worst window | 6.0 bpm | 64.5 bpm |
| Correlation with the oximeter | r = 0.996 | |
| Share of time a number is shown | **71.9 %** | 100 % |

Per person: error 0.4 to 2.1 bpm; share of time shown 41 % to 100 % (`results-pulse.jsonl`). The right-hand column
is the same recordings replayed with the quality gate off (`explore_pulse.ts`, `gate_curve.py`).

**Is 1.2 bpm believable?** Published POS on the same dataset: 4.0 bpm (rPPG-Toolbox, Liu et al., NeurIPS 2023; all
42 people, one rate per video, whole face box, nothing withheld). Our like-for-like figure is the right-hand column,
1.8 bpm: the same range, on a different subset, with skin patches placed by face landmarks instead of a face box.
The 1.2 comes from showing nothing in the worst 28 % of the time. That is the design, and the price is coverage.

**Coverage depends on dropped frames.** A run that dropped fewer frames (29 instead of 26.5 fps analysed) showed a
number 81 % of the time with the same error (1.15 bpm). That run used the build from before the stall fix below;
replaying its recording with the fix gives the same 81 %. In real time on the loaded
server (16-21 fps with stalls) it was 51 %, error 1.22 bpm. Accuracy held in all three; coverage did not.

## Heart swing at the breath's period

This is the heart reading the echo uses, and section 1 did not test it. The app paces two slow breaths (5 s in, 5 s
out) and reads how far the heart rate swings with them. Because the app sets the pace, it knows the period, so it
reads only the part of the heart rate that moves at that period (`lockedSwing` in `web/src/sense/features.ts`).

**Why the first version was wrong.** It took the highest minus the lowest beat-to-beat rate. A judge saw it call 1,
4 and 9 bpm on one still face. The camera sees each beat 32 ms early or late (measured here against
the oximeter, median over windows); between two beats that is several bpm of made-up rate, so highest minus lowest
reads a swing on every heart. The reading now fits the beat times themselves: beat count = a steady rate + a part
that moves at the breath's period, with misread beats set aside and the timing error taken out of the result. It
also gives its own standard error, and the app shows nothing when that is over 2 bpm or when the
pulse was not followed through at least nine tenths of the breaths.

**Data and method.** The same 16 people as section 1 (UBFC-rPPG dataset 2), 20-second windows in
10-second steps: 76 windows. Camera side: the skin colour the app's face tracker read from every
frame in the section 1 runs, through the app's own code (`CameraPulse`, `analyzePulseWindow`, the quality gate,
`beatSeries`, `lockedSwing`), each frame at the capture time the dataset gives for it. Reference: the finger
oximeter's pulse wave over the same seconds through the same beat picking and the same fit. A window is scored when
the oximeter's own reading is sound (its beats add up to its rate, its standard error is 2 bpm or
less): 59 windows. `swing_validation.ts` does all of it; `results-swing.jsonl` has one line
per window.

**These people were not paced.** They sat at a desk and breathed as they liked. So what is compared is the part of
the heart rate that moves at a 10-second period, which everyone has some of (5.36 bpm on average
here, up to 28) and which paced breathing makes large. It is a check of the reading, not of a breathing response.

| | Lock-in on the beats (now) | Highest minus lowest (before) |
|---|---:|---:|
| Windows where a number is shown | 46 of 59 (78 %), 16 people | 47 of 59 |
| Mean absolute error | 1.28 bpm (median 1.16) | 9.41 bpm |
| Bias | +0.26 bpm | +9.34 bpm |
| RMSE | 1.73 bpm | 10.49 bpm |
| Correlation with the oximeter | 0.958 | 0.678 |
| 95 % limits of agreement | -3.13 to +3.65 bpm | -0.13 to +18.81 bpm |
| Worst window | subject14, 0 s: 13.12 against 6.37 | subject9, 0 s: 26.91 against 2.38 |

Error by the size of the oximeter's swing, now: 0.68 bpm at 0-1.5 bpm (10 windows), 1.36 bpm at 1.5-3 bpm (8 windows), 1.24 bpm at 3-6 bpm (13 windows), 1.68 bpm at 6+ bpm (15 windows). Before: 10.83 bpm at 0-1.5 bpm (10 windows), 12.62 bpm at 1.5-3 bpm (8 windows), 8.13 bpm at 3-6 bpm (14 windows), 7.93 bpm at 6+ bpm (15 windows).

**A steady heart.** In the 10 windows where the oximeter shows under 1.5 bpm of swing,
the reading called more than 3 bpm in 0 of 10; highest minus lowest did
in 10 of 10.

**Its own error bar.** The stated standard error is honest: the median error is 0.96
standard errors, and 84.8 % of readings are within two (95 % would be ideal, so it is a
little optimistic). The app can say "14, give or take 2" (`swingSe`).

**Dropouts.** The face is lost for a stretch at a random place in the window (a head turn, a flicker), five
placements for each scored window:

| Lost for | Lock-in (now) | Highest minus lowest (before) |
|---|---|---|
| 0.3 s | shown in 217, error 1.23 bpm, 1 of 48 steady windows called a swing | shown in 228, error 9.62 bpm, 48 of 48 steady windows called a swing |
| 0.5 s | shown in 209, error 1.29 bpm, 1 of 44 steady windows called a swing | shown in 215, error 9.69 bpm, 44 of 44 steady windows called a swing |
| 0.7 s | shown in 201, error 1.32 bpm, 2 of 46 steady windows called a swing | shown in 212, error 10.21 bpm, 47 of 47 steady windows called a swing |
| 0.85 s | shown in 188, error 1.37 bpm, 0 of 43 steady windows called a swing | shown in 213, error 10.11 bpm, 45 of 45 steady windows called a swing |
| 1 s | withheld in all 295 | shown in 231, error 7.05 bpm, 49 of 49 steady windows called a swing |

A gap of a second restarts the app's pulse (section "What we changed"), and what is left of the window is too short
to tell a breath from a drift: without the nine-tenths rule the reading called a swing on about half of the steady
windows there. With it, nothing is shown, and the person is asked to keep still for the two breaths.

**One breath.** The mini ping after a dose paces one breath (10 s). On 10-second windows: 36 of
76 shown, error 1.38 bpm, bias +0.24, correlation 0.963
(15 people).

**Other periods.** The breathing dose tries three paces. At the period where each person's own heart rate swings
most (4 to 12 s, found on the oximeter): 39 windows, error 1.67 bpm, bias -0.36,
correlation 0.939, mean swing 7.42 bpm.

**Frame times.** A phone stamps a frame when the camera took it. The section 1 runs were made with a slowed clock
on a loaded server, which stamps frames unevenly (by about 30 ms around a slowly wandering delay, 24 to 39 across
people). With those stamps: 41 windows
shown, error 1.41 bpm, bias +0.78, correlation 0.961. The headline uses the
dataset's capture times.

**Not held out.** The fit has no trained parameter, but two choices were made after looking at all 16
people: reading the swing from beat times and not from rates, and the nine-tenths rule. Splitting the people in two
(every other one) gives 1.51 bpm (r 0.877, 24 windows) and 1.03 bpm
(r 0.983, 22 windows): consistent, not a held-out test.

### A known paced swing (simulated and synthetic, never a person)

Nobody here breathed to a pacer, so a known swing has to be made.

Simulated beats: a heart at 60, 80 or 100 bpm whose rate swings by a set amount with a 10-second period, each beat
seen with the 32 ms timing error measured above, one beat missed and one misplaced in every
20 s, 400 trials each. At 80 bpm:

| True swing (bpm) | Mean reading | 5th to 95th percentile | Withheld |
|---:|---:|---:|---:|
| 0 | 0.64 | 0 to 2.38 | 0 of 400 |
| 4 | 3.89 | 1.9 to 5.79 | 0 of 400 |
| 8 | 7.94 | 6.14 to 9.75 | 0 of 400 |
| 12 | 11.85 | 10 to 13.62 | 0 of 400 |
| 16 | 15.81 | 13.7 to 17.65 | 1 of 400 |

Over all three heart rates the mean reading is within 0.23 bpm of the true swing, and a heart with no
swing reads under 2.43 bpm in 95 % of trials.

Synthetic video in the real browser: a still face tinted by a pulse at 66 bpm that swings by 0, 4, 8 or 12 bpm
(`web/tests/sense/synth_pulse.py`), given to headless Chrome as its camera and run through the lab page's full ping,
three runs each, in real time on the loaded server (10 to 29 frames a second analysed):

| True swing (bpm) | Three runs | Mean |
|---:|---|---:|
| 0 | 0.8, 1.1, 0.3 | 0.73 |
| 4 | 4, 5.4, 4.1 | 4.5 |
| 8 | 7.6, 8.7, 7.4 | 7.9 |
| 12 | 12, 12, 12.4 | 12.13 |

**What is still missing:** a person breathing to the app's pacer with an oximeter on a finger, and the same on a
phone camera with compressed video. Until then the claim is: on still people in good light the reading follows the
oximeter's to within about 1.28 bpm, and it does not invent a swing on a steady heart.


## 2. Smile and face on 62 people

**Data.** Free stock clips from Mixkit (mixkit.co, no account), found through its category pages (smiling, laughing,
serious, thinking, talking, video call, glasses, beard, elderly, and others). 158 clips downloaded, first 14 s of
each at 640 x 360. A first pass kept the 76 where the pipeline found a face at least 50 px wide in 60 % of frames.
Six frames per clip were then labelled by eye, before any smile score was looked at: clear smile or laugh, subtle
smile, no smile (neutral, serious, talking), or unusable. Four clips had no usable frame, leaving **72 clips of 62
people**: by eye 48 light, 5 medium and 8 dark skin (1 unclear); 4 children, 46 adults, 12 older; 13 with glasses,
16 with beards. Median face width 110 px (63 to 184 for most). A phone held at arm's length should give a larger face; that was
not measured.

**Scoring.** A smile counts as found when the raw smile score at the labelled frame is 0.15 or more: the step the
app itself uses for the start of a smile.

| | Frames | Result |
|---|---|---|
| Clear smiles found | 91 (26 people) | **96.7 %** |
| Neutral frames called a smile | 211 (43 people) | **16.1 %** |
| Subtle smiles found (scored apart) | 65 | 80.0 % |
| Clear smile against no smile, any threshold (AUC) | | 0.98 |
| Smiling clips detected | 21 clips | 100 % |
| Neutral clips with at least one false frame | 33 clips | 21 % (7 clips) |
| Face found, share of frames | 72 clips | **93.2 %** (all frames in 55 clips, under 90 % in 11) |

**Where it is weaker.** The false positives are a framing problem, not a threshold problem:

| | Neutral called a smile | Clear smiles found |
|---|---|---|
| Head within 10 degrees of the camera | 7.9 % of 101 | 98.4 % of 64 |
| Turned 10-20 degrees | 16.7 % of 48 | 100 % of 16 |
| Turned more than 20 degrees | 29.0 % of 62 | 90 % of 10 |
| Face under 100 px wide | 28.4 % of 95 | 96.8 % of 31 |
| Face 100 px or wider | 6.0 % of 116 | 98.3 % of 59 |
| **Within 20 degrees and 100 px or wider** | **3.2 % of 93** | **100 % of 54** |
| Outside either limit | 26.3 % of 118 | 94.4 % of 36 |

The two limits were chosen from this same data, so the 3.2 % is on the optimistic side. Face tracking fails the same
way: found in 82 % of frames for faces under 80 px, 98 % for front-facing faces of 100 px or more. It is also weaker
with glasses (84 % of frames, against 95 % without) and for older people (87 %), who in these clips are mostly
looking down at something.

**By skin tone.** Dark skin: 100 % of 20 clear-smile frames found, 22.6 % of 31 neutral frames called a smile
(8 people). Light skin: 97.1 % of 69 and 16.7 % of 156 (48 people). Medium: 5 people, too few smiles to score. We see
no gap, but 8 and 5 people cannot show one either way.

**Does per-person calibration help?** (The tune step rescales the score to each person's own rest-to-biggest range.)

- *Telling a smile from no smile:* barely, because the raw score already does it (AUC 0.98). On the 5 people who
  have both clear-smile and neutral frames, AUC goes from 0.995 to 1.000, and false positives from 22.6 % (raw
  score 0.15 or more) to 9.7 % (half of the person's own range or more), over 31 frames, with every smile still
  found. Five people is thin.
- *The resting face:* yes. 7 of 38 people rest at a raw score of 0.10 or more without smiling. Measured above each
  person's own rest, false positives fall from 16.3 % to 9.4 % (203 frames, 38 people). A ping already does this
  part: its smile numbers are taken above the level in its settle phase.
- *How big a smile is:* yes, and this is the real case for it. A clear smile scores anywhere from 0.45 to 0.98
  depending on the person (16 people, 74 frames); 72 % of that spread is between people. Scaled to the person's
  own other frames the range closes to 0.84-1.00.

Caveats: each person's frames come from one 14 s clip, so they are more alike than two sessions would be, and
"biggest" here is whatever smile the clip contained, not a smile made on request.

## 3. Bad conditions

Eight of the pulse videos (every second person, first 35 s) and 16 of the clips (8 smiling, 8 neutral) were run
again after `ffmpeg` filters that imitate a hall: less light with camera noise, a backlit face, a noisy camera, half
the frame rate, half the resolution (`make_conditions.py`). These are filters on good video, not footage from a dark
room. "Unchanged" is the like-for-like baseline for this subset.

| Condition | Skin brightness (0-255) | Face found | Pulse shown | Pulse error when shown | Clear smiles found |
|---|---|---|---|---|---|
| Unchanged | 176 / 136 | 100 % / 99.7 % | 83.4 % | 0.8 bpm (33 windows) | 100 % |
| Half the light, some noise | 87 / 66 | 100 % / 99.9 % | 5.1 % | 1.8 bpm (2 windows) | 100 % |
| Quarter of the light, more noise | 42 / 33 | 100 % / 94.3 % | 0 % | none shown | 100 % |
| An eighth of the light | 20 / 16 | 87.5 % / 55.1 % | 0 % | none shown | 46.5 % |
| Backlit (dark face, flat contrast) | 74 / 66 | 100 % / 90.3 % | 0 % | none shown | 97.6 % |
| Normal light, heavy noise | 176 / 136 | 100 % / 99.9 % | 0.2 % | none shown | 100 % |
| 15 frames a second | 176 / 136 | 100 % / 99.6 % | 79.0 % | 0.8 bpm (33 windows) | 100 % |
| Half resolution (face about 65 px) | 176 / 136 | 100 % / 99.8 % | 83.6 % | 0.9 bpm (34 windows) | 100 % |

Where two numbers are given: pulse videos / face clips. The worst pulse error shown in any condition was 4.1 bpm.
The added noise is random per pixel and per frame, with a spread (sd) of about 3, 4.6, 5.8, 4.6 and 7.5 grey
levels out of 255 in rows 2, 3, 4, 5 and 6.

- **Smile and face** hold down to a quarter of the light, at 15 fps and at half resolution. They break at an eighth
  (skin brightness about 16): the face is found in half the frames and half the smiles are missed.
- **Pulse** needs a clean picture, and then shows no number rather than a wrong one. A second run on the same
  eight videos separates light from noise: unchanged 82 % shown; half the light with no added noise 77 %; normal
  light with noise of about 1 grey level 79 %; with noise of about 3 levels 23 %. So darkness alone does not stop
  the pulse. The noise a camera adds when it is short of light does.
- **Neutral faces** in this subset were called a smile in 6 % of frames unchanged and 0-12 % degraded. All of those
  frames come from one clip (a man in cold dim light whose resting score sits at 0.13-0.21).

## Thresholds for the app

`web/src/sense/conditions.ts` holds these as `CAMERA_LIMITS` and `cameraIssues(sense.debug(), lastFaceFrame)`
returns which ones are broken. Outside them readings still arrive; they were measurably worse.

| Check | Limit | Why | Tell the person |
|---|---|---|---|
| Face width (`debug().faceW`, camera pixels of the 640 x 480 picture) | at least 100 px | neutral called a smile 28 % below, 6 % above; face found 82 % under 80 px | come closer |
| Head turn (`FaceFrame.yaw`) | within 20 degrees | false smiles 8 % under 10 degrees, 17 % at 10-20, 29 % beyond | face the camera |
| Skin brightness (`debug().rgb` as luma) | at least 40 | face found in 94 % of frames or more from 33 up, 55 % at 16 | find more light |
| Skin brightness, for a heart rate | at least 80 | pulse measured at 87-184 on a clean picture; untested below. Brightness alone is not enough: camera noise stops it | more light on your face, hold still |
| Pulse quality | keep the 0.3 gate | at 0.2 coverage rises 5-7 points but single errors of 8-17 bpm get through; at 0 up to 65 bpm | |
| Frame rate | 15 fps is enough | pulse shown 79 % at 15 fps against 83 %; stalls cost more than a low steady rate | |

When the face is still and bright enough but no pulse appears for 10 s, the picture is too noisy: ask for more
light rather than waiting. The app cannot see camera noise directly; the pulse quality is its only sign of it.

## What we changed in the code

- **`rppg.ts`: a stall no longer restarts the pulse.** A gap of more than 0.4 s between frames used to restart the
  estimate, costing 7.6 s without a number; the limit is now 1 s. On the same recordings, only this constant
  changed: on a stalling device (real time on the loaded server) restarts fell from 68 to 22 and coverage rose
  from 51.3 % to 56.0 %, error 1.20 to 1.25 bpm, worst window 5.4 to 5.5 bpm. With steady frames nothing changes
  (81.1 to 81.2 %). Bridging 2 s or more let a 63 bpm error through, so 1 s it is.
- **`conditions.ts` (new):** the thresholds above as code, for the app to warn with.
- **`debug()`** now reports face width and position; the motion gate moved into `rppg.ts` as a class with tests.
  No behaviour change.
- Unit tests: 46 to 50, all passing (`cd web && bun test tests/sense`).

Looked at and left alone: the quality gate (0.3 is where wrong numbers stop), the smile threshold (the errors are
framing, see section 2), and the skin patches (by our estimate the noisy conditions would need about 16 times
the skin pixels, and a face has about 5 times more than the patches use).

## Limits

- Pulse: one dataset, 16 of 42 people, sitting still, good light, uncompressed webcam video. No phone camera, no
  talking, no walking, skin tones not recorded. In the simulated hall conditions coverage fell and the numbers shown stayed right; a
  real phone in a real hall was not tested.
- Frame rate on a phone was not measured, and coverage depends on it.
- Smile: one rater, six frames per clip, stock footage (actors, mostly posed). Few people with medium or dark skin.
- The 82 clips left out by the first pass were not looked at: 54 had no face found in any frame, 27 in under 60 %.
  Many show no person facing the camera, but some are real misses, so 93 % is the rate for clips where a person
  does face the camera, not for any footage.
- Bad conditions are simulated. Real dim light adds motion blur and the camera's own noise removal.
- The framing limits (20 degrees, 100 px) were chosen on the same clips they are reported on.
- Heart swing: checked on the same 16 still people, who were not breathing to a pacer; a known paced swing is
  simulated beats and synthetic video only. No person has breathed to the app's pacer beside an oximeter.
- Not tested: voice, head movement, AirPods sensors, and anything about mood.

## Files

- `results-pulse.jsonl`, `results-smile.jsonl`, `results-robustness.jsonl`: one line per video.
- `results-swing.jsonl`: one line per 20-second window. `swing_validation.ts` writes it from the section 1 runs.
- `summary.json` (same file as `web/public/validation.json`): the numbers the app shows. Built by `build_summary.py`.
- `smile_labels_by_sheet.txt`: the hand labels. `make_label_sheets.py` made the contact sheets they were read from.
- Videos, raw readings, scores and logs: **`/bulk2/runs/depression/validation/`** (not in git, no backup).
  UBFC-rPPG is for research use and may not be passed on; Mixkit clips are under the Mixkit free licence. No video
  frame or face image leaves that folder: only numbers do.

To run it again:

```
python3 -I validation/fetch_ubfc.py                      # UBFC-rPPG -> camera files (Drive may throttle)
python3 -I validation/fetch_clips.py                     # Mixkit clips -> camera files
cd web && bunx vite build --outDir /tmp/validate-builds/v1 --emptyOutDir && cd ..
bun validation/serve.mjs /tmp/validate-builds 5872 &
python3 -I validation/make_pulse_jobs.py > jobs.jsonl
node validation/run_lab.mjs --jobs jobs.jsonl --out RAW/pulse --url http://127.0.0.1:5872/v1/ --parallel 16
python3 -I validation/score_pulse.py RAW/pulse SCORES/pulse_v1_warp.jsonl
python3 -I validation/score_smile.py RAW/smile SCORES/smile_v1.jsonl
python3 -I validation/make_conditions.py pulse subject1,subject4 > robust_jobs.jsonl
python3 -I validation/score_robust.py RAW/robust_pulse RAW/robust_smile SCORES/robust_v1.jsonl
bun validation/swing_validation.ts                       # heart swing: needs RAW/pulse_v1_warp and the UBFC ground truth
python3 -I validation/build_summary.py
```

The synthetic paced videos for the heart swing: `python3 -I web/tests/sense/synth_pulse.py still.rgb 480 640 60 swing:8 |
ffmpeg -f rawvideo -pix_fmt rgb24 -s 480x640 -r 30 -i - -pix_fmt yuv420p swing8.y4m`, then
`node web/tests/sense/lab-e2e.mjs --video swing8.y4m --ping full` three times each, reports saved as
`/bulk2/runs/depression/validation/swing/browser-v2/browser-<swing>-<run>.json`.

## 4. Detection simulation: what the clinic would see if an echo fades

This is a planning simulation, not patient evidence. `validation/detect.ts` calls the shipped functions in
`server/engine.ts` (`computeBaseline`, `analyze`, `strengthOf` and the real EWMA/status rule) for made-up people.
It writes one JSON line per cell to `validation/detect.jsonl` and the page-sized summary to
`web/public/detect.json`.

Run it with:

```sh
bun validation/detect.ts
bun test validation/detect.test.ts
```

The fixed seed is `20261114`, with 4,000 people in every cell, a 14-day clinic baseline and 84 home days. Home
adherence is 1.0, 0.7 or 0.5. Each person's channel has its own centre and spread; one day's independent noise is
0.55 of that spread. The run is repeated with and without a non-relapse AR(1) wobble (rho 0.9, stationary SD 0.35
spreads). Missing channels use the validation read rates where they exist: smile 93.2% and heart 71.9%; voice 90%
and move 90% are planning assumptions because they are not in that validation. Heart is therefore missing most often.
A relapse starts on a random home day 14 to 56, slides for 14 days by 0, 0.25, 0.5, 0.75, 1, 1.5 or 2 of that
person's spreads, then stays there. A second set of cells slides only smile and move. The zero-effect cells have no
relapse and give the false-call rate.

An episode is counted once when a person enters a named status after a home ping that was not already flagged. The
short-list results below use the practical 0.7-adherence, no-wobble, all-channel cells; the JSONL has every
adherence, wobble and slide variant. Percentages are people, with 4,000 in each cell. “Dipping or low” is the
clinic's early list; “low” is the stricter three-day list.

| Effect below usual | Dipping or low by 7 / 14 / 28 days | Median days (middle half) | Low by 14 days | Weekly questionnaire by 14 days / median |
|---:|---:|---:|---:|---:|
| 0.25 spreads | 6.45% / 22.33% / 52.15% | 19 (13–28) | 0.00% | 12.90% / 22 days |
| 0.5 spreads | 12.68% / 59.93% / 94.43% | 13 (10–17) | 0.30% | 24.60% / 19 days |
| 0.75 spreads | 26.90% / 91.43% / 99.98% | 10 (7–12) | 3.48% | 40.78% / 16 days |
| 1 spread | 43.05% / 98.65% / 100% | 8 (6–10) | 19.23% | 58.93% / 13 days |
| 1.5 spreads | 73.72% / 100% / 100% | 6 (5–8) | 72.00% | 84.58% / 10 days |
| 2 spreads | 92.55% / 100% / 100% | 5 (4–6) | 93.15% | 96.00% / 8 days |

With no relapse at 0.7 adherence, “dipping or low” produces **1.4904 false episodes per person-year** and flags
**18.77%** of people at least once in 12 weeks. The stricter “low” list produces 0 false episodes in this 4,000-person
cell. At 1.0 adherence the early-list cost is 2.1031 episodes/person-year; at 0.5 it is 1.0244. Turning on the
slow wobble raises the 0.7 early-list cost to 4.3322 episodes/person-year (and the strict list to 0.0358), so a
shared slow change is a serious failure mode for this rule. The smile-and-move-only variant is similar in the main
cell: 1.5002 early-list episodes/person-year and 18.60% ever flagged.

The questionnaire comparator is one scalar answer every seven days. It sees the same underlying slide, with an
independent noise SD of 0.45 person-spreads (chosen in its favour), and its threshold is calibrated to the 0.7,
no-wobble Vire early-list false-episode rate: −0.84 spreads, 1.5469 episodes/person-year. It is a reference line,
not a claim about a particular questionnaire or its clinical cut-off. The smallest tested effect where Vire is three
days earlier in median time is 0.25 spreads (19 versus 22 days), but that comparison pays the 1.4904 false-episode
cost above; no effect is both three days earlier and under the planning bar of one false episode per person-year.

These numbers do not show that a relapse really moves a smile, voice, heart or head movement, that the four channels
move together, or that a short-list call changes an outcome. They also do not model sleep, medication, changing
prompts, treatment, a clinician's workload, or a person who stops pinging. The only answer they provide is conditional:
if a person's readings slide by a specified amount, this detector has the stated delay and false-call cost.

`explore_pulse.ts` and `gate_curve.py` replay recorded skin colour through the estimator with other settings (how
the stall limit and the quality gate were checked); `replay_pulse.ts` does the same with the shipped class.
