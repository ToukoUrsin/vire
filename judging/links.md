# Live product

https://vire.fly.dev/

The links the team gave are in `submission.md`.

At the table a judge sees it on the founder's iPhone (he wears AirPods Pro 3) with a laptop next to it. Phone size is 390x844, laptop 1440x900.

The main flow, Today, needs AirPods: the team's iPhone app, or a Mac with their helper. You have neither. Judge what a judge without AirPods reaches from the first screen: the replay of a run, the clinic and its big screen, and the one-minute camera check behind "No AirPods?".

How to open it on this machine:

- Use Playwright WebKit for node (`/home/ubuntu/.local/lib/node_modules/playwright`), one browser at a time, and close it when you are done. This machine starts and stops many containers, so headless Chrome here fails page loads with `net::ERR_NETWORK_CHANGED`. That is this machine, not the product.
- WebKit here plays no sound you can hear and has no camera. For sound, check that audio is requested and playing (the page's own state, the network requests for the sound pieces), and say what the page does when sound is blocked. For the camera check, say what the product does when the camera is refused; do not count the missing camera against it.
- The server keeps test browsers off the hall list (a user agent that says HeadlessChrome, Playwright and the like), so the team's own tests do not show up as hall visitors.
- Leave the live site as you found it. If you book a booster on the clinic list, cancel the booking afterwards. Press "Re-train the whole clinic" at most once.
