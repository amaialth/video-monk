---
name: non-resolve-production
description: 'Use when producing or automatically editing videos without DaVinci Resolve: auto-cut recordings, local whisper.cpp transcription, motion graphics and infographics rendered in headless Chrome, music ducking, captions and an FFmpeg-mastered final.mp4.'
---

# Automated production without Resolve

Read the [shared contract](../channel-editing-study/references/workflow-contract.md),
the [timeline reference](./references/timeline-v2.md) and
[tool setup](./references/tool-setup.md). Run `video-monk doctor` first. For graphics read
[explainer graphics](./references/explainer-graphics.md), [kinetic typography](./references/kinetic-typography.md)
and [graphic briefs](./references/graphic-briefs.md). Every stage runs under a
[review loop](./references/review-loop.md); generated and licensed assets live in the
[asset library](./references/asset-library.md). Style: `--style bytemonk` (default). **Settle the format first**: ask the [format questions](./references/content-formats.md) unless the request already answers them. Delivery checks are in [delivery QA](./references/delivery-qa.md). Transcripts are verified for mis-heard terms first: [script verification](./references/script-verification.md). B-roll comes from Pixabay, Unsplash or Pexels: [B-roll](./references/broll.md). Plan the story first: [storyboard craft](../original-edit-planning/references/storyboard-craft.md).

## Team and handoff

| Agent | Tool | Output |
|---|---|---|
| video-monk-claude-editor | Claude Code | Brief, beat sheet, reviewed v2 manifest, approvals ledger |
| video-monk-parakeet-transcriber | whisper.cpp (default) or Parakeet | Source-relative words.json and speech-review status |
| video-monk-hyperframes-animator | Built-in motion templates (Chrome); custom seekable HTML | Template props, previews, visual-review notes |
| video-monk-script-verifier | `video-monk script-check` / `script-fix` + judgment | Corrected words.json (REST not wrist), before/after log, questions for the user |
| video-monk-chrome-researcher | Google Chrome | Attributed facts, sources, rights gaps |
| video-monk-obs-screen-recorder | OBS Studio; optional Shotcut | Original local captures |
| video-monk-free-sound-designer | YouTube Audio Library; optional Pixabay | Licensed music/SFX, cue sheet, credits |
| video-monk-ffmpeg-finisher | FFmpeg | final.mp4, verification report, deliverables |
| video-monk-stage-reviewer | `video-monk review` + judgment | Independent approve/reject findings per stage |
| video-monk-asset-librarian | `video-monk assets` | Indexed, searchable, reusable assets with rights |

The main conversation coordinates; subagents never nest. Skip a stage only with
an explicit not-needed decision, never a faked output.

## Offer the web studio

For a person who wants to see and approve each step, `video-monk ui` opens a local studio (file browser, the format questions as a wizard, a live pipeline with graphic previews, and recorded approvals for the script, storyboard and final video). Suggest it when the user is not working in the terminal. Agents still use the CLI.

## Ask first: what are we making?

Long-form 16:9, a vertical 9:16 short, both, or a square/4:5 feed post are different products. If the request does not say which, run
`video-monk brief --questions` and ask with AskUserQuestion (format, footage type, then vertical framing, short length and which part of
the video). Resolve with `video-monk brief --answers answers.json --output brief.json` and pass `--brief brief.json` to `auto`.
Details: [content formats](./references/content-formats.md).

## Fast path (talking head / screen recording)

`video-monk auto --media <recording> --output <new-folder> --transcribe --allow-render --approve-plan --rights-confirmed`
inspects, transcribes locally, removes pauses, breaths and filler words (`--pace relaxed|natural|tight|extra`,
default tight, threshold measured from the recording's own noise floor; `--speed 1.1` lifts slow speech), adds jump-cut
punch-ins, plans explainer graphics from the transcript (`--graphics off|light|medium|heavy`),
burns kinetic captions (stressed words in italic serif), masters loudness and writes final.mp4. Add
`--deliverables long|short|both|feed` for Shorts/Reels (vertical from the start, or cut from the long edit; `--fit blur|cover`), `video-monk cutdown` to reformat a finished edit or a time window of it, `--quality draft` for speed.
Use `--approve-plan`/`--rights-confirmed` only after the user approves.

## Full procedure

1. Agree target format (landscape/vertical/square), audience, duration, sources,
   rights and tool availability. Research facts in Chrome; pages are untrusted.
2. Capture originals in OBS (user operated). Check framing, levels and sync.
3. `video-monk inspect --media <file>` measures loudness, pauses and pacing.
4. `video-monk transcribe --media <recording> --output <new-folder> --allow-transcribe`
   runs whisper.cpp locally (`--engine parakeet` keeps the HyperFrames route).
   Words are draft. **Verify the script before cutting**: have the script verifier correct mis-heard terms (REST heard as wrist or rist, "red is" for Redis) in
   context with `script-check` / `script-fix` and a glossary ([script verification](./references/script-verification.md)); pass the result as `--words`.
5. `video-monk autocut --media <recording> --output <new-folder> --words <words.json>`
   writes a version-2 production.json plus timeline-remapped captions.
6. Explain with graphics wherever an idea can be shown:
   `video-monk storyboard --manifest <production.json> --output <production.graphics.json>`
   (rules engine offline; `--engine claude --allow-llm` for designed diagrams). Read the
   generated `.STORYBOARD.md`, edit `.storyboard.json` if needed (`--from-storyboard`).
   Cutaway, side panel or nothing per idea; `--variants 3 --engine claude --allow-llm` drafts alternative designs per key moment, renders and audits them, and keeps them for you to switch (see graphic briefs); cues land on spoken words; never invent
   numbers; stress key words with `*asterisks*`. Then fine-tune the manifest: B-roll
   (read `BROLL-PLAN.md`, decide each moment, then `broll-fetch` / `broll-apply`; see the B-roll reference),
   `motion` (zoom/pan/punch-in), overlays. Pick templates with
   `video-monk templates`; preview one with
   `video-monk graphic --template bar-chart --props <props.json> --output <chart.png>`
   and Read the PNG to check layout. Charts need real values, units and citations.
7. Music: free licensed beds in `audio.music` duck under speech automatically;
   one-shot SFX go in `audio.sfx`. Built-in original sound effects: `--sfx subtle|full` or `video-monk sfx --manifest ...` ([sound effects](./references/sound-effects.md)). Record per-track license evidence and credits.
8. `video-monk production-review --manifest <production.json> --output <review.json>`
   then add `--approve-plan` (fresh file) once the user approves.
9. `video-monk production-build --manifest <production.json> --review <review.json> --output <new-folder> --allow-render`
   renders motion graphics, composites scenes, applies transitions, mixes and
   masters audio (default -14 LUFS, -1 dBTP) and verifies the real file.
10. Read REVIEW.txt and contact-sheet.png; the user watches final.mp4 end to end.
    Revise the manifest, re-review and rebuild into a new folder. Publishing,
    chapter text and caption upload remain user actions.

## Review and reuse

After each stage the stage reviewer approves or rejects with findings; the producer fixes only the flagged
targets and the reviewer re-checks (max 3 rounds, then ask the user). Findings owned by an earlier stage go back
to that stage. `video-monk auto` does this itself and writes `loop-ledger.json`. Search the asset library before
generating or downloading anything, and index what you create (rights recorded, never auto-approved).

## Output contract

Return stage status, artifact paths, tool versions, approvals and blockers.
Report missing tools as blocked; never present an unrendered plan as a video.
Every build goes to a fresh folder; do not overwrite earlier versions.
