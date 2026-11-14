# Vire demo film v3

Rerun these two commands from the repository root. Capture fails with the named step when a required selector or product event disappears; it records the deployed build and the live patient/mirror/clinic pages.

```bash
cd /home/ubuntu/junction/depression && film/capture.sh https://vire.fly.dev/
cd /home/ubuntu/junction/depression && film/render.sh v3
```

The delivery is `/bulk2/runs/depression/film/out/vire-demo-v3.mp4` and its contact sheet. Capture media stays in `/bulk2/runs/depression/film/capture/`; the HyperFrames source is generated at `film/index.html` from `film/scripts/build.mjs` and the capture metadata. Do not commit generated media or edit `film/index.html` by hand.

The capture uses a recorded face and recorded speech through the browser sensing path. It creates the visible patient **Aino** and adds a `film-…` clinic code to the live user so the run can be deleted. The film labels the input once: “Recorded face, with stand-in AirPods readings for head and heart, played into the live product.” The phone and mirror are real product pages; head and heart come from a scripted stand-in for the AirPods bridge (`film/scripts/fake-io.mjs`), not from real AirPods, and the caption says so. The clinic cohort shown in the final shot is marked simulated by the product.

## Founder replacement plates

For Sunday's reshoot, put these files in `/bulk2/runs/depression/film/founder-plates/` and rerun `film/render.sh v3` after updating the capture metadata or the plate links:

| File | Required content | Length |
|---|---|---:|
| `phone.mp4` | 390×844 phone screen recording of the one-minute check-in, dose, and re-measure | 60–120 s |
| `face.mp4` | 1920×1080 camera shot of the founder answering the phone prompts | same action as `phone.mp4` |
| `mirror.mp4` | 1920×1080 `/#/clinic/live/CODE` mirror recording | same action as `phone.mp4` |

The clips are cut by the product events in `film/assets/capture/meta.json`; keep the event order and put the founder's `phone.mp4`, `face.mp4`, and `mirror.mp4` in the same folder. The replacement plate must still show the measured onset and the four channel result; do not replace it with a graphic.

The film is 1920×1080 at 30 fps and stays below 1:58. Numbers come from the live capture, `pitch/claims.md`, or `web/public/validation.json`. The edit is intentionally honest about the loop: it shows a measured response against the person's own usual, not a diagnosis.
