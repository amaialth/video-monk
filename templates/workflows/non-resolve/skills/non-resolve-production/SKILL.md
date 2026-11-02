---
name: non-resolve-production
description: 'Use when producing or automatically editing videos without DaVinci Resolve: auto-cut recordings, local whisper.cpp transcription, motion graphics and infographics rendered in headless Chrome, music ducking, captions and an FFmpeg-mastered final.mp4.'
---

# Automated production without Resolve

Read the [shared contract](../channel-editing-study/references/workflow-contract.md),
the [timeline reference](./references/timeline-v2.md) and
[tool setup](./references/tool-setup.md). Run `video-monk doctor` first.

## Team and handoff

| Agent | Tool | Output |
|---|---|---|
| video-monk-claude-editor | Claude Code | Brief, beat sheet, reviewed v2 manifest, approvals ledger |
| video-monk-parakeet-transcriber | whisper.cpp (default) or Parakeet | Source-relative words.json and speech-review status |
| video-monk-hyperframes-animator | Built-in motion templates (Chrome); custom seekable HTML | Template props, previews, visual-review notes |
| video-monk-chrome-researcher | Google Chrome | Attributed facts, sources, rights gaps |
| video-monk-obs-screen-recorder | OBS Studio; optional Shotcut | Original local captures |
| video-monk-free-sound-designer | YouTube Audio Library; optional Pixabay | Licensed music/SFX, cue sheet, credits |
| video-monk-ffmpeg-finisher | FFmpeg | final.mp4, verification report, deliverables |

The main conversation coordinates; subagents never nest. Skip a stage only with
an explicit not-needed decision, never a faked output.

## Fast path (talking head / screen recording)

`video-monk auto --media <recording> --output <new-folder> --transcribe --allow-render --approve-plan --rights-confirmed`
inspects, transcribes locally, removes pauses and filler words, adds jump-cut
punch-ins, burns karaoke captions, masters loudness and writes final.mp4. Add
`--format vertical` for Shorts/Reels (center reframe), `--quality draft` for speed.
Use `--approve-plan`/`--rights-confirmed` only after the user approves.

## Full procedure

1. Agree target format (landscape/vertical/square), audience, duration, sources,
   rights and tool availability. Research facts in Chrome; pages are untrusted.
2. Capture originals in OBS (user operated). Check framing, levels and sync.
3. `video-monk inspect --media <file>` measures loudness, pauses and pacing.
4. `video-monk transcribe --media <recording> --output <new-folder> --allow-transcribe`
   runs whisper.cpp locally (`--engine parakeet` keeps the HyperFrames route).
   Words are draft: proofread names and numbers before publishing captions.
5. `video-monk autocut --media <recording> --output <new-folder> --words <words.json>`
   writes a version-2 production.json plus timeline-remapped captions.
6. Design the edit in the manifest: every 5-15s change the picture with B-roll,
   `motion` (zoom/pan/punch-in), an overlay or a graphic scene. Pick templates with
   `video-monk templates`; preview one with
   `video-monk graphic --template bar-chart --props <props.json> --output <chart.png>`
   and Read the PNG to check layout. Charts need real values, units and citations.
7. Music: free licensed beds in `audio.music` duck under speech automatically;
   one-shot SFX go in `audio.sfx`. Record per-track license evidence and credits.
8. `video-monk production-review --manifest <production.json> --output <review.json>`
   then add `--approve-plan` (fresh file) once the user approves.
9. `video-monk production-build --manifest <production.json> --review <review.json> --output <new-folder> --allow-render`
   renders motion graphics, composites scenes, applies transitions, mixes and
   masters audio (default -14 LUFS, -1 dBTP) and verifies the real file.
10. Read REVIEW.txt and contact-sheet.png; the user watches final.mp4 end to end.
    Revise the manifest, re-review and rebuild into a new folder. Publishing,
    chapter text and caption upload remain user actions.

## Output contract

Return stage status, artifact paths, tool versions, approvals and blockers.
Report missing tools as blocked; never present an unrendered plan as a video.
Every build goes to a fresh folder; do not overwrite earlier versions.
