# Scene seams: making beats feel like one move

A standalone video built from separate beats can feel like a stack of slides: each beat animates well on its own, but the eye's momentum dies at every cut. This reference is about the seams between beats.
The ideas (one direction of travel, matching exit and entry, carriers, cause before effect, stillness before the peak) follow the motion doctrine in the Apache-2.0 [HyperFrames](https://github.com/heygen-com/hyperframes) project by HeyGen; the wording and the mapping to this toolkit are our own. See THIRD_PARTY_NOTICES.md.

## The rules

1. **One direction of travel (the current).** Pick one direction for the whole piece. Every ordinary seam moves that way. `motion-video` does this for you: all seams slide the same way, `left` by default; set `"current": "right" | "up" | "down"` in the brief to change it.
2. **Reserve other directions.** A different direction means something: up for a conclusion that rises above what came before, a push in for going deeper into the same thought, a pull back for an arrival. Spend one on purpose (set that beat's `"transition"`), and give it a cause or a chapter change.
3. **Never ping-pong.** Alternating left, then right, then left reads as a mistake. The brief check warns when two neighbouring beats end in opposite directions.
4. **Exit and entry match.** How a beat leaves decides how the next one arrives: same axis, same direction, similar speed. A beat that exits to the left and is answered by one growing from the middle breaks the line. Cut while both sides are still moving; settling to rest before the cut, or starting from rest after it, is a dead beat.
5. **Hand something across.** The eye follows objects. The strongest seams carry a concrete thing over the cut at the same place and speed: a card that shrinks into the next layout, a mark that flies to its slot, a cursor in mid-path. A plain crossfade carries nothing, so it is the weakest seam; the built-in `fade` is for a calm landing, not the default.
6. **Cause before effect.** Chain moves so each one is visibly launched by the last (press, squash, release, flight, impact, settle). An effect starts on the frame of its cause, not "shortly after". Heavier things rebound slower.
7. **No idle wobble.** After a beat has arrived it should hold, not drift or pulse for the sake of it. A small, purposeful motion (a progress bar, a cursor) is fine; a looping bob on a static logo is not.
8. **Stillness before the peak.** Hold still for a beat before the biggest moment so it lands. A piece that moves constantly has no climax.

## In this toolkit

- Seams are the `transition` on each graphic scene (`slideleft`, `wipeup`, `zoomin`, `fade`, ...); the list is in the [timeline reference](../../non-resolve-production/references/timeline-v2.md). Set the piece's direction once with `current`; override a single seam with the beat's `transition`.
- A beat's own entrance and exit are inside its template (`ctx.exit`). When you build a custom page, make its entrance start moving along the same axis the previous beat left on.
- Check seams by looking: render the contact sheet after a draft build and read each cut. If two neighbouring beats look unrelated, change the transition, not the easing.
- Keep the first version when you change a seam; compare the two.

## HyperFrames' own agent skills

HyperFrames publishes agent skills of its own (`npx skills add heygen-com/hyperframes`), built for its own project layout (an `index.html` composition per video) and its own CLI. Video Monk does not install them: they send agents to the network (`npx hyperframes ...`, optional HeyGen sign-in and paid generation, cloud rendering) and describe a second, different workflow, which would compete with the approvals and offline rules here. If you want that route, it is optional and yours to set up: see `non-resolve-production/references/tool-setup.md`.
