# Clinic dev tools

Everything here is for developing and checking `web/src/clinic/`. Nothing in this folder ships in the app
except `synth.ts`, which the mock data and the simulated live signal import.

| File | What it does |
| --- | --- |
| `synth.ts` | Synthetic 58 s ping: samples, stored traces, an echo, and a message player. No DOM, runs in bun. |
| `fakeSensor.ts` | Connects to the relay as a sensor and plays one synthetic ping, in the phone's conventions (epoch timestamps, voice level in dBFS). |
| `shots.mjs` | Screenshots every clinic route at 1440x900 and 390x844, on mock and real data, and prints console errors. |
| `liveReal.mjs` | Plays `fakeSensor.ts` through the real relay and screenshots three viewers (lobby auto-open, room `*`, phone). |
| `actions.mjs` | Clicks "Request booster session" and "Mark called" and checks the state on the page, in the list and on the server. |
| `stageShots.mjs` | The stage mirror (`../stage/`): every state of the simulated show at 1920x1080, 1440x900, 1280x720 and phone width. Prints paint cost, console errors and anything outside the screen. |
| `stageReal.mjs` | Plays `fakeSensor.ts --show` through the real relay, follows it on a 1920x1080 mirror with a video, and checks cold join, a dropped socket, the lobby, room `*` and `?debug=1`. Exits 1 on a failed check. |
| `stagePhone.mjs` | A headless phone with a fake camera and microphone runs the real patient app (tune, ping, echo, dose, measure again) and the mirror follows it. Adds one `test-stage-…` person on the server. |

```sh
cd web && bunx vite --port 5874 --strictPort            # dev server, proxies /api to 127.0.0.1:8871

bun web/src/clinic/dev/fakeSensor.ts --room DEMO01 --name Aino     # then open /#/clinic/live
bun web/src/clinic/dev/fakeSensor.ts --vigor 1.1 --loop            # a good day, on repeat

node web/src/clinic/dev/shots.mjs    http://127.0.0.1:5874 /bulk2/runs/depression/clinic both
node web/src/clinic/dev/liveReal.mjs http://127.0.0.1:5874 /bulk2/runs/depression/clinic
node web/src/clinic/dev/actions.mjs  http://127.0.0.1:5874 /bulk2/runs/depression/clinic http://127.0.0.1:8871 real
```

## The stage mirror

```sh
cd web && bunx vite --port 5877 --strictPort

bun web/src/clinic/dev/fakeSensor.ts --room DEMO01 --name Aino --show     # tune, ping, echo, dose, measure again (135 s)
node web/src/clinic/dev/stageShots.mjs http://127.0.0.1:5877 /bulk2/runs/depression/stage/shots 1080,900,720,phone 'laugh|echo'
node web/src/clinic/dev/stageReal.mjs                                      # defaults: 5877, /bulk2/runs/depression/stage/real, 8871, room STAGE7
node web/src/clinic/dev/stagePhone.mjs                                     # defaults: 5877, /bulk2/runs/depression/stage/phone, swing66.y4m, talk.wav
```

- `fakeSensor.ts --show` takes `--cam` (no AirPods), `--no-ear`, `--no-mesh`, `--no-muscles`, `--no-tune`, `--bare-tune`,
  `--no-dose`, `--mini-echo`: each leaves out one of the optional wire fields, the way an older phone build would.
- Without a phone: `/#/clinic/live/DEMO01?mock=1` plays the same show in the page. `sim=idle|old|cam|noear|nomesh|nomuscles|baretune`,
  `tune=0`, `dose=0`, `miniecho=1`, `name=`, `at=<seconds>` (start there), `debug=1` (what arrives on the wire).
- In the console: `__stage` (the store), `__stageLoop` (`fps`, `cost` in ms of painting per frame), `__stageSeek(sec)`
  (simulated show only), `__stageDrop()` (closes the socket, to watch it come back).
- The lobby (`/#/clinic/live`) opens the newest room and `*` follows whoever started something last. With other test
  phones on the same server that can be someone else's: open `/#/clinic/live/CODE` to stay with one phone.
- Frame rate means little in headless Chromium on a busy box. `cost` is the number to watch: 0.1 to 1.5 ms a frame.

The `.mjs` scripts need a global Playwright (`npm i -g playwright`, chromium in `~/.cache/ms-playwright`).

## Where the screenshots are

Not in git: `/bulk2/runs/depression/clinic/` (no backups).

- `mock-*` and `real-*`: the list and patient pages on the built-in mock and on the real server
- `live-*`: the live mirror on the simulated signal, one frame per phase and the echo
- `livereal-*`: the live mirror fed through the real relay
- `/bulk2/runs/depression/stage/shots/`, `real/` (with `stage-real.webm`) and `phone/` (with `stage-phone.webm`): the stage mirror

## Mock data

Add `?mock=1` to any clinic URL (`/#/clinic?mock=1`) to use the built-in cohort in `../mock.ts`. The same
mock takes over by itself when the API cannot be reached, and the top bar then says "Mock data".
