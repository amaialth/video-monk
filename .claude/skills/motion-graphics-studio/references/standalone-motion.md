# Standalone motion pieces

A piece where graphics are the whole video: no recording underneath. In this toolkit it is a version-2 manifest of **graphic scenes** (`kind: "graphic"`, a built-in template or `html`), with music and sound effects, built with `production-build` like any other video.
The formats below follow the pack's launch, explainer, chart, milestone, opener, promo, loop and reel skills, rewritten for the toolkit.

Always first: `MOTION.md` ([brand](./brand-motion.md)), the real content, and for anything that states a fact, **the fact list with sources, approved by the user, and `video-monk facts-check` clean before building.**

| Piece | Length | Shape |
|---|---|---|
| Launch film | 30-45 s | one sentence split across 3-5 beats; proof; the product working; a quality beat; how it works; the number that matters (with its source); name, call to action and requirement, held at least 3 s |
| Documentary explainer | 30-60 s | one "why" question; 8-14 shots, each answering the line before; the last shot is the takeaway in five words or fewer |
| Animated chart | 8 s loop | four states: start, change (one thing moves), hold with the headline value labelled, return to the start. Title, labels and axis never move; values exactly as given, "illustrative data" on sample data |
| Milestone reveal | 12 s | points drift, pull into the real number, a line draws, the label settles, hold, return; the number is exactly as sourced, never rounded up or given a "+" |
| 3D / cinematic opener | 8-15 s | one world, one slow camera move, the title landing in the last third; readable at phone size |
| Newsletter or episode promo | 12-20 s | one promise, one proof, one ask that sends people to the edition |
| Loop cover | 9 s loop | only the one named element moves; the loop is rotated so frame 1 is the finished picture; measure the seam |
| Reel or TikTok | any | see below |

## Build it here

1. Write the **beat sheet** (a table of time, beat, what is on screen, the source of every number) and get a yes. Build the first 10 seconds in two or three looks and let the user pick before building the rest.
2. Each beat is a graphic scene: choose a built-in template from the idea (`video-monk templates`), or a custom `html` for an [effect](./effects.md). Vary layouts: no two beats alike.
3. Sound: a music bed (`audio.music`, licensed) ducked under any voice, a quiet hit on each new beat (`audio.sfx` or `--sfx`), a lift on the last line. A silent piece feels unfinished.
4. `facts-check`, then `production-review`, `production-build --quality draft`, read the contact sheet and `graphicAudit`, fix, final build.
5. Check it like the viewer: would a stranger know what it is by second 4? Is every number traceable? Does the call to action hold for 3 s? Is it readable on a phone with the sound off?

Never invent a price, a date, a "spots left" count, a testimonial or a result. A proof beat uses real screenshots, real results with their source, or real posts: attached files only.

## Vertical reels

- **Safe zone for 1080x1920:** keep every word and logo between y 360 and y 1420 and out of the right 120 px; the app draws its own buttons, caption and profile over the rest. Built-in vertical captions and lower thirds already sit above the bottom ~26%.
- Put the headline (two short lines, word for word) at the top of the safe zone, the video under it. A 16:9 video scaled to 1080 wide is 608 px tall and sits well at y 660.
- Re-encode every time: H.264, yuv420p, limited range, BT.709, `+faststart`, an audio track (silent if there is none). The toolkit's delivery encoder does this; `production-verify` checks it. Do not upload a phone recording as is (HEVC full range can come out washed out).
- A logo over footage vanishes on light frames: give it its own dark rounded tile.
- `video-monk cutdown --manifest M --output M.reel.json --aspect 9:16 --fit blur` makes the vertical version of any manifest.

## Loop covers and GIFs

The toolkit renders video, not GIFs. For a looping cover, render the piece (`graphic ... --output cover.mp4`), then:

```
ffmpeg -y -i cover.mp4 -filter_complex "fps=20,scale=896:-2:flags=lanczos,split[x][y];[x]palettegen=max_colors=128:stats_mode=full[p];[y][p]paletteuse=dither=none" -loop 0 cover.gif
```

No dithering (it adds flicker to flat images). Rotate the loop so frame 1 shows the finished picture (inboxes show frame 1 as a still). Measure the seam: the difference between the last and first frame should be near zero, and the largest difference from frame 0 should be clearly above zero (never measure at the halfway frame: a sine is back at zero there). Shrink to 240 px wide and look again: if the moving element disappears it is too small. Upload the GIF itself; some tools convert it to a still.
