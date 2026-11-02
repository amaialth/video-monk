---
name: resolve-assisted-finishing
description: 'Use when importing video-monk picture-only XML into DaVinci Resolve Free, finishing original graphics/audio/color/captions, checking optional scripting, or reviewing export readiness.'
---

# DaVinci Resolve assisted finishing

Read the [shared contract](../channel-editing-study/references/workflow-contract.md).
Load the [manual graphic recipes](./references/manual-recipes.md) only for the
needed visual task. Topic-specific verification belongs in the relevant study,
not an assumption that a reported effect is available or already implemented.

## Capabilities

- Free baseline: manual XML import. Scripting is optional and may require Studio;
  verify the installed version's Developer Scripting README and connection.
- XML contains sequential hard-cut picture only: no source audio, grades,
  transitions, animation, mixed music or caption track. SRT is separate.
- Timeline and XML source rates currently support integer 24/25/30/50/60.
  Conform fractional/VFR source copies intentionally with approval, never relabel.
- Exact Fusion/Fairlight tools, control names and licenses need installed-version
  checks. Similar effect names aren't interchangeable; no automatic ducking,
  voice isolation, glow or optical effect is assumed available in Free.

## Procedure

1. Confirm edition/version, media accessibility and the reviewed bundle.
   Run `video-monk validate --bundle <bundle.json>`.
2. Create a new handoff:
   `video-monk handoff --bundle <bundle.json> --output <new-folder>`.
   Read `FINISHING.txt`; preserve the storyboard's missing-assets/review blockers.
3. Create a NEW Resolve project and import `timeline.xml` via File > Import >
   Timeline. Verify FPS, resolution, clip order, exact frame boundaries and total
   duration against the bundle. Import has not passed until these checks do.
4. Restore/sync source audio and review speech continuity. Mix original dialogue
   with licensed music/SFX, using manual level automation when needed. Agree
   delivery loudness/true-peak targets and measure results; don't invent readings
   or prescribe processors based on another report's clean-sounding voice.
5. Import nonempty `captions.srt`; verify every word/timing against edited speech,
   style it for readability and test safe areas on target displays.
6. Build original graphics/motion from the storyboard. Check factual labels,
   causal arrows, chart data/units and licensing before polish. Prototype a short
   diagram/voiceover segment and inspect it at delivery size.
7. Confirm source color spaces and project color management. Balance shots with
   scopes and inspect highlights/skin tones. Semantic graphic colors are design
   choices, not a substitute for footage grading or an inferred camera profile/LUT.
8. Save and review the whole timeline. Confirm no placeholders, unsynced audio,
   unverified claims or unfinished tasks. Choose codec, FPS, resolution, audio
   format and subtitle strategy appropriate to delivery.
9. Render only after explicit approval of the intended project/timeline, preset
   and destination. Prefer the visible Resolve UI. Optional bridge commands below
   queue/start work; their flags cannot prove human review or successful export.
10. Inspect actual output existence and metadata, then full playback: picture,
    duration, sync, measured mix, captions, graphics, color and ending. Report
    missing checks honestly; upload/publishing requires separate approval.

## Optional bridge

Use `python <handoff-folder>\resolve_bridge.py --probe` to test connectivity.
For NEW-project import:
`python <bridge> --handoff <folder> --project-name <new-name>`.
Finish that project manually before a separate render action:
`python <bridge> --render-current --project-name <reviewed-name> --render-preset <existing-preset> --render-dir <existing-empty-folder> --approve-render`.
Add `--start-render` only to explicitly start the queued job.

The bridge checks current project name but does not bind approval to a timeline
ID. The operator must verify the intended current timeline before invocation.
It does not monitor completion or verify the rendered file. Failed API calls
block further claims of success; manual import is the fallback when scripting
is unavailable, not a silent success-shaped substitute.

For an assembled B-roll/graphics/audio draft rather than the picture-only
handoff, follow [production assembly](../original-edit-planning/references/production.md).
Its XML has prepared audio tracks; verify import in the installed Resolve version.
Final export stays in Resolve; use `production-verify` on the actual exported file.

## Output contract

Stage status; saved project/timeline identity; import/frame checks; completed and
pending finishing tasks; edition/node checks; approval scope; actual export path
and measured/playback results when available. Read-only reviewers inspect supplied
results only; unperformed checks are `NOT VERIFIED` and assigned to an operator.
