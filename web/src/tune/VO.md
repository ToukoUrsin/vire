# Tune voice lines

One short sentence each: the flow waits for the face, not for the audio, so a line must be over within about two seconds.
Files go in `web/public/audio/`. TuneFlow plays each when its step starts and stays silent when a file is missing.

| file | sentence |
|---|---|
| `vo-tune-intro.mp3` | Let's teach Vire your face. Two faces, about fifteen seconds. |
| `vo-tune-rest.mp3` | First, rest your face. |
| `vo-tune-smile.mp3` | Now your biggest smile. |
| `vo-tune-sad.mp3` | Pull the corners of your mouth down. |
| `vo-tune-angry.mp3` | Lower your brows and bring them together. |
| `vo-tune-surprised.mp3` | Raise your brows high. |
| `vo-tune-done.mp3` | That's it. Vire knows your face. |

Each face is asked for twice ("and relax", "once more" are on screen only, no audio), the smile three times.
`vo-tune-intro` plays on the first screen after the person taps "Start"; `vo-tune-done` plays with the result.
