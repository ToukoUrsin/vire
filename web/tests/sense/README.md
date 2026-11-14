# Sense tests

Unit tests (synthetic signals, no browser):

    cd web && bun test tests/sense

Browser runs of `/#/lab` against fake camera and mic files. The files are large and live outside the repo in
`/bulk2/runs/depression/sense-fixtures` (no backups; rebuild with `tests/sense/make-fixtures.sh`, sources and
licences are listed at the top of that script). Screenshots go to `out/` in the same folder.

    cd web && bunx vite --port 5872 --strictPort --host 127.0.0.1     # the lab
    node tests/sense/lab-e2e.mjs --video talk.mjpeg --audio talk.wav --seconds 30    # real talking face: pose, voice, honest pulse
    node tests/sense/lab-e2e.mjs --video pulse72.y4m --seconds 30                    # 72 bpm on a real face
    node tests/sense/lab-e2e.mjs --video evm.y4m --seconds 30                        # real pulse (about 53 bpm)
    node tests/sense/lab-e2e.mjs --video swing66.y4m --audio talk.wav --ping full    # full ping through the lab buttons
    node tests/sense/lab-e2e.mjs --video smile.mjpeg --smile-loop 13.3333            # smile latency: 1500 ms expected
    node tests/sense/lab-e2e.mjs --video pulse72.y4m --url "http://127.0.0.1:5872/?audio=0#/lab"   # camera only
    node tests/sense/lab-webkit.mjs            # Safari engine (Playwright WebKit), canvas camera + tone
    node tests/sense/lab-webkit.mjs --deny     # permission denied: the error text

Each prints one JSON report. Headless Chrome has no real GPU: the face model starts on the GPU delegate, measures
itself and moves to the CPU after about a second (`?delegate=cpu` or `?delegate=gpu` in the URL pins it).

Accuracy on real people (heart rate against a finger oximeter on 16 people, smile and face on 62 people, bad
light): `validation/README.md`. The limits it found are in `src/sense/conditions.ts`.
