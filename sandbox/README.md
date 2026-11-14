# The ear search

After every teaching minute the phone makes a quick model itself (about 13 small models, a second or two).
The same minutes then go through a far wider search here, and the better model goes back to the phone by itself.

How it runs:

1. The server keeps the minute and queues one search for that device (`server/earjobs.ts`).
2. `server/ear-worker.ts` takes the job with every minute that device has sent and starts `modal_runner.py`.
3. `modal_runner.py` starts one Modal Sandbox for that person: no network (`block_network=True`), the minutes
   go in over stdin, the model comes back over stdout, and the sandbox is gone after at most four minutes.
4. Inside, `search.py` tries 366 models in parallel on all the minutes: logistic and linear models, boosted
   trees and small networks on hand-made numbers over five window lengths, and conv nets on the raw motion
   at 50 samples a second.
5. Every model is checked on a whole minute it never saw (a whole round when there is only one minute). The
   model for each thing is chosen without the minute it is then scored on, so the score on screen is not
   flattered by the choosing.
6. The phone's own code (`web/src/tune/ear`, run with bun) makes the numbers going in and scores the answers
   coming out, and each chosen model must read the same there as it did in Python, or it is left out.

Run it:

- `uv tool install modal` once on the machine that runs the worker, then `sandbox/run-worker.sh https://the-server`.
- Without Modal: `VIRE_MODAL_LOCAL=1 python3 sandbox/modal_runner.py < minutes.json` (needs bun, numpy,
  scikit-learn and torch on this machine).
- By hand: `python3 sandbox/search.py minutes.json out.json --jobs 8`.
