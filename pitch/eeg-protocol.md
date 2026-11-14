# Aalto booth EEG and Vire AirPods check

**Run time: two minutes.** The person wears their EEG headset and AirPods Pro 3 together. Open `/#/eeg` on the iPhone shell, keep the screen awake, and press **Start the two minutes**. Vire records numbers only: AirPods motion, AirPods heart-rate samples when available, protocol times, and clock checks. It records no sound or picture.

1. **Sync mark, first.** The page flashes and beeps three times. The EEG operator presses the marker key on the first beep. The person makes one firm nod on each beep. Vire writes all three beep times in epoch milliseconds.
2. **Eyes open, 20 seconds.** The person looks softly at the page and rests.
3. **Eyes closed, 20 seconds.** The person closes their eyes and rests. A beep marks the end.
4. **Slow breathing, 60 seconds.** Follow the circle: breathe in for 4 seconds and out for 6 seconds. Keep the head easy.
5. **Smiles.** Four asked smiles, 2.5 seconds each, with 2.5 seconds of rest between them.
6. **Sync mark, last.** Three more firm nods on the three flashes and beeps. The operator presses the marker key on the first beep again.

If the page is hidden, it stops and says so. Start again with the screen awake. At the end, write the four-letter EEG code shown by Vire into the EEG file name, and use the **Download the log** link to save the Vire JSON.

## Export from the EEG system

Please export the raw or minimally processed recording and a small text file with the sampling rate, channel names, and marker times in the EEG system's own time base. Include the marker times for the first and last sync marks. The Vire log has epoch milliseconds for every motion row and heart sample, plus the six sync beep times and the start and end clock checks. Keep the two original files together.

## Line up and compare

Use the first sync nods to align the two clocks, then check the last sync nods for drift. The eyes-closed and eyes-open blocks are the sanity check for the EEG: we expect the usual eyes-closed alpha change to be visible in the EEG export. During slow breathing, compare head stillness, the pace of the circle, and AirPods heart rate with the EEG measures over time. Treat the four smiles as event windows and compare their EEG around those events. This is a timing and sensor check, not a claim about depression or a diagnosis.
