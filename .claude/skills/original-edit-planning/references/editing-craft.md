# Editing craft for talking-head and screen-recording explainers

Notes distilled from the community list [awesome-claude-video-skills](https://github.com/zhuyansen/awesome-claude-video-skills)
(the list itself is CC0) and the MIT-licensed skills it points to. Ideas only, restated in our own words; no code or text is copied.

## Work in gated stages with an approval artifact each
Preprocess and inspect → transcript (confirm it) → content structure (review it) → storyboard (approve it) → design → render → review.
Never jump from raw footage to a finished edit. (jtxvideo-skill)  → our stages, ledger and `review` command.

## Know the footage before cutting, and look at your own cut
Probe every file (duration, orientation, fps, audio), sample frames, and drop unusable stretches before deciding order and rhythm. After
rendering, look at frames of the result the way a viewer would, and fix what you see. (smart-video-editor, SeeCut idea) → contact
sheet, sampled frames and the render reviewer.

## Cut by evidence, with a tone
- Silence, fillers, hedges, false starts and repetitions are what tightening removes; laughs and comedic or emotional pauses are what it
  keeps. Pick a tone first: `natural` (documentary/relaxed), `tight` (default for explainers), `extra` (aggressive shorts). (cut-video)
- Word timestamps from speech recognition drift by 100-300 ms and smear pauses into words. Decide cuts from the audio (levels,
  measured noise floor), verify that voiced audio survives, and treat ASR times as a draft. → `--pace`, `cut` reviewer.
- Retakes: recognizers may collapse repeated takes into one line, so listen for repeats before trusting the transcript.
- Heavy sources (HEVC, 4K): work from a lighter proxy, deliver from the original.

## Rhythm
Pace by idea, not by a formula: short beats for punchy lists, longer holds for a mechanism being built. Change the picture when the idea
changes. Vary layouts so identical cards do not repeat back to back; restate nothing the caption already says.

## Keep the toolchain small
A simple promo does not need a heavy skill; a skill earns its place by providing a look, a workflow or footage handling. Our look is the
house style, the workflow is the staged loop, and the footage handling is the pace engine.

## Review as a conversation
User notes ("the intro drags", "too many boxes at 3:10") are findings: give each an owner and a target, revise only that part, and
re-review. → the review-loop reference in the non-Resolve production skill.
