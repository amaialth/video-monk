# Sound effects

The toolkit synthesises its own sound effects with FFmpeg: original sounds, no samples, no downloads, no API key, nothing to attribute. They are
generated once, indexed in the asset library as `sfx-<kind>-v1` and reused.

| Kind | Length | Used for |
|---|---|---|
| whoosh | 0.9 s | a full-frame cutaway appearing |
| swipe | 0.4 s | a side panel appearing, or a cutaway leaving (full mode) |
| pop | 0.25 s | a stat, term or callout reveal |
| chime | 1.6 s | chapter and title cards |
| ding, click, tick, impact, riser | 0.08-2 s | available for hand placement (`video-monk sfx --kind <name> --output x.wav`) |

## Use

- `video-monk auto ... --sfx subtle` (or `full`) accents every planned graphic. `subtle` is one quiet accent per graphic (-15 to -18 dB), at least 2 s
  apart, at most 5 a minute; `full` adds pops and exit swipes, 1 s apart, at most 10 a minute. Default is off for `auto`; the brief suggests `subtle` for explainers and screen tutorials.
- On an existing manifest: `video-monk sfx --manifest production.json --output production.sfx.json --mode subtle` (`--plan` prints the cues without writing).
- Cues are ordinary `audio.sfx` entries (`asset`, `at`, `gainDb`); edit them like any other. Music ducks under speech; SFX sit under the voice at their low gain.

## Taste rules

- Sound effects accent, they do not decorate. If you notice one while listening, it is too loud or too frequent: lower `gainDb` or use `subtle`.
- Never on top of a key word in the voice: move the cue 0.3 s earlier or drop it.
- No effect on interviews, quiet or serious pieces.
- The synthesised sounds are checked for level and length, but not auditioned: **listen to the result and adjust**.

## Other sources

AI sound-effect generators (for example ElevenLabs sound effects, Meta AudioCraft) can produce more varied sounds, but they send your prompt to a
service or need a local model, and their terms apply. The toolkit does not call them. If you use one, get the user's approval, save the file,
record the licence and account terms (`video-monk assets --add ... --kind audio --rights ... --approved`), and add it as an `audio` asset with an `audio.sfx` cue.
