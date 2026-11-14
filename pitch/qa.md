# The hardest questions

Two or three sentences each, then stop. If you don't know, say "we don't know yet" and what would tell us. Row numbers point to `claims.md`; the evidence is in `evidence-loop.md`, `evidence-tms.md` and `evidence-airpods.md`.

## The loop

**1. Do AirPods read the brain?**
No. They have no such sensor. They feel head movement, and AirPods Pro 3 give apps heart rate in beats a minute during a workout. At Aalto's booth I wear their EEG and my AirPods together, and Vire only logs the AirPods next to their EEG. (rows 133, 132)

**2. What exactly is the loop?**
Your day against your own usual. When it drifts, a practice in your ears: slow breathing, a body scan or a short walk. The same check before and after says what changed, and over days Vire learns which practice works for you. When practices don't fix the drift, your clinic sees you first. (rows 104 to 117, 123)

**3. Does a two-minute practice lower depression?**
Nothing shows that, and we don't say it. Slow breathing around six a minute makes the heart rate swing more with each breath while you do it. As a programme of weeks, breathing with heart-rate feedback lowered depressive symptoms by a small to medium amount, mostly in people whose main problem was something else. (rows 124, 125)

**4. So you copied Meru Health?**
We took their breathing. Meru Health put it into a programme of weeks with a therapist, and the whole programme beat a waiting list in a randomised trial. Nothing shows what the breathing did on its own. What we add is the AirPods measuring each step, and a clinic that sees when it isn't working. (row 126)

## The sound

**5. Why does the sound slow down?**
Tones that follow the breath can lead people into slow breathing; that was shown with a medical device in blood-pressure trials. Ours steps from your own pace toward six a minute, and only when the AirPods read your breath following it, or a still head when no breath can be read. Two misses and it eases back. (rows 106, 127)

**6. Can AirPods really read breathing?**
Not proven. Earbud motion has read breathing rate in research when people kept still, but nobody has tested it on AirPods or at six a minute. That's why the screen says whether the sound went by your breath or by a still head. (rows 106, 128)

**7. Is it music therapy?**
No. It's a sea and a second sound made by an open model, MusicGen-small, on a Modal GPU. Thirty pieces were made ahead, and during a practice the phone asks for a new one from what the AirPods just read. A piece takes about 27 seconds, so the new ones come about half a minute behind. No voice, a bell marks the steps. (rows 113, 115)

## The heart rate

**8. HRV from AirPods?**
No. Apple gives apps heart rate in beats a minute, only during a workout session on an iPhone, and we found no beat-to-beat data for apps. The app checks the samples came from the AirPods. A swing with each breath is said only with at least three samples a breath and when it stands out. Otherwise the screen just says the heart rate settled. (rows 30, 111, 112)

**9. How good is AirPods heart rate?**
Within about 2 beats a minute of a chest strap in 40 healthy people on a treadmill, read during a workout (Doherty 2026). That was Apple's own workout recording, not an app reading it live like ours. On mine tonight: [REAL: heart]. (row 75)

## The learner

**10. Three practices isn't learning.**
Right, so it doesn't claim it. It says "Vire learned: for you, X helps most" only with at least three scored practices of the best kind, two each of two kinds, and the best on top in 80% of 2,000 draws. Before that, "So far" or "Too early to say". (row 108)

**11. Does picking per person beat picking at random?**
Nobody has shown it. Learning which session suits a person is how researchers test this, in micro-randomised trials. The one trial we found that set learned choice against random saw a small gain in one of three outcomes. (row 129)

**12. Isn't "stiller after" just regression to the mean?**
It could be part of it. That's why it's scored against the check just before, by person and by practice, and why the clinic gets the counts, not a verdict. A pilot with a random arm would tell us. (rows 105, 108)

**12b. You call a stiller head good after a practice, and less head movement bad on the clinic list. Which is it?**
They're two measures. On the list it's how much I move through a whole day: moving less than my own usual is the change the clinic watches. After a practice I'm asked to sit still for 22 seconds, and what's left is fidgeting: less of it means calmer, and that's all "Calmer after" says. Neither is good or bad on its own. Both are compared with my own usual. (rows 105, 122)

## The clinic and the booster

**13. Does an earlier booster help?**
Nobody knows. Benefit fades: 46% still respond a year later. Bringing TMS back when people got worse got the benefit back for 32 of 38, in an open study with no control group. A scheduled monthly session didn't beat watching and re-treating in a small pilot, and the evidence is rated low. So "on demand, when you drift" is worth testing, not proven. (rows 2, 3, 4, 130)

**14. Does drift mean relapse?**
We don't know, and nobody has tested earbud motion against depression. Drift is change from your own usual, a signal for the clinic, not a diagnosis. The pilot measures whether it moves with symptoms. (row 84)

**15. Isn't less movement just tiredness, or a bad night?**
It could be, and one study even found more head movement before a first depression. So Vire never says slower is worse: it flags change from your own usual that the practices didn't answer, and the clinic decides. (row 68)

**16. Has any clinic used it?**
No. No patient and no clinic. The clinic's patients are simulated, and every clinic screen says so.

## Modal and the models

**17. What does Modal actually do?**
Three things ran. Each person's model is searched in their own Sandbox with the network blocked: 366 models, 46 seconds on my minutes. The whole clinic at once: the 50 simulated patients on the clinic list, one Sandbox each with a shorter search, over 9,000 models in all in about half a minute, and each re-learned which practice helps that patient. And the sound on a T4 GPU. (rows 113, 119 to 121)

**18. 366 models on three minutes. Isn't that overfitting by search?**
It would be if we scored on the data we picked with. Each model is chosen without the minute it's scored on, so trying many can't flatter the score. On a whole minute it never saw, my nod scored 0.97, head shake 0.97, smile 0.64. (rows 97, 119)

**18b. Does the model still work later, without the camera?**
Once so far. Four hours after I taught it, I did a check-in with the camera off, through the Mac instead of the phone. Replayed over that minute, my model heard 3 of 3 asked nods and 3 of 3 asked head shakes, and nothing when it wasn't asked. One minute, one person: a start, not a study. You can watch that minute at vire.fly.dev/#/heard. (row 134)

**19. Why not one shared model?**
In one earbud study, a model trained on the person read face movements 89.9% right, one model for everyone 42.1%. We tried it: a shared model pretrained on a public earbud dataset (EarSet, 30 people) on a Modal GPU, fine-tuned per person. It didn't clearly beat the per-person search: better at smiles (0.78 against 0.66), even at nods, a little worse at head shakes. Without the teaching minute head shakes fell to 0.81. So we kept the search and the teaching minute. One person, four minutes. (rows 69, 131)

**20. Do AirPods read smiles?**
Not well enough yet. My smile scored 0.64, where 0.50 is luck, so the camera keeps smiles. Nods and head shakes are read from the AirPods alone. (row 119)

**21. AirPods give apps 25 samples a second. Isn't that too slow?**
Two papers report 25 as the most the API gives on older AirPods. In our iPhone app, on my AirPods, it was about 50 a second. Nods and head shakes are slow and big, so they survive. (rows 74, 119)

## Slots to fill

- `[REAL: heart]` from the result screen of tonight's run. If the source wasn't the AirPods, say "not from the AirPods yet".
