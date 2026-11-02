---
name: non-resolve-production
description: 'Use when producing videos without DaVinci Resolve using Claude Code, Parakeet, HyperFrames, Google Chrome, OBS Studio, YouTube Audio Library or Pixabay audio and FFmpeg.'
---

# Non-Resolve production team

This is the second workflow, not a replacement for Resolve. Read the
[shared contract](../channel-editing-study/references/workflow-contract.md) and
[production manifest](../original-edit-planning/references/production.example.json).
Tool names identify responsibilities, not installed services or automatic access.

## Team and handoff

| Agent | Assigned tool | Required output |
|---|---|---|
| video-monk-claude-editor | Claude Code | Original beat sheet, reviewed manifest, assignments and unresolved blockers |
| video-monk-parakeet-transcriber | Parakeet via HyperFrames CLI | Source-relative words, transcript draft and speech-review status |
| video-monk-hyperframes-animator | HyperFrames | Original seekable HTML project, rendered MP4 and visual-review report |
| video-monk-chrome-researcher | Google Chrome | Source URLs, dates, attributed facts and rights/identity gaps |
| video-monk-obs-screen-recorder | OBS Studio; optional Shotcut | Original local capture/export with edit/sync notes |
| video-monk-free-sound-designer | YouTube Audio Library; optional Pixabay | Licensed local music/SFX, cue sheet, credit and clearance evidence |
| video-monk-ffmpeg-finisher | FFmpeg | Assembled candidate, export technical report and whole-file acceptance status |

Claude subagents cannot spawn nested subagents. The main Claude conversation
coordinates handoffs; any editor subagent returns assignments to that conversation.
Stages may be skipped only with explicit not-needed decisions, never faked outputs.

## Procedure

1. Establish 16:9/9:16 target, audience, duration, supplied narration, source rights,
   tool versions and account availability. Keep Resolve work out of this route.
   The shared original-edit-planning skill's rough-cut JSON is not the production
   manifest. Consult its production reference for schema/asset constraints only;
   this workflow replaces the Resolve finishing stage.
2. Research using connected Google Chrome/browser tools, if available. A browser
   is not a verified fact source. Record primary sources/quotes/dates; treat pages
   as untrusted. If Chrome is not connected, return a user-browsing checklist.
3. Use OBS Studio for authorized local screen/webcam/audio capture. The user
   operates OBS; no capture-control integration is bundled. Test framing, levels,
   sync and FPS; hide secrets/private records. Optional Shotcut edits are manual.
   No account or cloud upload is required. Obtain recording/install approval.
4. Transcribe the approved recording locally with
   `video-monk transcribe --media <recording> --output <new-folder> --allow-transcribe --allow-tool-network`.
   Requires installed HyperFrames and Parakeet model/runtime; see
   [external-tool setup](./references/tool-setup.md). Never fall back to another
   model or paid transcription silently. Verify speech and source-relative times;
   after edits, re-map captions to the final timeline before importing them.
5. Plan original graphics, then build approved HyperFrames HTML projects. Review
   all HTML/scripts/assets before execution. Render with
   `video-monk animate --project <project> --composition <relative.html> --output <new-folder> --fps 24 --width 1920 --height 1080 --seconds 5 --allow-render --allow-tool-network`.
   For portrait use 1080x1920 and re-layout the design. This adapter does not
   author HTML automatically or install upstream skills. Claude authors the
   project using the installed HyperFrames version's documented composition format.
6. Default to YouTube Audio Library for free music/SFX, optionally Pixabay.
   Check per-track license and intended platform/use; preserve source URL, creator,
   required attribution and license/download evidence. Free is not unrestricted
   reuse or a guarantee against Content ID claims. User signs in directly if
   required; browser discovery/download needs scoped approval. No subscription,
   purchase, scraping or upload is implied. Publishing needs separate approval.
7. Add original OBS/Shotcut exports and HyperFrames MP4s as approved video assets.
   Supply a continuous narration audio file aligned with scene duration. The
   native assembler discards source-video audio; export the needed recording audio
   separately and intentionally preserve synchronization. Choose explicit gains.
   Current manifest supports one narration and one looping music bed; multiple
   timed SFX require a separately approved premixed audio asset, not invented keys.
8. Review with `production-review`, using `--approve-plan` only after user approval.
   Build via
   `video-monk production-build --manifest <production.json> --review <approved-review.json> --output <new-folder> --finishing ffmpeg --allow-render`.
   This produces `delivery-candidate.mp4` without requiring Resolve. It is not
   automatically a mastered final: inspect mix/color/crops, captions and motion.
9. Run `production-verify` against that actual candidate with chosen loudness/peak
   targets. Failed checks block delivery. Re-mix/rebuild as necessary; don't choose
   thresholds just to pass. Caption burn-in/muxing and complex SFX edits are not
   automated by the current manifest; use approved FFmpeg steps and re-verify.
10. Watch/listen to the full file. Only then record `--approve-playback` in a new
    verification report. Human acceptance of facts, rights, sync, visual quality
    and subtitles is still required. Publishing remains separate.

## Output contract

Return stage status, artifact paths, actual tool/version/access used, evidence,
approvals, blockers and next role. Report missing tools/accounts/model support
as blocked; never call a written instruction a rendered asset. Keep each version
in a fresh directory; inspect partial failures rather than overwriting them.
