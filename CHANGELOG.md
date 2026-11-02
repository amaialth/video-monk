# Changelog

Each entry says what changed, why it matters, and how to use or undo it. The full explanation of every part is in
[docs/architecture.html](docs/architecture.html).

## 0.4.1: calm framing, content always visible

**Why:** the picture zoomed in and out constantly behind panels (a punch-in on every other cut), and a panel covered the slide being explained.

### Changed
- **No zoom by default.** The per-cut punch-in is off in the house style. With `--jump-zoom` it now changes at most once every 8 seconds and
  holds across cuts, and no scene keeps any camera motion while a graphic is on screen.
- **Split layout for side panels.** While a panel is up, the picture eases down to fit beside it (about 47% width, centred, on the theme
  background) so the whole slide stays visible, then expands back. Cutaways and pull-text strips are unchanged. Manifest overlays take
  `layout: "split"` (needs placement left or right); the house style sets it for panels, `--style plain` keeps overlays.
- `--fit contain` shows the whole frame instead of cropping when the output aspect differs (use it for slides in vertical videos).
- The cut reviewer flags zoom flicker (more than 12 flips a minute) and the reviser removes it.

Split windows are filtered and scaled separately, so a render with many panels takes longer (about 100 s more on a 6-minute 1080p60 video).

## 0.4.0: checked, reusable and on-style

**Why:** the edit still had dead air, nothing checked the result, work was regenerated every time, and videos had no consistent look.

### Added
- **Pacing measured from your recording.** The silence threshold comes from the recording's own noise floor and speech level (level
  histogram, Otsu split). Breaths, hums and other quiet stretches are removed, and long quiet lead-ins and tails are trimmed from each
  kept segment. On a real quiet recording the quiet time in the edit fell from 8.9% to 0.3% while all clearly voiced audio was kept.
  `--pace natural|tight|extra` (default `tight`), `--speed 1-1.5` (pitch preserved, captions retimed), `--asr-prompt`.
- **Review loops.** Transcript, cut, storyboard and render each have an independent reviewer. Findings carry a severity, an owner stage,
  a target and, when mechanical, a fix. The maker revises only the flagged parts; findings owned by an earlier stage are routed back
  and later stages are re-produced; after 3 rounds a person decides. `auto` runs it by default and writes `loop-ledger.json` and
  `REVIEW-LOOP.md`. New `review` command for subagents. Optional Claude reviewer (`--review-agent claude --allow-llm`).
- **Asset library** (`~/.video-monk/library`). Rendered graphics, transcripts and paid Claude storyboards are indexed and reused across
  projects; licensed music, SFX, images and fonts are indexed with rights. New `assets` command.
- **House style `bytemonk`** (default): provisional ByteMonk-inspired direction approved by the user. Dark calm cards, diagram-first
  graphics, "Conceptual schematic" labels, a ducked ambient bed, and a structure with a question first and a recap and next step last.
- **Agents and skills:** `video-monk-stage-reviewer`, `video-monk-asset-librarian`; references for editing craft, the house style,
  review loops and the asset library; notices for the community list the editing guidance was surveyed from.

### Changed
- AAC overshoot is measured on the decoded file and fixed with brief local gain dips (video is encoded once, audio muxed separately).
- Timeline totals are counted in whole frames.
- Storyboards, graphics and transcripts are cached instead of regenerated.

### Fixed
- A 178-segment edit failed with a one-frame accounting mismatch (22143 vs 22144).
- The storyboard reviewer dropped valid phase panels because "phase one" on screen as "Phase 1" looked like an invented number.
- The storyboard stage crashed after a revised cut.
- "Source: Conceptual schematic" is now just "Conceptual schematic".

### Defaults that changed
| Now | Before | Switch back |
|---|---|---|
| pace `tight`, measured threshold | fixed -35 dB, 0.35 s | `--pace natural` |
| style `bytemonk` | none | `--style plain` |
| review loops on | straight line | `--review-loop off` |
| asset library on | none | `VIDEO_MONK_LIBRARY=off` |

## 0.3.0: explains with graphics, modern type

### Added
- **Explainer graphics planner** (`storyboard`, and inside `auto`): finds ideas in the transcript that can be shown (definitions, flows
  between systems, steps, lists, numbers, comparisons, chapters) and places graphics as full-frame cutaways, side panels or pull-text
  overlays under a density budget, with face-time and hook rules. Offline `rules` engine or opt-in `claude` engine. Reviewable
  `STORYBOARD.md` and editable `storyboard.json`.
- **Kinetic typography:** stressed words in italic serif and the accent colour (`*like this*`), automatic caption stress, word-by-word
  mask reveals, graphics that appear on the spoken word (`cues`), `kinetic` captions, `night` and `paper` themes.
- New `term` (definition card) template, opaque side panels with vertical layouts, bundled Geist and Instrument Serif (SIL OFL).
- `THIRD_PARTY_NOTICES.md` and CC-licensed credits for the methods used.

### Fixed
- Empty `suffix` strings silently dropped plain-number graphics; panels were see-through; flow diagrams clipped in narrow panels.

## 0.2.0: automated editing

- `auto`, `inspect`, `transcribe` (local whisper.cpp), `autocut`, `graphic`, `templates`, version-2 manifest with transitions, camera
  moves, B-roll, overlays, music ducking, loudness mastering, chapters, thumbnail, contact sheet, Resolve XML and verification.
- 17 motion and infographic templates rendered in headless Chrome (no FFmpeg `drawtext` needed), approval gates by content hash.
- Fixed macOS path handling in tests.

## 0.1.0

Reference-channel study skills, picture-only rough-cut plans with Resolve XML handoff, version-1 production manifests.
