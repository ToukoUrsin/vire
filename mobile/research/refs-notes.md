# refs.json: what to show, and how strong it is

60 references, checked 14 Nov 2026. Every DOI was resolved on Crossref (title, first author, year matched) and the finding read in the abstract or full text (Europe PMC, PubMed Central, OpenAlex). Entries marked "repo 14 Nov" reuse the wording in `pitch/evidence-*.md` and `pitch/claims.md`. None of this shows that Vire works. No study here used AirPods to follow depression.

## Per screen: the two to show, and the honest sentence

**calls** — `yamamoto-2020`, `mundt-2012`.
Speech timing (pauses, speaking rate) is the best supported voice signal and has within-person data; time spent talking and loneliness are supported only by student samples and self-report (`mehl-2010`, `wang-2014`, `mann-2022`).

**face** — `girard-2014`, `davies-2016`.
Less head movement and less positive expression when depression is worse, seen on camera in clinic interviews; small samples, and many studies found no change (see Grant 2025 in `pitch/evidence-airpods.md`).

**music** — `aalbers-2017`, `yoon-2020`.
Music therapy with a therapist helps in small short trials; what a person chooses to listen to is weakly studied (lab choices, students), and no study links streaming data to a person's depression.

**sleep** — `baglioni-2011`, `siddi-2023`.
Insomnia roughly doubles the risk of later depression in population studies, and wrist wearables show sleep and night heart rate track symptoms in cohorts; nothing here is earbud sleep data or relapse prediction.

**heart** (use on the sleep and practice screens too) — `koch-2019`, `doherty-2026`.
Lower resting HRV in depression is a solid group difference; AirPods Pro 3 heart rate is validated once, in 40 healthy adults during workouts, in bpm only.

**movement** — `burton-2013`, `bizzozero-peroni-2024`.
Lower activity and fewer steps go with depression in meta-analyses, but the step data are observational; gait and head-down posture rest on small lab studies (`michalak-2009`, `canales-2010`, `alghowinem-2013`).

**earables** — `verma-2021`, `roddiger-2022`.
Research earbuds have read nods, posed expressions, breathing and steps in small lab studies (8 to 30 people), and personal models did far better than shared ones; none used AirPods or patients.

**practices** — `kuyken-2016`, `noetel-2024`.
Strong for full programmes over weeks (MBCT, exercise, behavioural activation), small to medium for HRV biofeedback and breathwork (`pizzoli-2021`, `fincham-2023`); no evidence that one short session lowers depressive symptoms.

**meru** — `forman-hoffman-2024`, `raevuori-2021`.
Two RCTs of the whole programme: one beat a waitlist (d = -0.8, n = 100), one found no difference from usual care on depression (n = 124); the breathing on its own has only a non-randomised comparison (`economides-2020`). Show both.

**loop** — `pratap-2019`, `zhu-2021`.
Personal models beat one shared model for mood in one phone study, and rating-scale feedback to clinicians raises remission; no trial shows that passive monitoring prevents relapse (`astill-wright-2026`), and prompts wear off (`klasnja-2019`).

**tms** — `senova-2019`, `janicak-2010`.
Durability figures are moderate evidence (one meta-analysis of mostly open follow-ups); reintroducing TMS on early worsening rests on open-label studies only.

## Looked for and could not verify (left out)

- **Nodding or back-channel rate in conversation, measured in depression.** Only hand-coded interview behaviour (`fiquer-2013`) and camera head motion; no study counting nods in everyday conversation.
- **Conversation time from earbuds and depression.** None found. Mehl's recorder work is hand-coded audio in students; StudentLife used the phone microphone. No study of earbud motion and depression either (same as the repo's 14 Nov search).
- **Streaming or listening history predicting a person's mood or depression.** `park-2019` shows time-of-day patterns only.
- **Head movement to music (groove) and depression.** `janata-2012` is healthy young adults; no depression study found.
- **Sleep from earbuds.** Ear-EEG staging (`mikkelsen-2019`) needs electrodes AirPods do not have. No AirPods sleep study found.
- **Night HRV or beat-to-beat timing from AirPods.** Apple documents heart rate in bpm during workouts only.
- **An Apple-authored validation paper for AirPods Pro 3 heart rate.** None found; only the Newsroom and Support pages. The one independent validation is `doherty-2026`.
- **Relapse after TMS predicted from any wearable.** Only a protocol (Dine 2026, in `web/src/science/refs.ts`), left out of refs.json because it has no results.

## Candidates dropped because the check failed

- Cummins et al. 2015, speech review (doi:10.1016/j.specom.2015.03.004) and Perlis et al. 1997, sleep disturbance before recurrence (doi:10.1016/s0165-0327(96)01411-5): the DOIs resolve, but no abstract could be opened.
- Hertenstein et al. 2019, insomnia meta-analysis (doi:10.1016/j.smrv.2018.10.006): abstract lookup returned a different paper. Latvala et al. 2016, resting heart rate in 1 million men: the abstract gives no figure for depression.
- Verified today but cut to stay at 60: Mehl 2006, Low 2020, Kemp 2010, Lemke 2000, Choi 2019, Carlson 2015, Wang 2018, Jacobson 2019 and 2020, Richards 2016 (COBRA), Wang and Miller 2020, Fisher 2018. Ask if a screen needs one.

## For the screen copy

- `ferlini-2022`, `prakash-2019`, `gashi-2021`: only abstracts were open and they give no sample size, so quote only the figure in `finding`.
- `mehl-2010` is about well-being, not depression: say "happier people". `tang-2020` reports a larger effect for "music medicine" than for music therapy across mixed trials; do not use it to claim listening beats therapy.
