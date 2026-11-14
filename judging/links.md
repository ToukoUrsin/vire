# Live product

https://vire.fly.dev/

The links the team gave are in `submission.md`.

At the table a judge sees it on the founder's phone (he wears AirPods Pro 3) with a big screen next to it. Phone size is 390x844.

The product uses the camera and the microphone. On this machine a headless Chrome can be given a recorded face and voice in place of a camera:

- Chrome: `/usr/bin/google-chrome`; Playwright for node: `/home/ubuntu/.local/lib/node_modules/playwright`
- flags: `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-video-capture=<clip> --use-file-for-fake-audio-capture=/bulk2/runs/depression/sense-fixtures/talk.wav`
- clips for the camera, in `/bulk2/runs/depression/sense-fixtures/`:
  - `evm.y4m`: a real face, uncompressed, sitting still, with a real pulse the camera can read (MIT's Eulerian video magnification clip). Use this one to see the heart channel.
  - `smile.mjpeg`: a real person who smiles once every 13 s. `talk.mjpeg`: a real person talking. Both are web video, compressed so hard that no camera could find a pulse in them: with these the app leaves the heart out and says so. A live face in front of a phone is not compressed.
  - `swing66.y4m`: a still photo with a synthetic pulse, for testing only.
- The server keeps test browsers off the hall wall (a browser whose user agent says HeadlessChrome, Playwright and the like), so that the team's own tests do not show up as hall guests. To be counted like the phone of someone in the hall, give the browser context a normal phone user agent.
- This machine starts and stops many containers, so its network interfaces change often. A page load in Chrome here can fail with `net::ERR_NETWORK_CHANGED`. That is this machine, not the product: load the page again.
