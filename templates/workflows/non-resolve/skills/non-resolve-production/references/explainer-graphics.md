# Explainer graphics: planning motion graphics from the transcript

Goal: wherever a spoken idea can be shown, show it. The `storyboard` command reads the
timeline-relative words (`captions.words`) and writes a manifest with graphics placed as
`globalOverlays`, plus `<name>.storyboard.json` (editable) and `<name>.STORYBOARD.md` (table).
Method adapted from the motion-graphics skill by Barty-Bart (MIT); see
THIRD_PARTY_NOTICES.md in the video-monk package.

```
video-monk storyboard --manifest edit/production.json --output edit/production.graphics.json \
  --density medium --engine rules                     # offline, deterministic
video-monk storyboard ... --engine claude --allow-llm  # Claude designs the diagrams (transcript is sent to Anthropic)
```

`auto` runs this step by default (`--graphics off|light|medium|heavy`).

## Engines

| Engine | What it does | Good at | Weak at |
|---|---|---|---|
| `rules` (default) | Pattern rules on the transcript: opening title, topic changes, definitions ("X is a..."), ordinal sequences, agenda/example lists, flows between named systems, stated numbers, "A vs B", questions, key phrases | Fast, free, private, reproducible | Conversational speech: mostly yields pull-text, cannot understand a concept well enough to draw it |
| `claude` | Sends the timed transcript to `claude -p` (your Claude Code login). Claude returns graphic definitions; the tool validates every prop, aligns cue words to real word times, then adds rule-based pull-text in the gaps | Diagrams, agendas, definitions, comparisons, recaps | Costs a few cents; needs `--allow-llm`; always review |
| manual | Claude Code (this conversation) reads the transcript and edits `storyboard.json` directly | Highest control | Slower |

Re-apply an edited table with `--from-storyboard <storyboard.json>` (new output file).

## Planning rules (both engines)

- **Density:** light 3/min, medium 6/min (default), heavy 10/min. The best items by score win.
- **Cutaway, panel or nothing.** Per idea: a full-frame **cutaway** for a diagram or card that
  deserves 3-8 s; a **panel** (right half, ends above the captions) for ideas that run long
  (up to 26 s) so the speaker or slide stays visible; **overlay** strips for short pull-text;
  nothing when the line is personal, emotional or a greeting.
- **Split layout:** a side panel does not cover the picture. The video eases down to about 47% width beside it and back (manifest
  `layout: "split"`, left or right only). No camera zoom runs under any graphic. For slides in vertical videos use `autocut --fit contain`.
- **Face time:** at least 2 s (medium) between cutaways; nothing overlaps; none in the first second
  (except the title card).
- **One idea per graphic**, short labels (1-4 words), pacing about one change per spoken beat.
- **Grounding:** every label, number and phrase must come from the transcript. Never invent
  figures, names, quotes or results; use relative bars or labels instead of made-up data.
- **Cues:** bullets, steps, flow nodes, bars and pull-text words appear on the word that names
  them (`cues`, `at`). The change lands on the spoken word, not before it.
- Chapter cards double as YouTube chapter labels (scene `chapter`).

## Idea -> template

| The speaker says | Use |
|---|---|
| "X is a ..." / "X means ..." | `term` (definition card) |
| "A sends data to B", "between A and B", a pipeline | `flow` (nodes with icons, moving packets) |
| "first ... then ... finally", numbered steps | `steps` |
| "we will cover A, B and C", examples, a recap | `bullets` (marker check/dot/number/x) |
| "A versus B", before/after, pros/cons | `comparison` (columns) or `kinetic-text` with *vs* |
| a stated number or percentage | `stat` (count-up); several values: `bar-chart`, `donut`, `line-chart` |
| "let's move on to ..." | `chapter` |
| "welcome to ..." | `title` |
| a question to the viewer, a key claim | `kinetic-text` |
| a snippet of code or a command | `code` |
| a small table of facts | `table` |

## storyboard.json

```json
{ "version": 1, "engine": "claude+rules", "density": "medium", "graphics": "mixed", "theme": "paper",
  "items": [
    { "id": "g01", "kind": "definition", "template": "term", "mode": "cutaway", "start": 207.8, "duration": 6.9,
      "why": "Defines Apache Camel", "line": "Apache Camel is an open source integration framework...",
      "props": { "term": "Apache Camel", "definition": "An open source *integration* framework...", "cues": [0.6, 0.9] } } ] }
```

`mode`: `cutaway` (opaque full frame), `panel` (boxed right), `overlay` (strip). Times are edited-timeline
seconds; cue values inside `props` are relative to the item's `start`. Edit, delete or add items freely.

## Review checklist

1. Read `STORYBOARD.md`: does each graphic teach the line it covers? Remove decoration.
2. Check cutaway seconds (target under about 20% of the video) and that nothing hides a key slide.
3. Verify every label and number against the transcript; proofread the stressed words.
4. Preview a graphic with `video-monk graphic --template <t> --props <file> --output x.png`, then Read the PNG.
5. `production-review`, `production-build --quality draft`, watch, adjust, final build.
