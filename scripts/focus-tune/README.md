# Tuning `focus --detect` on a real screen recording

`video-monk focus --detect` proposes zoom moments from screen activity. It was built and tuned on a scripted, simulated recording; this folder lets you tune it on a **real OBS recording** without anyone needing to label events by hand.

## Make the recording (about a minute)
1. `node scripts/focus-tune/serve.mjs` and open the printed address (`http://127.0.0.1:4390/?live`) in a browser. The page is served only on this computer and loads nothing from the network.
2. Make the browser **full screen**, and set OBS to capture that display (or that window).
3. Start the OBS recording, then press **Start** on the page. It flashes magenta once (that lines the recording up with the script), then plays a 24 second session: a dialog opens over a dimmed screen, text is typed, a toast appears, a number changes, a row highlights, the list scrolls.
4. Move your mouse around the page naturally, as you would while presenting. Do not click or type in it. When it says **Done**, stop the recording and press Ctrl+C in the terminal.

Only the page is on screen, so nothing else on your desktop is recorded.

## Score it
```
node scripts/focus-tune/run.mjs /path/to/your-recording.mkv --align
```
It prints, for a sweep of sensitivities, how many of the 5 scripted events were found and how many false alarms there were. `node scripts/focus-tune/run.mjs` on its own scores the built-in simulation at three compression levels.

Neutral events (the dialog closing, the scroll, the toast hiding) are neither hits nor false alarms. Position counts as a hit within 0.3 of the frame width/height (a letterboxed display shifts positions a little).
