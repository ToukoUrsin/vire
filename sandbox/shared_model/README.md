# Shared six-axis model experiment

Does a head-motion model pretrained on public earbud data, then fine-tuned per person, beat the small per-person
models Vire's search finds today? Result and protocol: `pitch/evidence-shared-model.md`.

Files:

- `earset.py`: reads EarSet (Zenodo 8142332, CC BY 4.0) and puts it in the AirPods' units and axes (calibration read
  off the archive itself). Runs only inside Modal.
- `model.py`: the two-layer 1-D conv net over six channels, 2 s at 50 a second, and the shared helpers.
- `modal_pretrain.py`: Modal app. `prep` (CPU) downloads the archive into the Volume `vire-shared-model-data`,
  calibrates and windows it; `train` (T4) trains with balanced classes and writes a checkpoint and a progress file
  to the Volume after every epoch; `fetch` reads the weights back.
- `run_baseline.py` + `search_keep.py`: condition (a), today's `sandbox/search.py` (unchanged) in a network-blocked
  Modal Sandbox, keeping its held-out answers so every condition is scored on the same windows.
- `prepare_labels.ts`: adds the phone's own camera labels (`web/src/tune/ear/labels.ts`) to the minutes.
- `run_modal_eval.py` + `sandbox_eval.py`: conditions (b), (c), (d) in a network-blocked Modal Sandbox.

Rerun (Modal credentials from the vault; output goes to `/bulk3/runs/depression/shared-model/`, never the repo):

```sh
modal run sandbox/shared_model/modal_pretrain.py --step prep --out prep.json
modal run sandbox/shared_model/modal_pretrain.py --step train --epochs 6 --tag e6 --out train.json
modal run sandbox/shared_model/modal_pretrain.py --step fetch --tag e6 --out shared.json
python sandbox/shared_model/run_baseline.py minutes.json baseline.json
bun sandbox/shared_model/prepare_labels.ts minutes.json labelled.json
python sandbox/shared_model/run_modal_eval.py shared.json labelled.json baseline.json eval.json
```

`minutes.json` is `{"minutes": [...]}`: one person's full-rate teaching minutes (`device.hz >= 15`), oldest first.
The model is an experiment artifact, not a product candidate; nothing here is wired into the app.
