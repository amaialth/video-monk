# Premium effects: sixteen, and how to build each here

Each effect is one thing turning into another. **That is what "premium" means:** a button becomes a player, bars become a line, a card becomes a window. A fade from one picture to another looks cheap every time.
The list and its grouping follow the motion-effects skill of the MIT [motion-graphics-skills](https://github.com/charlie947/motion-graphics-skills) pack; the descriptions and toolkit mapping below are original.

**Before building:** read `MOTION.md`; ask for the effect, the real words and numbers, the size (1080x1080, 1080x1350, 1080x1920, 1920x1080) and *loop or hold* (a loop repeats for a post or GIF; hold plays once and stays on the finished frame, for use under narration).

| # | Effect | Use it to | Build with |
|---|---|---|---|
| 01 | Button to player | add a "watch the demo" moment | custom HTML |
| 02 | Search to results | show what people find in a help centre or library | custom HTML |
| 03 | Card to workspace | announce a feature: a small card becomes the editor | custom HTML |
| 04 | Tabs to panels | compare plans or channels without a wall of text | `comparison`, or custom HTML for real tabs |
| 05 | Chart morph | land a weekly result: bars turn into a line | `bar-chart` then `line-chart` with the same data, or custom HTML for the morph itself |
| 06 | Dashboard zoom | pull the one KPI that matters out of a dashboard | custom HTML (the donor screenshot is the user's own) or `stat` |
| 07 | Spring stack | show three offers or testimonials in turn | `bullets` with cues, or custom HTML |
| 08 | Magnetic dock | show the tools or integrations used | custom HTML |
| 09 | Masked type | reveal a campaign name or headline | `kinetic-text` with `reveal: "mask"` |
| 10 | Elastic type | open an event with a title card | `kinetic-text` (`reveal: "pop"`), `title`; `theme.calm` turns the overshoot off |
| 11 | Text to layout | turn a headline into a carousel cover | `title`, or custom HTML |
| 12 | Image reveal | tease a drop, then swap in the real photo | custom HTML with the user's image inlined |
| 13 | Perspective shift | explain the layers of a stack | `steps` or `flow`, or custom HTML for real depth |
| 14 | Glass focus | make one line of a report the only readable thing | `callout`, `quote` |
| 15 | Flowing paths | show one source feeding several channels | `flow` (packets on edges) |
| 16 | Particle logo | close on the mark | custom HTML with a seeded particle field and the user's logo file |

Where a built-in template covers the idea, use it: it is deterministic, themed, grounded and cached. Build custom HTML only for what no template does.

## The custom HTML contract (this toolkit)

One self-contained file, no network, fonts and images inlined. It defines `window.__seek(t)` (seconds, any order, any number of times) that draws exactly that moment, and sets `window.__vmReady = true`.
Use it as a graphic scene or overlay: `{ "html": "effect.html" }` in a version-2 manifest, or `video-monk graphic --html effect.html --output x.png`.

1. **One clock.** Every frame follows from `t` alone: no `setTimeout`, no free-running CSS animation, no unseeded randomness.
2. **One loop of 8 seconds** (for loop mode): the move from 0.0 to 2.2 s, hold to 6.6 s, return by 8.0 s; `seek(0)` and `seek(8)` draw the same frame. In hold mode, play the move once and stay on the finished frame from 6.6 s.
3. **Back to the start.** The return eases every element to exactly where it began; nothing snaps home.
4. **Real content.** The user's words and numbers. Sample numbers carry an "illustrative" label on every frame.
5. **Scale up.** The effect fills the frame with the margins from `MOTION.md`; it is not a small tile in an empty canvas.
6. **A reel cut is shorter.** Eight seconds is slow for a reel: cut the active move (about 1.4 s of it) and use hold mode under narration.

## What makes them feel premium

- **The hold is where people look.** About 4 of the 8 seconds are the hold. Keep something small alive there (a progress bar, a cursor, a second wave of light) or the loop feels dead.
- **A ghost of the start state sells the change.** A faint outline where the button or card began lets the eye follow the move.
- **Stagger by a beat, not all at once.** Rows, letters and dots each start a fraction after the last. Everything moving together reads as a slide transition.
- **Scale the drawing, do not redraw it** when the canvas size changes.
- **Declare each name once** when you copy helpers between files; a duplicated constant stops the whole script and leaves a blank page.

## Check before you show it

Capture frames at 0, 1, 2.2, 4.4, 6.6, 7.9 and 8 s and look at every one. The loop: frames 0 and 8 identical. The move: frames 0, 1 and 2.2 all differ (if two match, part of it is not running). The fit: nothing cut off at any of the seven moments. The still: pause on 4.4; the point reads from that single frame. The brand: every colour and font on screen is in `MOTION.md`.
Then show the user the 2.2 s and 4.4 s frames with the file path.
