# @amailath/video-monk

An automated video editing toolkit for Claude Code and the command line. Give it a
recording and it **analyzes, transcribes, cuts, adds motion graphics and
infographics, mixes, masters and delivers** a verified `final.mp4`, plus captions,
chapters, thumbnail, stems and a DaVinci Resolve timeline for optional finishing.

- **Zero npm dependencies.** Node.js 22+, FFmpeg and Google Chrome are the only requirements.
- **Local and private.** Transcription runs on your machine (whisper.cpp). Graphics
  render offline in headless Chrome with networking blocked.
- **Deterministic.** Every motion graphic is a pure function of time, so renders are
  reproducible and frame-exact.
- **Gated.** Nothing renders until a plan review approves the exact manifest, media and
  captions (by content hash). Rights and facts stay human decisions.

## The web studio

```bash
video-monk ui          # opens http://127.0.0.1:4173/?token=... in your browser
```

A local, professional-grade app for the whole toolkit. Pick a video from a built-in file browser, answer a few questions (long-form, vertical short or both, footage type, pace, graphics, sound, B-roll), then watch every step happen:

- **A pipeline you can see**: footage analysis (waveform, loudness, frames), transcript, script check, cut (before and after), storyboard (a preview of every graphic on a multi-lane timeline with B-roll and sound), render progress, the finished video with its technical checks, and a vertical short.
- **Approvals built in**: it pauses and waits for you at the script (approve each correction of mis-heard words, with a "Hear it" button), the storyboard (remove graphics, fetch and keep or drop B-roll clips, then approve before anything renders), optionally the cut, and a final sign-off with a checklist. Every decision is recorded with your name, the time and a fingerprint of what you approved (`APPROVALS.md` in the project).
- **The review loops, visible**: each independent reviewer's findings, what was sent back, what the producer fixed, and the re-check.
- **Open any earlier output**: "Open an existing output" shows the results of a past `video-monk auto` run read-only.

**It remembers, and it resumes.** Everything lives in one local SQLite file (`~/.video-monk/video-monk.db`, built into Node 22.13+, no dependency): projects, every step's status, the event log, approvals, run history and checkpoints. If the app is closed or a step fails, **Resume** continues from the first unfinished step; steps you finished are kept ("kept" chips), approvals are not asked twice, and the run history shows each attempt. The database also remembers your wizard **presets**, the **glossary corrections** you approved (so "wrist" becomes REST in your next project without being told), recent footage, and usage counts that protect stock-API limits (for example Unsplash's 50 requests an hour). `video-monk db` shows where it is and what it holds.

It listens only on 127.0.0.1, behind a one-time token in the printed address; nothing leaves your machine unless you turn on stock search, Claude or Mirelo for a project. No dependencies and no build step. Projects live in `~/.video-monk/ui/projects`.

## What's new

- **0.5: production-grade, in the format you need, now with a web studio.** Asks long-form vs vertical short vs both first (`video-monk brief`), cuts a 9:16 short
  from the long edit (`cutdown`, blurred-background fit), tuned delivery (capped CRF, BT.709, accurate colours), voice treatment, caption and
  graphic readability audits, a logo bug and a drafted `YOUTUBE.md`, a script verifier that fixes mis-heard terms in context (REST, not wrist),
  and sound effects (`--sfx subtle`): built-in synthesis, or Mirelo with your own key (`--sfx-engine mirelo --allow-mirelo`).
- **0.4: checked, reusable, on-style.** Pacing measured from your recording's noise floor (quiet time in one real edit fell from 8.9% to
  0.3%), an independent reviewer for every stage with fixes limited to what was flagged (`REVIEW-LOOP.md`), a shared asset library that
  reuses graphics, transcripts and storyboards, and a ByteMonk-inspired house style by default.
- **0.3: explains with graphics, modern type.** Graphics planned from the transcript, stressed words in italic serif, kinetic captions.
- **0.2: automated editing.** One command from recording to a verified `final.mp4`.

Defaults changed in 0.4 (pace, style, review loops, library); each has a switch back. See [CHANGELOG.md](CHANGELOG.md) for details and
[docs/architecture.html](docs/architecture.html) for the big picture and every part explained.

## What it does

| Stage | Command | Result |
|---|---|---|
| Analyze | `inspect` | Loudness, true peak, pauses, speech ratio, scene-change pacing and suggestions |
| Transcribe | `transcribe` | Local whisper.cpp word timestamps, refined against measured silence |
| Plan / cut | `autocut` | Measures the recording's noise floor, removes pauses, breaths, hums and filler words, trims quiet edges, optionally speeds speech up (`--pace`, `--speed`), adds jump-cut punch-ins, remaps captions, writes a version-2 timeline |
| Explain | `storyboard` (also run by `auto`) | Reads the transcript and places motion graphics wherever an idea can be shown: definitions, flows, steps, lists, numbers, comparisons, chapters, pull-text. Offline rules, or Claude designs the diagrams (`--engine claude`) |
| Design | edit `production.json`; `templates`, `graphic` | 18 motion and infographic templates, B-roll layers, camera moves, 25 transitions |
| Build | `production-build` | Composites, transitions, karaoke captions, music ducking, SFX, two-pass loudness mastering, final encode |
| Deliver | (included) | `final.mp4`, `captions.srt/.vtt`, `chapters.txt`, `thumbnail.png`, `contact-sheet.png`, stems, `timeline.xml`, verification report |
| One shot | `auto` | Runs all of the above for a talking-head or screen recording |

### Motion graphics and infographics

`title` · `chapter` · `lower-third` · `kinetic-text` · `bar-chart` · `line-chart` ·
`donut` · `stat` (count-up) · `term` (definition card) · `comparison` · `flow` (architecture diagram with icons
and moving packets) · `steps` · `bullets` · `callout` (highlight part of the shot) ·
`quote` · `code` (typed, syntax-highlighted) · `table` · `progress-bar`, plus
word-timed karaoke captions. Each template has a validated props schema
(`video-monk templates`), adapts to 16:9, 9:16 and 1:1, and can be full-screen or
boxed in any of ten placements over footage. You can also supply your own seekable
HTML page for fully custom animation.

### Review loops

Every stage has an independent reviewer. `auto` runs **transcript → cut → storyboard → render**; after each stage the reviewer approves or
rejects with structured findings (blocker / major / minor, an owner stage, a target and, when mechanical, a fix). The producer revises
**only the flagged parts**, the reviewer checks again (3 rounds, then a human decides), and findings owned by an earlier stage are routed
back to it with downstream stages re-produced. Reviewers measure rather than guess: quiet stretches and lost speech from the audio, numbers
and labels checked against the transcript, cutaway share, empty stretches, black frames, dead air and loudness in the rendered file. An
optional Claude reviewer (`--review-agent claude --allow-llm`) adds judgment, including a look at sampled frames. Every round is written to
`loop-ledger.json` and `REVIEW-LOOP.md`. Subagents use the same schema through `video-monk review`. See
[review-loop.md](templates/workflows/non-resolve/skills/non-resolve-production/references/review-loop.md).

### Asset library

Everything generated is indexed in a shared library (`~/.video-monk/library`) so other projects reuse it: rendered graphics are cached and
searchable, the same recording is never transcribed twice, and a paid Claude storyboard is not repeated for the same transcript. Add licensed
music, SFX, images and fonts with rights recorded once, then `video-monk assets --search`, `--get` and `--export`. See
[asset-library.md](templates/workflows/non-resolve/skills/non-resolve-production/references/asset-library.md).

### House style

`--style bytemonk` (default) applies the approved provisional ByteMonk-inspired direction: dark neutral cards, calm reveals tied to the
narration, diagram-first graphics, conceptual schematics labelled, a ducked ambient bed, and a structure that opens with a concrete question
and ends with a recap and next step. It is creative direction derived from unverified notes, never a copy of the channel.
See [style-bytemonk.md](templates/skills/original-edit-planning/references/style-bytemonk.md).

### Typography

Text follows modern kinetic-type practice. Headlines are bold Geist; **stressed words switch to an italic
serif (Instrument Serif) in the accent colour**, written `*like this*` in any headline-style prop. Captions
pick stress automatically from the transcript (numbers, acronyms, proper terms, intensifiers, words the
speaker lingers on). Reveals are masked word-by-word rises with expo-out easing, stressed words focus-pull
into place, and `cues` land each word or bullet on the moment it is spoken. Two theme presets:
`night` and `paper` (warm gray, black ink, orange accent), chosen automatically from the footage brightness.
Fonts are bundled (SIL OFL). Details: [kinetic-typography.md](templates/workflows/non-resolve/skills/non-resolve-production/references/kinetic-typography.md).

### Explainer graphics

`video-monk storyboard` (and `auto`, by default) plans graphics for every idea the speaker explains, then
writes a reviewable `STORYBOARD.md` table and an editable `storyboard.json`. For each idea it chooses a
full-frame **cutaway**, a **side panel** (long ideas, keeps the picture visible) or a pull-text **overlay**,
under a density budget (`light` 3, `medium` 6, `heavy` 10 per minute), with at least two seconds of face time
between cutaways, nothing in the first second, and every label and number taken from the transcript.
Engines: `rules` (offline, deterministic) and `claude` (Claude designs the diagrams through your local
Claude Code login; opt-in with `--allow-llm`, the transcript is sent to Anthropic). See
[explainer-graphics.md](templates/workflows/non-resolve/skills/non-resolve-production/references/explainer-graphics.md).

### Editing features

Hard cuts and xfade transitions (fade, slide, wipe, circle, zoom...), Ken Burns zoom
and pan with cosine easing, punch-in jump cuts, multiple timed B-roll layers per
scene, cover/contain reframing (landscape footage to vertical shorts), per-scene
source audio with micro-fades, narration, multiple music beds with sidechain ducking,
timed SFX, loudness targets (default -14 LUFS / -1 dBTP), YouTube chapters and
theming (colors, palette, font).

## Install

```bash
# macOS
brew install node ffmpeg whisper-cpp        # whisper-cpp is optional (captions/filler removal)
# Google Chrome: https://www.google.com/chrome (or set VIDEO_MONK_CHROME to Chromium/Edge)

npm install --global @amailath/video-monk   # or run from source: node bin/video-monk.js
video-monk models --download base.en --allow-download   # optional, ~150 MB, local ASR model
video-monk doctor
```

Windows: `winget install OpenJS.NodeJS Gyan.FFmpeg Google.Chrome`, then build or
download whisper.cpp from github.com/ggml-org/whisper.cpp and set `VIDEO_MONK_WHISPER`.
Linux: distro `ffmpeg`, `chromium` and whisper.cpp. FFmpeg's `drawtext` is **not**
required; all text renders in Chrome.

## Quick start

```bash
# Fully automatic: inspect -> transcribe -> cut -> caption -> master -> final.mp4
video-monk auto --media talk.mp4 --output talk-v1 --transcribe \
  --allow-render --approve-plan --rights-confirmed

# Same, with Claude designing the diagrams (needs the claude CLI; sends the transcript to Anthropic)
video-monk auto --media talk.mp4 --output talk-v2 --transcribe --engine claude --allow-llm \
  --graphics medium --allow-render --approve-plan --rights-confirmed

# Not sure which format? Answer a few questions first (long-form, vertical short, or both)
video-monk brief --output brief.json
video-monk auto --brief brief.json --media talk.mp4 --output talk-both --transcribe \
  --allow-render --approve-plan --rights-confirmed

# Long-form plus a 9:16 short cut from it (render/final.mp4 and short/final.mp4)
video-monk auto --media talk.mp4 --output talk-both --transcribe --deliverables both --short-max 55 \
  --allow-render --approve-plan --rights-confirmed

# Only a vertical short, whole picture over a blurred background
video-monk auto --media talk.mp4 --output talk-short --transcribe --deliverables short --fit blur \
  --quality draft --allow-render --approve-plan --rights-confirmed

# Re-cut a finished edit into another format or time window
video-monk cutdown --manifest talk-v1/edit/production.graphics.json --output talk-v1/edit/short.json \
  --aspect 9:16 --from 30 --to 85
```

`talk-v1/render/final.mp4` is the result. Read `REVIEW.txt` and watch the whole file
before publishing.

## Designed edits with Claude Code

Install the skills and agents into your video project, then ask Claude to produce
the video:

```bash
video-monk install --target ~/videos/my-explainer --format claude --workflow non-resolve
```

Claude follows the `non-resolve-production` skill: research facts, auto-cut your
recording, then write a version-2 `production.json` that places a lower third,
charts, an architecture flow, B-roll and transitions on the beats of your script.
It previews each graphic as a PNG (`video-monk graphic ... --output x.png`) and
checks it visually, then reviews and builds. The full schema is in
[timeline-v2.md](templates/workflows/non-resolve/skills/non-resolve-production/references/timeline-v2.md)
with an [example](templates/workflows/non-resolve/skills/non-resolve-production/references/production-v2.example.json).

Manual equivalent:

```bash
video-monk transcribe --media talk.mp4 --output transcript --allow-transcribe --language en
video-monk autocut --media talk.mp4 --output edit --words transcript/words.json --rights-confirmed
# edit edit/production.json: overlays, graphic scenes, music, transitions
video-monk graphic --template bar-chart --props chart.json --output chart.png   # preview
video-monk production-review --manifest edit/production.json --output edit/review.json --approve-plan
video-monk production-build --manifest edit/production.json --review edit/review.json \
  --output render-v1 --allow-render
```

A version-2 scene with a chart beside the speaker:

```json
{ "kind": "video", "asset": "talk", "in": 12.4, "duration": 6, "purpose": "Show the latency gap",
  "audio": {}, "motion": { "type": "zoom-in", "amount": 0.06 },
  "overlays": [{ "template": "bar-chart", "start": 1, "duration": 5, "placement": "right",
    "props": { "title": "p99 latency", "unit": "ms", "citation": "Internal benchmark, Oct 2026",
      "bars": [{ "label": "Database", "value": 120 }, { "label": "Cache", "value": 4 }] } }],
  "transition": { "type": "slideleft", "duration": 0.4 } }
```

## Commands

Run `video-monk --help` for every option.

| Command | Purpose |
|---|---|
| `auto` | One-shot automated edit of a recording |
| `inspect` | Measure footage (loudness, pauses, pacing) |
| `transcribe` | Local word-level transcription (`--engine whisper` default, or `parakeet` via HyperFrames) |
| `models` | List/download whisper.cpp models |
| `autocut` | Silence/filler removal to a version-2 manifest with remapped captions |
| `storyboard` | Plan explainer graphics from the transcript; writes the manifest, `.storyboard.json` and `.STORYBOARD.md` |
| `review` | Run one stage's reviewer on files (transcript, cut, storyboard, render); appends to the loop ledger |
| `assets` | Search, add, check out, export and prune the shared asset library |
| `templates` | Motion template catalog and props |
| `graphic` | Render one template to `.png` (still), `.mp4` or `.mov` (ProRes 4444 with alpha) |
| `production-review` | Validate a v1/v2 manifest; `--approve-plan` records approval of its fingerprint |
| `production-build` | Render the approved timeline (`--quality draft` for fast iterations) |
| `production-verify` | Re-verify any exported file against the manifest's targets |
| `stock-search` / `stock-fetch` | Opt-in B-roll candidates and a selected download with attribution: Pixabay (video and photos), Unsplash (photos), Pexels (video) |
| `broll-plan` / `broll-fetch` / `broll-apply` | Plan where B-roll is needed, fetch and preview a clip per moment, then place the ones you keep |
| `broll-add` | Lay a downloaded clip or photo over a stretch of the timeline, continuous across the speech cuts |
| `catalog` / `fetch` / `analyze` / `style` | Reference-channel editing study (metadata, sampled frames, optional LLM style notes) |
| `plan` / `import-plan` / `validate` / `handoff` | Picture-only rough cut plans and Resolve XML handoff |
| `install` | Copy Claude Code or Copilot skills and agents into a workspace |
| `doctor` | Check required and optional tools |

## How rendering works

1. **Motion:** each template or overlay becomes a self-contained HTML page (props as
   escaped JSON, text via `textContent`). Headless Chrome seeks it frame by frame
   over the DevTools protocol. Frames whose DOM didn't change are hardlinked instead
   of re-captured, so held frames cost almost nothing.
2. **Scenes:** FFmpeg fits each source to the frame, applies camera motion, layers
   B-roll and alpha overlays in 4:4:4, and encodes a high-quality intermediate.
3. **Join:** hard-cut runs are stream-copied; transitions use `xfade` with
   frame-exact offsets.
4. **Audio:** voice (narration plus kept scene audio), ducked music and SFX buses go
   to stems, then gain staging plus an oversampled limiter reach the loudness target.
5. **Final:** one encode applies captions and global overlays, muxes the master, then
   decodes the result and measures size, frame rate, duration, LUFS and true peak.

Typical speed on an M-series Mac: about 55 ms per captured 1080p motion frame; a
10 s auto-cut talking head renders in about 5 s.

## Honest limits

- ASR output is a draft. Proofread names, numbers and jargon before publishing captions.
- Charts show the numbers you give them. The toolkit checks structure, not truth.
- `autocut` judges pauses acoustically (threshold measured from the recording). Whisper never transcribes "hm" or "um"
  for many speakers, so those are removed only as low-level stretches, not by name. Music under speech or a
  noisy room needs `--noise-db` tuning, and cuts should be watched.
- Ducking uses a sidechain compressor; very dense music may still need manual gain.
- The offline `rules` planner works from patterns in the words. On conversational speech it mostly yields
  pull-text plus a few definition cards, lists and flows; `--engine claude` (or Claude editing the
  storyboard) is what turns ideas into real diagrams. Always review the storyboard table.
- Graphics show what was said. They never add facts, but a transcription error becomes a labelling error.
- Reviewers catch what can be measured. Judgment of taste, facts and rights still needs a person, and an unfixable finding stops the run.
- Rights, attribution, factual accuracy and publishing are always human decisions.

## Reference study, Resolve handoff and version-1 manifests

The original toolkit features remain: ByteMonk-style channel study skills,
evidence-gated picture-only plans with Resolve XML, and the version-1 production
manifest (`production-build --finishing resolve|ffmpeg`). Version-1 bar graphics
now also render in Chrome, so FFmpeg no longer needs `drawtext`. Every v2 build
also writes `timeline.xml` (scene clips plus voice/music/SFX stems) for optional
finishing in DaVinci Resolve Free. See
[original-edit-planning](templates/skills/original-edit-planning/SKILL.md),
[resolve-assisted-finishing](templates/skills/resolve-assisted-finishing/SKILL.md)
and [channel-editing-study](templates/skills/channel-editing-study/SKILL.md).

## Development

```bash
npm run check   # syntax-check all modules
npm test        # unit tests + real render tests when ffmpeg and Chrome are present
VIDEO_MONK_SKIP_REAL=1 npm test   # skip real renders
```

The v1 real-media test runs when `VIDEO_MONK_FFMPEG`, `VIDEO_MONK_FFPROBE` and
`VIDEO_MONK_TEST_FONT` are set. Environment overrides: `VIDEO_MONK_FFMPEG`,
`VIDEO_MONK_FFPROBE`, `VIDEO_MONK_CHROME`, `VIDEO_MONK_WHISPER`,
`VIDEO_MONK_WHISPER_MODEL`, `VIDEO_MONK_HYPERFRAMES`.

Independent of ByteMonk, YouTube, OpenAI, Blackmagic Design, Google and HeyGen.
MIT licensed. Bundled fonts are SIL OFL; methods credit the kinetic-typography-skills (iart.ai) and
motion-graphics (Barty-Bart) projects, both MIT. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
