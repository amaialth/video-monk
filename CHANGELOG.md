# Changelog

Each entry says what changed, why it matters, and how to use or undo it. The full explanation of every part is in
[docs/architecture.html](docs/architecture.html).

## 0.5.0: production-grade delivery, voice and captions

**Why:** a render that only "passes" is not yet a video you can upload. This release adds delivery tuning, voice treatment and caption hygiene,
informed by the public video-editor-skills, claude-code-video-toolkit and awesome-claude-video-skills repos (ideas only; see THIRD_PARTY_NOTICES.md).

### Added
- **Delivery layer** (`src/delivery.js`): capped CRF with maxrate/bufsize per resolution and fps, High profile and level, BT.709 colour tags
  written through x264 params, an explicit RGB to YUV BT.709 matrix for graphics (so brand colours stay accurate), targets `youtube`, `master`, `web`
  (`delivery.target`), 320 kb/s AAC by default, and a warning for HDR sources. Verification now checks colour tags and the bitrate cap.
- **Voice treatment** (`src/voice.js`, `--voice auto|on|off`): each spoken asset is measured for dullness and noise. Every voice gets high-pass, de-ess and gentle
  compression; muffled voices get presence EQ; noisy rooms get a floor-matched denoise. Near-silent clips are never boosted. The report records what was applied.
- **Caption hygiene**: cut-off fragments (`es--`), drawn-out fillers, stutters and stray punctuation are removed; `captions.fixes` takes `{replace, drop}`
  for names and jargon; a lone short word joins the next page and pages stay on screen at least 0.9 s.
- **Pace `relaxed`** for interviews and vlogs: keeps natural breathing room and removes only long dead air.

### Changed
- Caption pages hold longer by default (0.9 s minimum).

- **Format questions first** (`src/brief.js`, `video-monk brief`): long-form 16:9, vertical 9:16 short, both, or square/4:5; footage type; vertical framing; short length; which part of the video. Claude Code asks them with AskUserQuestion (`brief --questions`); `auto --brief brief.json` applies the answers.
- **`--deliverables long|short|both|feed`** on `auto`. `both` renders the long edit, then cuts a 9:16 short from the approved edit into `short/`.
- **`cutdown` command** (`src/cutdown.js`): reformat a finished manifest to 9:16, 1:1, 4:5 or 16:9 and optionally slice a time window (scenes, B-roll, graphics, captions, music). Windows end on a sentence; `--highlight` proposes the strongest stretch for approval; Shorts length is warned about.
- **`fit: blur`**: whole picture over a darkened, blurred copy of itself (`--fit blur`).
- **Graphic readability audit** (`src/motion/audit.js`): text off the frame or clipped is a defect; text under 2.2% of the short side and contrast under 3:1 are advisories. In `report.graphicAudit` and as render-review findings.
- **Caption audit** (overlap, reading speed over 20 chars/s, long pages, flicker, lone words) and **frozen-picture** detection in the render review.
- **`watermark`** (logo bug) and **`--brand brand.json`** (theme tokens + logo).
- **`YOUTUBE.md`** in every render: title options, description draft, chapters only when YouTube would accept them, credits, tags and an upload checklist.
- New references for agents: `content-formats.md`, `delivery-qa.md`.

- **Script verifier**: `script-check` and `script-fix`, a `video-monk-script-verifier` agent and a `script-verification.md` reference. Sound-alike mishearings (REST heard as wrist or rist, "red is" for Redis) are matched with a sound key, split or merged terms are found, and glossary hints (`REST | api; http`) tie a term to its context so a real "wrist" stays. Fixes keep timing, carry a reason, and are logged for approval. The transcript reviewer uses the same matching (`replaceSpan` fixes) and the Claude reviewer is told to judge in context.
- **Sound effects** (`src/sfx.js`, `video-monk sfx`, `auto --sfx off|subtle|full`): nine original sounds synthesised with FFmpeg (whoosh, swipe, pop, chime, ding, click, tick, impact, riser), placed on graphics as quiet `audio.sfx` cues, indexed in the asset library and reused. The brief asks about them. Reviewed and not adopted: Sousa FX Generator (Max/RNBO effect processors for a tuba rig, not a sound-effect generator, no licence file) and the "Sound Effects Expert" skill (prompt guidance for ElevenLabs/AudioCraft, which send prompts to a service or need a local model).
- **Mirelo text-to-SFX** (`src/mirelo.js`, `--engine mirelo --allow-mirelo`): richer generated sound effects and ambience from a prompt, with a credit budget, library reuse so nothing is paid for twice, fallback to the built-in sounds, the key read from `MIRELO_API_KEY` or `.env` and never shown. `sfx --credits`, `sfx --prompt`, and `sfx --audition` (a listening page with waveform and spectrogram). Verified live with a small generation (85 credits for the nine standard sounds); tests use a mocked API and spend nothing.
- **Mirelo MCP server** registered in `.mcp.json` (token from `MIRELO_API_KEY`, no secret in the file) so Claude Code agents can also use `preflight`, `video_to_sfx`, `extend_audio` and `inpaint_audio`; rules for cost quotes, approval and registering results are in the sound-effects reference. Start Claude Code with the variable set (`set -a; . ./.env; set +a; claude`).
- **Pixabay B-roll** (`stock-search --provider pixabay`, `--type video|image`, `--orientation`, `broll-add`): searches videos and photos with your `PIXABAY_API_KEY`, leaves out AI-generated and low-quality results, caches responses for 24 hours as the API requires (a repeated search makes no request), respects the 100-requests-a-minute limit, downloads into the project (no hotlinking) with creator, source page and licence recorded, and indexes clips in the asset library so they are reused. `broll-add` lays one clip continuously over several speech cuts (blurred fit on vertical, slow zoom on photos). New `broll.md` reference; the editor and researcher agents are updated. Pexels still works (`--provider pexels`). Verified live with one search and one small download.
- **B-roll planning** (`src/broll-plan.js`, `broll-plan`, `broll-fetch`, `broll-apply`, `--broll off|plan|fetch`): every storyboard run now writes `BROLL-PLAN.md`: moments where a concrete subject is named with no graphic on screen, and long speaker-only stretches, each with a draft search query and confidence. Never in the opening or closing 5 s, over a graphic, or closer than 12 s; sparse for screen recordings and interviews. `broll-fetch` searches, picks, downloads and writes a preview per clip; `broll-apply` places what you did not drop. `auto --broll fetch` does it inside the pipeline. The editor agent now treats it as a standing step.
- **Top bar vs captions**: a pull-text strip is not drawn when at least 60% of its words are in the burned-in captions at that moment (`repeatsCaptions`); the storyboard reviewer flags any that remain (`sb-caption-duplicate`). Stat graphics' numeric values are now checked against the transcript like other numbers. Behaviour change: with captions on, fewer pull-text strips appear (they were duplicates); captions off keeps them.
- **Multiple motion graphics** (`src/variants.js`, `--variants 2-4` with `--engine claude --allow-llm`): for the key explanatory moments Claude drafts alternative designs from three directions (structure, typographic, points) using the graphic brief; each is rendered as a still, audited for layout and checked for grounding, and the best passing one is applied. All alternatives and a side-by-side image are kept in `<name>.variants/`; set `chosen` in the storyboard to pick another. Tested with a mocked Claude; not run against the real model in this change.
- **Unsplash photos** (`--provider unsplash --type image`, `UNSPLASH_ACCESS_KEY`): high-resolution still B-roll (resized originals at 1920 or 2560 wide), with the Unsplash API terms built in: Client-ID header auth, the download notification before a photo is saved, photographer and Unsplash credits with utm links, `ixid` kept, results cached 24 hours (demo apps get 50 requests an hour), a clear message when the hourly limit is hit. Photos only: Unsplash has no video. `--provider auto` now picks by type (video: Pixabay or Pexels; photo: Unsplash when its key is set). `broll-fetch --type video|image|any` (default any: video first, then a photo). Verified live with one search and one small download; the secret key and app id are not used.
- **Web studio** (`video-monk ui`, `src/ui/`, `web/`): a local app with a server-side file browser, the brief questions as a wizard, a live pipeline view (analysis, transcript, script check, cut, storyboard with graphic previews and a multi-lane timeline, render progress, final video with checks, vertical short), the review loop shown round by round, a System page (tools and keys, names only), and the asset library. Approvals are first-class: the run pauses for the script (each correction), the storyboard (remove graphics, fetch and choose B-roll), optionally the cut, and a final checklist sign-off; each decision is recorded (who, when, a fingerprint) in `approvals.json` and `APPROVALS.md`. Open earlier `auto` output folders read-only. Loopback only with a one-time token cookie, Host and Origin checks and a strict content-security policy; no dependencies, no build.
  - To support it, `runPipeline` takes optional `onEvent`, `gate` and `signal` (unchanged behaviour when absent) and `autoEdit` passes them through.
- **Local database and resume** (`src/db.js`, `src/resume.js`, `video-monk db`): one SQLite file (`node:sqlite`, no dependency; Node 22.13+) replaces the studio's JSON files and holds projects, steps, events, approvals (also an audit trail across projects, shown on a new Approvals page), runs and **checkpoints**. A run can be **resumed** after the app is closed, a failure or a cancel: stages approved earlier are restored from their files and not repeated (no second review, no second approval question), the run continues at the first unfinished step, and the run history records each attempt. Also stored: wizard **presets**, **remembered glossary terms** (a correction you approve is proposed again in later projects, with a switch to turn it off), recent footage, settings, and **usage counters** (Unsplash's 50 requests an hour and Pixabay's 100 a minute are now counted across projects and restarts and refused before the limit; Mirelo credits spent). Projects from the earlier JSON-file layout are imported once. `runPipeline` and `autoEdit` take an optional `resume`/`restored` (unchanged behaviour without it).
  - Node 22.13 or newer is now required (`node:sqlite` is built in from there). The command-line tools that do not use the database still run, and the database features say so clearly on older Node.
  - Resume fixes: revisions and rebuilds pick unused folder and file names (`edit-x2`, `render-x2`, `production.graphics.r3.json`), so continuing after an interruption never collides with a half-written folder.
- **Storyboard craft** (new `storyboard-craft.md` reference, adapted from the MIT `ai-video-storyboard-skill`): intake (subject, tone, call to action, constraints), cadence by format, story arcs, a shared visual theme written first, an extended beat card with purpose labels and audio direction, an optional anatomy for prompts to generate B-roll with AI video tools, a post-production checklist and the "why this works" rationale. Made real in the planner: `--cta "..."` (also a field in the studio wizard) adds a closing title card in the user's exact words; every graphic gets a beat label (Hook, Setup, Explain, Proof, Emphasis, Recap, CTA); `STORYBOARD.md` opens with the Visual theme and Story arc; the reviewer notes a long video with nothing in its last 20 s (`sb-closing-beat`). The editor, animator and stage-reviewer agents and the `original-edit-planning` skill point to it.
- Fixes found by running the studio on a real clip: a graphic planned near the end of a video could run past it and fail the whole run (the planner now shrinks or drops it, and the cutaway-to-panel fix respects the end); a failing render review rebuilt into the same `render-r2` folder twice (the version counter was on a copy of the loop context); and caption speed/length findings, which a rebuild cannot fix, are now notes (only overlapping captions block).
- Real-run fixes: vertical and square cutdowns drop pull-text strips (captions already carry the words; they clipped in a narrow frame), the readability audit now catches vertical clipping, and YOUTUBE.md descriptions start on a sentence start.

- **3D and animation libraries** (`src/libs.js`, `video-monk libs`, `<vm-lib>` / `<vm-asset>` in custom graphics): three.js, GSAP, anime.js, Lottie, Motion, Rive, Babylon.js, PlayCanvas and A-Frame, downloaded on request (`libs --add <name> --allow-download`), checked against the npm registry's SHA-512 hash, kept in `~/.video-monk/libs/` with their licence, and inlined so rendering stays offline (three.js through an import map of data URLs; WebGL2 works in the headless Chrome). Nothing is bundled. Researched and not added, with reasons and the supported route: react-three-fiber, react-spring, Spline, Blender, Substance, WebXR. Nine working starters in `assets/motion-starters/` (Rive's is untested: it needs a `.riv` file). Reference: `3d-and-animation-libraries.md`.
- **Ten effect templates** (`src/motion/effects.js`): `chart-morph`, `search-results`, `card-workspace`, `button-player`, `tabs-panels`, `spring-stack`, `glass-focus`, `particle-text`, `perspective-layers` and `dock`; each has a props schema and was checked from rendered stills. `chart-morph` takes `illustrative: true` to print an "Illustrative" label.
- **`motion-video` command** (`src/motionvideo.js`): a standalone launch, explainer, chart, milestone, opener or promo piece from a brief of beats. Enforces beat count and a 3 s hold on the last beat, runs the facts-first check (numbers on screen need a sourced fact list), writes a graphic-scene `production.json` with varied transitions, licensed music and subtle SFX. It builds and approves nothing: review, `production-review --approve-plan`, `production-build`. `--check` and `--types` too.
- **apple-design adaptation** (`apple-motion-audit.md`, MIT, with credit to Emil Kowalski) and a **donor components** workflow for gallery components such as 21st.dev (nothing bundled; the user copies and licence-checks).
- **Motion studio in the web app** (`video-monk ui`, `src/ui/motion.js`, `web/js/views/motion.js`): a new page with three tabs. Templates and effects: preview any built-in template at any moment, in the night or paper theme, with editable props. Standalone video: build a brief from beats, check it, and write the plan to a new folder (it builds and approves nothing; the next commands are shown to copy). Libraries and 3D: install or remove each library only after a confirmation, preview the starters, and read why five were not included.
- **3D and library scenes in standalone videos:** a `motion-video` beat can be a starter (`"starter": "three-showcase"`, optional `"assets"` for your own files). The scene is copied into the plan's `scenes/` folder, its libraries are checked and recorded in the new `PLAN.md` and the manifest notes, and a missing library stops the plan with the install command (nothing downloads on its own). The Motion studio's beat menu offers the same, and its check reports missing libraries. A three.js beat was built end to end into `final.mp4`. Every built-in template now has a valid example, so no template opens on an empty form (the lower-third preview asked for a name).
- **Scene seams** (`scene-seams.md`, adapted in original words from the Apache-2.0 HyperFrames motion doctrine, credited): `motion-video` seams now keep one direction of travel (`"current": "left"` by default, or right, up, down) instead of cycling directions, and the brief check warns about opposite neighbouring transitions. The HyperFrames agent skills (`npx skills add heygen-com/hyperframes`) were reviewed and deliberately not installed: they direct agents to the network, HeyGen sign-in and paid generation, and a second project layout, which conflicts with this toolkit's offline, approval-gated pipeline. `tool-setup.md` explains how to add them yourself in a separate folder if you want them.
- **HyperFrames catalog captured** (`assets/hyperframes-catalog.json`, `hyperframes-catalog.md`, Motion studio > Catalog tab): all 448 catalog items inventoried by reading the open-source registry (nothing was run): group, what each needs (GSAP, three.js, WebGPU, fonts), status (358 portable in principle, 27 already built in, 39 need WebGPU, 24 skipped as brand imitations or niche) and a 39-item build-next list led by auto-zoom on screen recordings, caption styles, lower-third looks, hand-drawn annotations, code diff and morph, backgrounds and 3D pieces. Portability is from reading and is untested.
- **Catalog import** (`src/catalog.js`, `video-monk motion-catalog`, Motion studio Catalog tab, `"catalog"` beats in `motion-video`): a standalone HyperFrames block can be imported once (fixed commit, github.com only, explicit `--allow-download`) and played offline: GSAP comes from the library vault, Google Fonts are embedded (latin), and a bridge supplies `__hyperframes.getVariables()`/`assetUrl()` and `__seek(t)`. Blocks that cannot run offline (video/audio, nested compositions, run-time fetches, WebGPU, other libraries, remote images) are refused with the reason. Overlay blocks get a transparent page. Tested end to end on real blocks (`lt-clean-bar`, `data-chart`: import, plan, draft build). The Apache-2.0 header is kept and listed in PLAN.md. The vault's GSAP now also offers the CustomEase plugin.
- Search and lookup agents (`video-monk-chrome-researcher`, `video-monk-asset-librarian`) now run on `model: sonnet`.

### Limits
No HDR to SDR conversion (warning only). The highlight picker is a heuristic proposal, not a judgement of what is interesting. Graphics laid out for landscape can be tight in 9:16; the readability audit reports where.

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
