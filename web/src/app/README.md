# Patient app

Entry: `PatientApp.tsx`, mounted at `/#/`. Add `?mock=1` for scripted demo signals (no camera needed).

Flow: first run -> tune (five faces, once) -> check -> ping -> echo -> dose -> mini ping -> what Vire learned -> home.
Hall guests: `/#/visit` -> ping -> echo -> "come back tomorrow" with the link to `/#/wall?u=<userId>`. A guest has their own identity and history on the phone, so they never move the owner's usual.

- `session.ts` owns the sensing session, the live socket and the wake lock. The microphone is open only during the full ping; doses and the mini ping run camera-only.
- `personal.ts` applies the saved face model (`../tune`) to every session and reads muscles, faces and the ear model during the laugh phase.
- `PingStage.tsx` runs one ping: the two-second check (limits from `../sense/conditions`), the phases, which channels could not be read and why, and what happens when the ping is interrupted.
- `Tune.tsx` mounts TUNE's flow on the real camera and a scripted stand-in on demo signals.
- `store.ts` talks to the server, falls back to `fallback.ts` (local maths, localStorage) when it is down, and keeps a small queue that is sent when the server is back.
- `words.ts` holds every sentence that speaks about a number, written from that number.
- `audio.ts` is the one AudioContext; missing clips get synthesized stand-ins.
- `mockSense.ts` is the scripted `Sense` used with `?mock=1` or when `createSense()` throws. `window.__vireMock` switches the hard cases (`dark`, `noisy`, `silent`, `faceLost`, `airpods`).

Reset: hold the Vire wordmark for two seconds.

## Checking it

The Playwright driver and its screenshots live outside git in `/bulk2/runs/depression/harden/`:

```
node scripts/run.mjs <scenario> [chromium|webkit]
```

Scenarios: `loop`, `visit`, `hard`, `offline`, `hidden`, `slow`, `nosound`, `felt`, `guest` (demo signals, both engines); `real`, `visit-real`, `airpods`, `limits`, `denied`, `nocam` (real sensing with the fake camera, Chromium only). It runs against the dev server on 5873 (`BASE=` to change).
