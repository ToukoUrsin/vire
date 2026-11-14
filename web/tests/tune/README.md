# Tune tests

Unit tests (synthetic faces and synthetic AirPods motion):

    cd web && bun test tests/tune

Real pixels: the tune step in a headless browser, with a camera made of clips of a real face that changes when the
prompt changes. Needs the dev server (`bunx vite --port 5876 --strictPort`).

    node tests/tune/tune-e2e.mjs --set commons --size phone
    node tests/tune/tune-e2e.mjs --set commons --size 1080p --airpods sim    # made-up AirPods motion that follows the smile
    node tests/tune/tune-e2e.mjs --set commons --size phone --airpods noise  # motion with no smile in it: no ear line
    node tests/tune/tune-e2e.mjs --set ravdess --size phone                  # a second face, separate recordings per take
    node tests/tune/clip-scan.mjs commons                                    # what the model sees in each clip

Everything these write lives outside the repo, in `/bulk2/runs/depression/tune/` (no backups):

- `flow/<set>-<size>[-airpods]/` screenshots of every step
- `shots/` MuscleMap alone, phone and 1080p
- `e2e.jsonl` one line per run: timings, held-out accuracy, ranges, live reads
- `clips/` the face clips (`sources.jsonl` has where each came from and its licence), `clips/webm/` as the camera plays them
- `work/` scans and logs
