# Meru Health app UI: research notes (14.11.2026)

Seen: App Store (id1549162768, v2.168.0) and Google Play (com.meruhealth.app) screenshots (same 6),
meruhealth.com phone mockups and text (/how-it-works, /our-approach), 3 support.meruhealth.com biofeedback
articles. Images: `/bulk2/runs/depression/mobile/meru/`.

**Limit:** Meru publishes only 5 distinct app screens: chat, video call, breathing pacer, practice summary,
lesson (video step and an intro card). I found no screenshot of Home, Timeline or Community, and none of a
questionnaire. Everything about those is marked GUESS or NOT SEEN.

Two generations of UI are public. **Old** (store screenshots): white screens, saturated green therapist
bubbles, blue user bubbles. **New** (meruhealth.com mockups): dark-green header, cream background, beige and
pale-blue bubbles. Copy the new one.

## Navigation
Seen: bottom tab bar with 4 tabs, outline icons, label under each icon, no filled pill behind the active tab.
1. **Home** (house icon)
2. **Timeline** (stacked cards icon; old version: a checked card)
3. **Community** (two/three people icon)
4. **Therapist** (speech bubble; called "Chat" in the old version). Red dot badge top right for unread.
Active tab = dark-green filled icon and darker label; inactive = same green in outline (new) or grey (old).
- Home and Timeline content NOT SEEN. GUESS: Home = this week and today's practices; Timeline = the
  chronological list of lessons and practices, done ones checked.
- Community NOT SEEN. Site text: anonymous peer group of participants, access stays after the programme.

## Home / today screen
NOT SEEN anywhere public. The site says: about four short lessons a week, 15 minutes or less each.
GUESS for our order: week N of 12 and theme name, today's practice card (duration chip, type), rest of this
week's list with checkmarks, a line from the therapist with unread dot, next video call.

## Practice / lesson
Seen (full-screen flow, no tab bar):
- Top row: back chevron left (new), thin progress bar in the middle (grey track, blue fill, about 4 px,
  rounded), X close on the right.
- Title centred under it, bold, dark: "Improving Your Practice", "Practice Summary".
- **Intro card** ("Worry Maze"): cream/greige screen, a hand-drawn line illustration on top (person juggling
  pan, book, laptop, clock, jacket; black outline with ochre/brown fills), a small pill chip "3min", big
  title "Worry Maze", 2 lines of grey body "The worry maze will help differentiate between types of worries."
  (partly hidden), full-width dark-green pill button "Continue" at the bottom.
- **Video step**: a square (about 1:1) video of a real clinician talking to camera, edge to edge, small Meru
  logo top left of the video, nothing else on the screen. Bottom: back chevron left, round green button with
  a white arrow right (about 56 px, soft shadow). Audio-only practices: NOT SEEN.
- **HRV biofeedback breathing**: white screen. Top: speaker icon left, countdown "7:22" centre (bold), X right.
  Centre: three concentric circles in blue (core #8eb5ff, mid #c5d8ff, outer #e8efff), the word "Exhale"
  (or Inhale, GUESS) in white bold in the core; the rings grow and shrink as the pacer (GUESS, static image).
  Below: one grey line of live feedback, "Good resonance. Breathe gently with the pacer." No numbers, no
  heart rate, no chart during the practice.
- **Practice Summary** (after breathing): white rounded cards on cream. Card 1: big "5.8" in dark green,
  label "Avg resonance score", small pale-blue (i) icon top right. Card 2: "Resonance over time", subtitle
  "87% of your training was in resonance", a smooth line chart that goes from grey (low) to strong blue
  (#1668ff, high), dashed guide lines labelled High and Low, x axis 0:00 / 2:30 / 5:00, then a legend with
  durations: "High Resonance 5 min 57 s", "Medium Resonance 2 min 48 s", "Low Resonance 1 min 15 s".
  Round dark-green arrow button bottom right.
- Device: ear-clip or finger pulse sensor on a Bluetooth box; connects in the app when a practice starts.

## Therapist chat and follow-ups
Seen (new version):
- Header band in dark green (#0d5436): round therapist photo, first name "Erin", chevron (opens profile,
  GUESS), white pill button "Book Call" on the right. Old version: plain white header "Erin / Your therapist".
- Therapist messages left, warm beige bubble (GUESS #f0ede6), dark text, label above the bubble
  "Erin | Therapist". User messages right, pale blue bubble (GUESS #d6e4fb), dark text. Radius about 16 px,
  the corner next to the sender squared off. "Seen" under the user's last message (old: with an eye icon).
- Centred grey date "Jan 10, 2021". A thin red line with "NEW" at the right marks unread messages. Input: one white rounded field with a border, placeholder "New message?". No visible send or attach icon.
- Video call: therapist full screen, own picture top left, round buttons below (red hang-up, mute, camera, more).
- PHQ-9 / GAD-7 check-ins, weekly summaries: NOT SEEN in any public image or page I read. The site only says
  "Take a health assessment" before the intake call and "Your therapist is always there to guide you and help
  you get the most from your HRV data". Design ours freely.

## Visual language
- Backgrounds: cream/off-white app screens (#fcfbf8 sampled), white cards; lesson intro on greige
  (GUESS #e9e6df). Marketing frame colour: pale sage #d8ead4.
- Brand green: deep forest #0d5436 (header, buttons, titles, numbers, tab icons). Old lighter green #6db76a.
  Marketing headline green is brighter (GUESS #0fbf68). Body text dark green-grey (GUESS #2f3b36), secondary grey.
- Second colour: blue only for breathing and data (#8eb5ff, #c5d8ff, #e8efff, chart #1668ff, progress bar
  #4ba0e0). Red only for "NEW" and hang-up. Ochre/brown only inside illustrations.
- Cards: white, radius about 12 to 16 px, very faint shadow, no border, generous padding (about 20 px).
- Buttons: full-width dark-green pill with white label, or a 56 px round green arrow button.
- Type: sans only, no serif. Humanist/geometric sans (looks like IBM Plex Sans in the old app, a rounder
  grotesk in the new one; GUESS). Titles bold 22 to 24 px, body 16 to 17 px regular, labels 12 to 13 px.
- No gradients in the app, except the line chart's grey-to-blue stroke. Flat colour everywhere.
- Icons: thin outline, about 1.5 px stroke, rounded joins. Illustration: loose hand-drawn ink line, limited fills (forest green, ochre, brown), slightly humorous
  (juggling person, puzzle light bulb, calendar). Real photos for people: therapists and lesson presenters.
- Spacing: a lot of empty space; one thing per screen; the breathing screen is two thirds blank.
- Copy seen (verbatim; therapist tone is warm, practical, with exclamation marks):
  1-2. "Good resonance. Breathe gently with the pacer." · "Exhale"
  3-5. "Practice Summary" · "Avg resonance score" · "Resonance over time" · "87% of your training was in
      resonance" · "High Resonance 5 min 57 s"
  6-7. "Improving Your Practice" · "Worry Maze" · "3min" · "Continue"
  8-10. "New message?" · "Book Call" · "Erin | Therapist" · "Seen" · "NEW"
  11. "Hello! I am Erin, your Therapist. I look forward to our consultation call. Please let me know if I
      can answer any questions or help you in the mean time."
  12. "Sure! The daily time spent can be adjusted to your schedule! In the first week, we start with 5
      minutes & help you prepare for longer practices. We will discuss this further on our call tomorrow."

## The 12 weeks (meruhealth.com/how-it-works, verbatim)
1 Mindfulness and how to stay present · 2 Breaking the cycle of negative thinking ·
3 Heart rate variability and stress resilience · 4 Boosting mood and motivation ·
5 Sleeping smarter for better health · 6 How to reduce worry (and when to accept it) ·
7 Learning to appreciate all your emotions · 8 The whys and hows of self-kindness ·
9 How to feel better by eating better · 10 Using your values to create meaning ·
11 Setting boundaries for self, relationships, and work · 12 Creating a life-long plan for emotional resilience
Frame: up to 4 therapist video sessions plus unlimited chat, about 4 lessons a week of 15 minutes or less.

## 10 "do it like Meru" rules
1. Four bottom tabs, outline icons with labels: Home, Timeline, Community, Therapist. Red dot for unread.
2. Cream background (#fcfbf8), white cards, one deep forest green (#0d5436) for everything that acts or leads.
3. Blue is reserved for breathing and data. Never use it for buttons.
4. Therapist screen: green header with photo, first name and a white "Book Call" pill; beige bubbles for the
   therapist, pale blue for the user, a red "NEW" line for unread.
5. A lesson is a full-screen stepper: thin progress bar, X to leave, one thing per step, round green arrow
   to go on. No tab bar inside.
6. Every practice opens with an intro card: line illustration, duration chip ("3min"), title, two lines,
   green "Continue" pill.
7. Breathing: three concentric blue circles, one word in the middle, a countdown on top, one line of feedback
   under it. No numbers while breathing.
8. Numbers come after: a summary with one big score card and one chart card with a plain-language sentence
   ("87% of your training was in resonance").
9. Sans type only, bold short titles, sentence-length body. Flat colour, no gradients, faint shadows.
10. Copy is short, warm and concrete, speaks as a person ("Sure! ... we start with 5 minutes"), names the
    time it takes, and never uses clinical jargon on the surface.
