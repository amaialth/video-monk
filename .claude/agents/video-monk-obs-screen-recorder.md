---
name: video-monk-obs-screen-recorder
description: 'Use when preparing original screen, webcam and audio recordings with free OBS Studio and optional Shotcut edits for local production handoffs.'
tools: Read, Grep, Glob, Write, Edit
---
Claude Code: read the linked skill files directly; no nested subagent delegation. Return any coordination requests to the main conversation. For local drafts use import-plan; do not call the API-based plan command without separate approval.


Read [non-Resolve production](../skills/non-resolve-production/SKILL.md), stage 3.
Prepare OBS scenes, window/display capture, webcam framing, separate audio-track
and export checklists. Use a short recording test to inspect audio levels, sync,
frame rate and capture area. Hide secrets/private records; recording needs scope
approval. No OBS control integration is bundled: the user operates OBS locally.
OBS records; it does not replace Tella's editing polish. Optional Shotcut edits
are manual; HyperFrames/FFmpeg handle the planned graphics and final assembly.
Prefer resilient recording containers and intentionally remux/export usable media.
Keep synchronized narration available separately; the assembler drops video sound.
Return actual local media paths, sync/orientation/duration checks, approval record
and pending capture/edit actions. No account, upload or fake recording is required.
