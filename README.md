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

## What it does

| Stage | Command | Result |
|---|---|---|
| Analyze | `inspect` | Loudness, true peak, pauses, speech ratio, scene-change pacing and suggestions |
| Transcribe | `transcribe` | Local whisper.cpp word timestamps, refined against measured silence |
| Plan / cut | `autocut` | Removes pauses and filler words ("um", "uh"), adds jump-cut punch-ins, remaps captions, writes a version-2 timeline |
| Design | edit `production.json`; `templates`, `graphic` | 17 motion and infographic templates, B-roll layers, camera moves, 25 transitions |
| Build | `production-build` | Composites, transitions, karaoke captions, music ducking, SFX, two-pass loudness mastering, final encode |
| Deliver | (included) | `final.mp4`, `captions.srt/.vtt`, `chapters.txt`, `thumbnail.png`, `contact-sheet.png`, stems, `timeline.xml`, verification report |
| One shot | `auto` | Runs all of the above for a talking-head or screen recording |

### Motion graphics and infographics

`title` · `chapter` · `lower-third` · `kinetic-text` · `bar-chart` · `line-chart` ·
`donut` · `stat` (count-up) · `comparison` · `flow` (architecture diagram with icons
and moving packets) · `steps` · `bullets` · `callout` (highlight part of the shot) ·
`quote` · `code` (typed, syntax-highlighted) · `table` · `progress-bar`, plus
word-timed karaoke captions. Each template has a validated props schema
(`video-monk templates`), adapts to 16:9, 9:16 and 1:1, and can be full-screen or
boxed in any of ten placements over footage. You can also supply your own seekable
HTML page for fully custom animation.

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

# Vertical short from the same recording, fast draft quality
video-monk auto --media talk.mp4 --output talk-short --transcribe --format vertical \
  --quality draft --allow-render --approve-plan --rights-confirmed
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
| `templates` | Motion template catalog and props |
| `graphic` | Render one template to `.png` (still), `.mp4` or `.mov` (ProRes 4444 with alpha) |
| `production-review` | Validate a v1/v2 manifest; `--approve-plan` records approval of its fingerprint |
| `production-build` | Render the approved timeline (`--quality draft` for fast iterations) |
| `production-verify` | Re-verify any exported file against the manifest's targets |
| `stock-search` / `stock-fetch` | Opt-in Pexels B-roll candidates and a selected download with attribution |
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
- `autocut` judges pauses acoustically. Music under speech or a noisy room needs
  `--noise-db` tuning, and cuts should be watched.
- Ducking uses a sidechain compressor; very dense music may still need manual gain.
- Automatic graphic placement is the editor's (Claude's) job via the manifest;
  `auto` alone produces cuts, punch-ins and captions, not infographics.
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
MIT licensed.
