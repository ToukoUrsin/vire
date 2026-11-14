# Shared head-motion model evidence

Updated 2026-11-14 (UTC). The experiment ran to the end. **The shared model does not clearly beat the small
per-person models by the protocol's own rule.** It is much better at smiles, the same at nods and a little worse
at head shakes. A new user cannot skip the teaching minute, and half a minute is not enough.

This is one person (the founder) and four teaching minutes. The public labels are posed gestures, not depression.
AirPods measure head motion; they do not read brain activity, and nothing here is a clinical claim.

## Result

AUC on held-out minutes. Each minute was scored by models that never saw it. All four conditions are scored on
exactly the same windows: (a)'s own held-out windows that have 2 s of motion behind them.

| Event | Windows (positive) | Episodes | (a) small per-person model today | (b) shared, fine-tuned on the other minutes | (c) shared, no teaching | (d) shared, fine-tuned on half a minute |
|---|---:|---:|---:|---:|---:|---:|
| smile | 2,299 (564) | 23 | 0.657 | **0.781** | 0.779 | 0.645 |
| nod | 2,336 (362) | 10 | **0.959** | 0.958 | 0.941 | 0.939 |
| shake | 2,343 (353) | 10 | **0.968** | 0.948 | 0.811 | 0.612 |
| mean | | | 0.861 | 0.896 (+0.035) | 0.844 (−0.018) | 0.732 (−0.129) |

"Episodes" counts separate asked-for bouts with at least two positive windows, as the app counts them. (a) on all
of its own windows (17, 18 and 10 more, without the 2 s cut) scores the same: 0.655, 0.958, 0.968.

## Verdicts

- **Does it beat the small models? No, not clearly.** The rule was: higher on all three events, +0.05 mean, no
  event down more than 0.03. (b) is +0.12 on smile, even on nod, −0.02 on shake, +0.035 mean.
- **Can a new user skip the teaching minute? No.** (c) is below (a) on nod and well below on shake (0.811).
  Its smile (0.779) is better than today's taught smile, though.
- **Does half a minute do? No.** (d) is below (a) on all three; shake falls to 0.612.

One thing worth knowing: today's smile model is the weak spot. With four minutes it scores 0.657, and on one
minute it is below a coin (0.318). The shared model's smile is steadier (0.60 to 0.99 per minute for b). That
is a lead for the smile only, on one person; it is not a result yet.

## Longer pretraining did not change the verdicts

Decided before looking: the 6-epoch run is the result above, and one longer run (20 epochs) is reported as a
check, whatever it shows. With 20 epochs: (b) 0.797 / 0.967 / 0.932 (mean 0.899; shake −0.036, so still no clear
win), (c) 0.814 / 0.941 / 0.651, (d) 0.662 / 0.944 / 0.786. On held-out EarSet people the longer run was barely
better (balanced accuracy 0.373 against 0.369).

## What was trained

- **Data:** EarSet ([Zenodo 8142332](https://zenodo.org/records/8142332), CC BY 4.0). 1,094 earbud IMU files,
  30 people, about 100 samples a second; 56.8 h of file time, counting left and right ear files separately.
  Downloaded and read only inside Modal, on a Modal Volume. Nothing from it is in the repository or on the box
  beyond counts and the trained weights.
- **Units and axes:** EarSet gives raw counts. The scales were read off the archive: 16,384 counts per g from the
  still files; 32.8 counts per degree a second from how fast gravity turns in the nod files (measured 44, the
  nearest standard gyro range). Gravity was taken out with a complementary filter. Axes were renamed so the nod
  axis is x and the shake axis is z, as on the AirPods. Check: EarSet nods turn about 43°/s on x, the founder's
  50 to 80; EarSet shakes 85°/s on z, the founder's 92 to 132.
- **Classes:** 18 activities (brow lowerer and raiser, chewing, chin raiser, eyes left-right and up-down,
  lip puller, mouth stretch, nod, running, shake, speaking, still, swallowing, tilt, walking, wink left and right).
  Calibration and sync recordings were dropped. Every class drawn equally often.
- **Model:** the protocol's small two-layer 1-D conv net (32 and 64 filters, mean and max pooling), six channels,
  2 s windows at 50 a second. Random rotation up to 25°, axis sign flips, size change and noise while pretraining.
- **Training:** about 400,000 windows (2 s, every 0.5 s). Five people held out to check it: balanced accuracy 0.369
  over 18 classes (chance 0.056); one-against-rest AUC nod 0.895, shake 0.856, lip puller 0.745.
  6 epochs, AdamW, one-cycle learning rate, checkpoint and progress file written to the Volume after every epoch.
- **GPU and time:** one Nvidia T4. 63 s for 6 epochs, 231 s for the 20-epoch check. Preparing the data took 46 s
  on 16 CPUs.
- **Per person, in a network-blocked Modal Sandbox:** (a) today's `sandbox/search.py`, unchanged, 366 candidates,
  every one finished (34 s on 32 CPUs; given 240 s instead of the app's 40 s, so (a) is at its best). (b), (c), (d)
  on 4 CPUs in 80 s. The fine-tune recipe was fixed before any result: the pretrained conv layers plus a new
  smile/nod/shake head started from the lip-puller, nod and shake outputs; 400 steps of 64 windows; equal weight
  to positives and negatives; three seeds averaged. For (d) the half minute is the first 32.5 s of the minute
  recorded just before the held-out one (for the earliest minute, the one just after). For (c) the score is the
  pretrained probability of lip puller (smile), nod and shake.

## Protocol (fixed before results, unchanged)

1. Only minutes with `device.hz >= 15`: four minutes (50, 46.2, 50 and 49.2 samples a second). The 6 Hz minute
   is left out.
2. The search's own events, labels and scoring: smile, nod, shake; AUC with windows and episodes. Whole-minute
   hold-out. For every held-out minute the search picks its model on the other minutes only.
3. The four conditions on the same windows. "Clearly wins" means higher AUC on all three events, at least +0.05
   mean AUC, and no event down more than 0.03. A skip claim needs (c) to beat (a); a shortening claim needs (d)
   to beat (a).
4. Public pretraining only on Modal; per-person fine-tuning and scoring only in a network-blocked Sandbox.

The baseline in the earlier version of this report used two minutes (smile 0.828, nod 0.838, shake 0.936). With
four minutes nod and shake went up and smile went down.

## Earlier runs, discarded

The first parser rejected EarSet's millisecond timestamps. The next run trained only on "talk" windows, because
the archive starts with speaking files. A balanced rerun was stopped before it returned weights. None of these
count. The reader was rewritten (`earset.py`): it reads the files by name, puts them in the AirPods' units and axes,
and the training writes weights every epoch.

## Limits

- One person, four minutes, ten nod and ten shake episodes. Differences of 0.02 in AUC are within noise here.
  No confidence intervals.
- Labels come from the phone's camera, not from a person checking each window.
- EarSet is other people, other earbuds and posed gestures. The gyro scale was inferred, not read from a datasheet.
- The shared model reads six channels; today's search also reads the AirPods' attitude angles.
- Gesture labels only. Nothing here measures mood, depression or brain activity.

## Cost

About $0.25 of Modal for this run (T4 about 6 minutes including start-up, CPU sandboxes a few minutes),
estimated from Modal's list prices; the billing page was not opened. Under $1 for the whole experiment,
including the earlier stopped runs. Nothing is left running on Modal; the apps are stopped. The archive stays on
the Modal Volume `vire-shared-model-data`.

## Files

Code: `sandbox/shared_model/` (`earset.py`, `model.py`, `modal_pretrain.py`, `run_baseline.py`, `search_keep.py`,
`prepare_labels.ts`, `run_modal_eval.py`, `sandbox_eval.py`, `README.md`). Run output, logs and weights:
`/bulk3/runs/depression/shared-model/v2/` (not in git). No recordings, per-window numbers or names are in the
repository. No product code was changed and nothing was deployed. Wiring a shared smile detector into the app,
if wanted, is the lead's call.
