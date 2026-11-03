# Writing a good graphic brief

Whether you are Claude designing a storyboard, a user briefing Claude, or the `--engine claude`
prompt inside the tool, a graphic brief follows the same shape. The structure comes from studying
creator-shared Opus prompts in the community collection
[awesome-opus-5-5-video-prompts](https://github.com/LeaddeOpenLab/awesome-opus-5-5-video-prompts) by Leadde Open Lab.
Those prompts remain their authors' property and are not copied here; only the general craft lessons
are used, expressed in original wording.

## What separates strong briefs from weak ones

Weak: "make it dynamic, go all out" (no length, format, content or constraints).
Strong briefs state, in sections:

1. **Inputs**: what material exists (transcript, footage, brand colours, fonts) and what is missing.
2. **Direction**: palette, typography, motion language (springs, tiny overshoot at most), what is banned.
3. **Structure**: a beat-by-beat plan against a clock; here the clock is the speech, so every change is
   tied to a spoken word, one change per beat (about 0.4-1.2 s apart).
4. **Build rules**: deterministic frames (a pure function of time), the allowed templates and prop
   limits, no external assets.
5. **Gotchas**: known failure modes (clipped glyphs, overlapping enter/exit, unreadable small text).
6. **Start**: show the plan (table) and wait for approval before building; render stills of the key
   moments before the full render.

Also set the duration budget up front and allocate shots to fit it; give aspect ratio and delivery
format; when narration and animation come from different tools, check that their durations align.

## Brief template for one graphic

```
Teaching beat: <the idea, in one sentence, from the transcript>
Covers: <start>-<end> s, the line "<verbatim words>"
Template: <name>   Mode: cutaway | panel | overlay   Why this template: <one phrase>
Content: <labels, numbers, items; every one traceable to the transcript>
Stress: <the 1-2 words to wrap in *asterisks*>
Cues: <the spoken word each item appears on, in order>
Check: still PNG at settled state; readable in 9:16; nothing invented; face time kept
```

## Common failure fixes

| Symptom | Fix |
|---|---|
| Wall of text | split into two graphics, or switch to `bullets` with cues |
| Decorative, teaches nothing | drop it, or choose `flow` / `steps` / `comparison` for the structure |
| Appears before the words | set cues to the spoken word, not the sentence start |
| Hides the slide for too long | use `panel` (right half) or shorten; keep cutaways under 8 s |
| Numbers look made up | remove them; show relative bars or labels only |
| Caption clash | boxed placements end above the caption zone; keep strips at the top |

## Several designs for one moment

A first design is not always the best one. For the key explanatory moments (not chapter cards or titles) ask for alternatives from different directions, using the same brief for each:

| Direction | Templates | Use when |
|---|---|---|
| structure | flow, steps, comparison, table | the line is about how parts connect, a sequence or a contrast |
| typographic | term, kinetic-text, quote, stat | one strong idea, a definition or a single number the speaker states |
| points | bullets, bar-chart, donut, line-chart, code | two to four parallel items, or relative sizes the speaker gives |

`video-monk storyboard --engine claude --allow-llm --variants 3` (or `auto --variants 3`) drafts the alternatives (one request per key moment, up to six moments), renders each as a still, rejects any with text off the frame or clipped and any with content the speaker did not say, and applies the best. The original design always stays as alternative 0 and wins a tie. Compare them in `<name>.variants/VARIANTS.md` and the `gNN-compare.png` images; to use another, set `"chosen"` on the item in `<name>.storyboard.json` and re-apply with `--from-storyboard`.
Cost: about one Claude request per key moment; the cost is reported. The automatic choice is a gate and a tiebreak, not taste: look at the comparison images.
