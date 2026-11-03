# House rules for motion graphics

These came out of drafts that were rejected. Each rule says what to do and how the toolkit helps.

1. **Facts first.** Every name, date and number on screen comes from a list the user approved, each with a source. Nothing invented. Say "looks like", not "is", when the research shows only a similarity.
   On a recording the transcript is the source (the reviewer checks it). For graphics with no transcript, keep `facts.json` and run `video-monk facts-check`.
2. **The brand, not the average.** Colours, fonts and logos come from `MOTION.md` / `brand.json` or from the user. With nothing given, ask. Typed hex codes beat colours sampled from an image.
3. **Banned defaults:** typewriter text on headlines (typing belongs only inside a product's own input box), glow, bounce and overshoot (`theme.calm` removes it), gradients on text, purple-to-blue backgrounds, stock icons, emoji, clip art, grey placeholder bars.
4. **Hand-made feel means motion on twos:** hold each pose for 2 frames (`theme.onTwos`), never smooth corporate easing, for torn-paper and documentary looks.
5. **The first three seconds carry the hook.** If the first frame is empty or the opening would not stop your own thumb, rebuild it before building the rest. The opening line must promise what is coming; show the first surprise within five seconds.
6. **Check before export.** Look at a frame from the middle of every beat: cut-off text, overlaps, unreadable at phone size, a wrong or unlisted fact. Fix what is real, keep the earlier version, and report only problems you observed. If you find none, say so; do not invent a revision.
7. **Real assets only.** Logos and screenshots come from the user's files and fill their card. Never redraw a logo or a product's UI from memory. A third-party component is a structural donor: keep its engineering, replace its copy and translate every colour, border, shadow, font and timing to `MOTION.md`.

## Craft rules from rejected rounds

- **Sound is not optional** for a standalone piece: a low bed, a hit on each new beat, a lift on the last line (`--sfx subtle`, `audio.sfx`, `audio.music`). The voice sits on top: if you cannot hear it over the effects, lower the score.
- **Cards and objects, not lines.** One bar or line sliding across the screen reads as static. Use cards, real images or objects that move in depth.
- **Keep grids symmetrical:** equal card sizes, equal gaps. A lopsided layout reads as a mistake.
- **No two beats share a layout.** Vary templates and placements (the planner's repeat penalty does this for graphics on a recording).
- **Frame 0 must use the right font.** An embedded font does not load until something uses it. Load fonts before the first seek (the toolkit's built-in templates already do).
- **Seed everything.** No `Math.random()` at render time; a random pattern must come from a fixed seed so every render and every seek draws the same pixels. Canvas that reads pixels repeatedly needs `willReadFrequently: true`.
- **One unit of time.** Seconds everywhere. The page and the renderer must agree.
- **Scale the drawing, do not redraw it.** A piece with fixed coordinates ends in one corner when the canvas size changes; scale the whole drawing to fill the frame.
- **Label made-up numbers on every frame** ("illustrative", "example") until real ones go in.
- **Name what must never happen** in `MOTION.md` (five things) and check the frames against it.

## The check, with the toolkit

| Question | How |
|---|---|
| Does the fact list cover every number? | `video-monk facts-check --manifest M --facts facts.json` |
| Do the frames read at phone size? | build a draft, read `contact-sheet.png`; `report.graphicAudit` flags text off the frame, clipped, under 2.2% of the short side, or low contrast |
| Is the opening strong? | `video-monk graphic ... --output opening.png` for the first beat; judge it alone |
| Does a loop close? | compare the first and last frame: identical for a loop; a film may differ |
| Is the file deliverable? | `production-verify` (colour tags, bitrate, loudness) |
