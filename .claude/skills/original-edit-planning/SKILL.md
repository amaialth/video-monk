---
name: original-edit-planning
description: 'Use when planning or reviewing original YouTube edits, B-roll, animated infographics and production assembly, or creating source-footage rough cuts and transcript-gated captions.'
---

# Original edit planning

Read the [shared contract](../channel-editing-study/references/workflow-contract.md).
For ByteMonk-inspired work, consult the [study index](../channel-editing-study/references/study-index.md)
and only the chosen topic reports. Do not copy their scripts, assets or durations.

For B-roll, local animated graphics, merged audio/picture and final Resolve
delivery, load [production assembly](./references/production.md) and its example.
That separate manifest powers `production-review`, `production-build` and
`production-verify`; do not put production fields in the rough-cut plan below.

## Procedure

1. Accept a verified reference guide OR the user's explicitly approved
   `provisional creative direction`. Preserve the evidence status; unresolved
   technical claims are blockers, not plausible substitute facts.
2. Confirm audience, original teaching goal, duration, aspect ratio, source rights,
   delivery target and manual finishing capacity. Select a narrative form from
   the index that fits the topic; short explainers and long labs need different pacing.
3. Create a compact original storyboard before calling a model:
   `beat | purpose/narration | source ID + in/out or missing asset | visual/state change | audio/caption need | evidence/approval blocker`.
   For new diagrams, specify labels, states, causal arrows and readable holds.
   Request missing assets; don't invent footage IDs or imply graphics already exist.
4. Build `inventory.json` from the project example or README: version 1, nonempty
   media list, unique `id`, local `path`, `role: "source"` and precise `description`.
   Paths resolve from the inventory file. References stay separate. The CLI
   probes technical metadata, not content; descriptions must match real footage.
5. Write an original brief and obtain a verified source transcript if captions
   are requested. No transcript means empty captions; a reference report is not
   the original video's speech. Supplied transcript timing is still a review draft.
6. For Claude Code/local drafting, write a strict JSON plan using the contract
   below, then run
   `video-monk import-plan --inventory <inventory.json> --plan <draft-plan.json> --output <new-bundle.json>`.
   Add `--transcript <verified-transcript.txt>` only when supplied. This needs
   ffprobe, but no project config, API key or separate provider request.
   The command validates timing/shape, not speech identity or creative quality.
7. For optional API planning instead, explain provider, cost/retention and data sent: brief, style, source descriptions,
   metadata and optional transcript, not raw source video. Get approval before
   `--allow-llm`; don't print keys. Manual storyboarding needs no provider call.
   Generate the API draft:
   `video-monk plan --project <study-folder> --inventory <inventory.json> --brief <brief.txt> --style <style.md> --output <new-bundle.json> --allow-llm`.
   Add `--transcript <verified-transcript.txt>` only when supplied.
8. For either path, review clip choices, speech continuity, frame bounds, duration and subtitle
   words/alignment. Run `video-monk validate --bundle <bundle.json>` after edits.
   Failed validation blocks handoff; don't coerce bounds or drop important clips
   silently to manufacture a valid plan.
9. Hand the reviewed bundle/storyboard to resolve-assisted-finishing. Do not
   render, operate demonstration systems or expand the channel study.

## Editing craft and house style

How to edit (staged gates, look at your own cut, cut by measured audio with a tone, rhythm by idea) is in
[editing-craft](./references/editing-craft.md). Every original video follows the approved provisional
[ByteMonk-inspired house style](./references/style-bytemonk.md) unless the user says otherwise.
Review each stage independently and send findings back to the producing stage (loop in the non-Resolve team).

## CLI plan contract

- Top-level fields: `version`, `title`, `fps`, `width`, `height`, `clips`,
  `captions`, `finishing`; `durationFrames` is computed by validation.
- `clips`: sequential `{mediaId, in, out, purpose}`; bounds are source seconds.
  No invented IDs, transitions, tracks or effects. Missing production assets
  remain explicit storyboard tasks, not fabricated inventory entries.
- `captions`: ordered non-overlapping `{start, end, text}` in final timeline
  seconds; keep empty without a verified transcript.
- `finishing`: nonempty string arrays `audio`, `color`, `graphics`, `export`.
  Use for manual diagram/motion/mix/grade instructions, not claims of applied work.
- Timeline FPS: integer 24/25/30/50/60. XML handoff also requires supported integer
  source rates; intentionally conform approved copies rather than relabel footage.
- XML is picture-only. The schema validates shape/timing, not factual accuracy,
  spoken-word identity, creative quality or actual finishing.

## Output contract

Stage status; original storyboard/brief and inventory; validated draft bundle;
evidence status and decisions; missing assets/fact-checks; caption review status;
manual finishing tasks; approvals and next responsible role. Stop at reviewed
rough-cut handoff, not a claim that the final video is complete.
