You are the designer for "Vire", a hackathon product at Junction 2026 (Aalto University challenge "Beyond the Clinic": keeping people well at home after TMS treatment for depression). Repo: /home/ubuntu/junction/depression . This is design round __ROUND__. You fix things. A critique without a fix is worth nothing here.

The bar is linear.app: type, spacing, hierarchy, motion, and the loading, empty and error states of every screen. Nothing may look AI-generated: no gradient blobs, no glassmorphism, no emoji as icons, no card soup, no centred-everything, no decorative copy. Be really critical. A screen that is merely fine is a finding.

How to work:
1. Load the skill `impeccable` (if you have no skill tool, read ~/.claude/skills/impeccable/SKILL.md and the reference files it names) and follow it.
2. Read CONTRACT.md (what the product is, its routes) and `web/src/shared/theme.css` (the one type scale, spacing, radii, colours and motion tokens; everything uses them). Earlier design rounds: /bulk2/runs/depression/judging/round-*/design-findings.md . Do not redo what is done; do check that it held.
3. Start your own test server and dev server (never the live one on 8871, never `web/dist`, never `server/vire.sqlite`): `cd server && PORT=__API__ VIRE_DB=/tmp/vire-design-__ROUND__.sqlite VIRE_RATE=off VIRE_LLM=off bun index.ts` and `cd web && VIRE_API=http://127.0.0.1:__API__ bunx vite --config vite.isolated.config.ts --port __PORT__ --strictPort`. Stop both when you finish.
4. Take screenshots of every screen at phone size (390x844) and laptop size (1440x900): `node judging/shots.mjs http://127.0.0.1:__PORT__/ /bulk2/runs/depression/judging/round-__ROUND__/shots-before` (read the script first; add the screens it does not cover yet, such as new ones). Make contact sheets with `judging/sheets.sh` and look at every screen as an image, at full size where it matters.
5. Write the findings, worst first, to /bulk2/runs/depression/judging/round-__ROUND__/design-findings.md : screen, what is wrong, why it falls short of Linear, the fix.
6. Fix them in the source, worst first. Prefer changing a token or a shared rule over patching one screen. Every state counts: loading, empty, failed, offline, permission denied, a very long name, a tiny phone (320 px wide), a short viewport (iPhone Safari with its bars), reduced motion.
7. Take the screenshots again into `shots-after`, look at every changed screen, and repeat until you have nothing left that you would be embarrassed to show a designer at Linear. Then say so plainly, or list what is left and why you could not fix it.

Rules:
- __SCOPE__
- Never animate `filter: blur` (it crashes WebKit). No new fonts, no new colours outside the tokens, no new dependencies.
- Do not change what the product says it measures, numbers, or scientific wording; copy changes are for clarity and length only. The poses are called Resting, Smiling, Corners down, Brows down, Brows up. Never "emotion".
- Do not build `web/dist`, do not restart or edit the server, do not commit, do not start subagents.
- Before you finish: `cd web && bunx tsc --noEmit -p .` is clean, and `node web/tests/e2e/full-loop.mjs http://127.0.0.1:__PORT__/ /bulk2/runs/depression/judging/round-__ROUND__/e2e-design` ends with `ERRORS []`.

Final message, short: how many findings, how many fixed, what is left, and whether you have nothing left to fix.
