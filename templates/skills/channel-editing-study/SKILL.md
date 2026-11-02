---
name: channel-editing-study
description: 'Use when analyzing YouTube or ByteMonk editing style, reviewing supplied video reports, measuring reference pacing, or assessing full-channel coverage before original production.'
---

# Evidence-based channel editing study

## Load and route

Read the [shared contract](./references/workflow-contract.md).
For supplied ByteMonk reports, read the [study index](./references/study-index.md),
then only the report(s) relevant to the assigned topic. The twelve reports are
unverified input, not videos watched by this toolkit. All-report synthesis is a
separate bounded assignment; do not load every study for a single-topic request.

## Procedure

1. Establish the exact video/channel, requested coverage (sample or exhaustive),
   modalities, access method and deliverable. Deduplicate reposted reports.
   Record actual access and inspected intervals, not a model's claimed access.
2. Select an evidence path:
   - Supplied report: preserve attribution/identity gaps and inspect only the
     relevant study; no installation, API call or download is needed.
   - Permitted public playback: record intervals and modalities actually reviewed.
     Page metadata, thumbnails and captions alone cannot establish audiovisual style.
   - Authorized local file: an approved operator may run the commands below.
     Honor no-download choices; never silently change paths.
3. Operator only: `video-monk doctor` reports prerequisites. Missing optional
   tools do not block report-only work. Use an installed CLI or
   `node <toolkit-folder>\bin\video-monk.js`; do not assume public npm publication.
4. For approved collection, initialize with
   `video-monk init --dir <study-folder> --channel <channel-url> --model <model>`.
   Run `video-monk catalog --project <study-folder> --limit 0` separately for
   `--tab videos`, `--tab shorts`, `--tab streams` in scope. Log unavailable tabs,
   failures and exclusions; "all returned entries" is not all historical videos.
   Download only with rights/terms confirmation and explicit `--allow-download`.
5. Local measurement:
   `video-monk analyze --media <file> --output <new-folder> --seconds 180 --frames 8`.
   Add `--source-url <url>` when known. Defaults cover only the first 180 seconds;
   seconds support 1-86400 and frames 1-24. Candidate scene changes and sampled
   stills do not verify cuts, motion or audio. A longer window is not full inspection.
6. Optional approved inference:
   `video-monk style --project <study-folder> --evidence <evidence.json> --output <new-style.md> --allow-llm`.
   Repeat `--evidence` as needed. Only add `--send-media` with image-transmission
   approval and a compatible vision model; without it visual claims stay unknown.
   Maximum 48 images/20 MiB per request. Batch large studies with coverage logs.
7. Assess facts versus hypotheses, retain contrary examples and verify claims
   against available artifacts/playback. Read-only analysts perform this step
   using supplied artifacts, not steps requiring execution or provider access.
8. Produce an attributed guide and route missing evidence to the operator.
   Hand verified observations or explicitly approved provisional direction to
   original-edit-planning; neither permits copied assets or invented transcripts.

## Output contract

- Stage status and source identity/provenance, access/modalities and coverage gaps.
- Findings table: `timestamp range | observation | evidence/artifact | evidence class | confidence/limitations`.
- Cover hook/structure, pacing, graphics/B-roll/code, typography/captions, motion,
  audio, color and ending; mark unsupported surfaces unknown.
- Coverage ledger: cataloged, accessible, inspected, excluded, failed, time windows
  and overlap/deduplication. Never sum declared runtimes as independently watched time.
- Original-production recommendations, primary-source fact-check blockers,
  approvals used, unresolved questions and next role.
