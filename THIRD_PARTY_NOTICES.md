# Third-party notices

Video Monk is MIT licensed (see LICENSE). It includes fonts and builds on ideas from the projects below.

## Bundled fonts (SIL Open Font License 1.1)

Files live in `assets/fonts/`; each license text is included next to the fonts and must travel with them.

| Font | Files | Copyright | License text |
|---|---|---|---|
| Geist, Geist Mono | `Geist-Variable.woff2`, `GeistMono-Medium.woff2` | Copyright (c) 2023 Vercel, in collaboration with basement.studio | `assets/fonts/OFL-Geist.txt` |
| Instrument Serif Italic | `InstrumentSerif-Italic.ttf` | Copyright 2022 The Instrument Serif Project Authors (https://github.com/Instrument/instrument-serif) | `assets/fonts/OFL-InstrumentSerif.txt` |

The Geist files were taken from the `motion-broll` skill folder of Barty-Bart/motion-graphics (below), which
bundles them under the same license. The fonts are unmodified and are not sold on their own.

## Ideas and methods (no source code copied)

- **kinetic-typography-skills** by iart.ai, MIT License, Copyright (c) 2026 iart.ai.
  https://github.com/iart-ai/kinetic-typography-skills
  Informed the text engine: reveal granularity (line / word / character), mask reveals, ease-out expo easing,
  stagger and duration ranges, tight display tracking, and weight/typeface treatment of emphasised words.
  See `templates/workflows/non-resolve/skills/non-resolve-production/references/kinetic-typography.md`.
- **motion-graphics** (`motion-broll` and related skills) by Barty-Bart, MIT License, Copyright (c) 2026 Bart.
  https://github.com/Barty-Bart/motion-graphics
  Informed the explainer planner: density levels, choosing a full-frame cutaway, side panel or nothing per
  idea, graphics timed to spoken words, minimum face time between cutaways, the "never invent numbers" rule,
  the interaction vocabulary, and the `paper` theme palette (warm gray, black ink, one orange accent).
  See `.../references/explainer-graphics.md`. Video Monk does not use that project's Python or Playwright engine.
- **apple-design** by Emil Kowalski, MIT License, Copyright (c) 2026 Emil Kowalski (https://github.com/emilkowalski, part of his skills repository).
  Adapted: the springs, spatial-consistency, depth and materials, typography and restraint ideas, rewritten in original words and
  mapped to video in `.../motion-graphics-studio/references/apple-motion-audit.md`. The interactive-interface parts (gestures, drag, haptics) are not used.
  Its own source is Apple's WWDC talk *Designing Fluid Interfaces*; no Apple text is reproduced.
- **ElevenLabs** (https://elevenlabs.io): the `short` command and Shorts in the web studio call the ElevenLabs text-to-speech API with the user's own API key and account. No ElevenLabs code, voice or audio is bundled; generated narration is subject to the user's ElevenLabs plan and its terms (https://elevenlabs.io/terms-of-use): commercial use of the audio needs a paid plan. That note is written into the production credits of every short.
- **HyperFrames** by HeyGen, Inc., Apache License 2.0, Copyright 2026 HeyGen, Inc. https://github.com/heygen-com/hyperframes
  Read as reference only. The motion doctrine (one direction of travel, matched exits and entries, carriers, cause before effect, no idle wobble, stillness before the peak)
  informed `.../motion-graphics-studio/references/scene-seams.md` and the single-direction default of `motion-video` seams, rewritten in original words;
  no HyperFrames code is copied or redistributed by this package, and its skills are not installed or bundled. `video-monk motion-catalog --import` downloads a single catalog block at the user's request (a fixed commit, github.com only), keeps its Apache-2.0 header and author, and stores it on the user's own computer; a video that uses it carries that notice in its plan. `assets/hyperframes-catalog.json` is an inventory of its public catalog (item names, titles, tags, short descriptions, links and our own status notes), captured by reading its registry (commit 47ddded) and credited to HeyGen, Inc. under Apache-2.0; 36 listed items use shaders.com shaders (MIT) and two use OFL-1.1 fonts, as stated per item. No catalog item was run or bundled. Video Monk can still call an installed `hyperframes` CLI (`animate`, `transcribe --engine parakeet`).
- **3D and animation libraries are not bundled.** `video-monk libs --add <name> --allow-download` downloads a package once, at the user's request, from
  registry.npmjs.org, checks it against the registry's SHA-512 hash and stores it in the user's own `~/.video-monk/libs/` with its licence. Nothing below is
  copied into this package or redistributed by it; each keeps its own licence: three.js (MIT), anime.js (MIT), lottie-web (MIT), Motion (MIT),
  Rive `@rive-app/canvas` (MIT), PlayCanvas (MIT), A-Frame (MIT), Babylon.js (Apache-2.0) and GSAP (the GSAP "Standard no charge" licence,
  https://gsap.com/standard-license: free to use but not open source, which is why it is only downloaded by the user). The starters in `assets/motion-starters/` are our own code.
- **21st.dev** and other component galleries: nothing from them is included or fetched. Their terms restrict redistribution and automated copying, and each component has its
  own author's licence. `.../references/donor-components.md` only describes how a user can rebuild an idea they have licence-checked themselves.
- **awesome-opus-5-5-video-prompts** by Leadde Open Lab. https://github.com/LeaddeOpenLab/awesome-opus-5-5-video-prompts
  The collection states that its prompts belong to their individual authors and that no license applies to
  them, so no prompt text is reproduced or redistributed. Only general craft lessons about how effective
  motion-graphics briefs are structured were used, rewritten in original words in
  `.../references/graphic-briefs.md` and in the brief that `--engine claude` sends.

- **awesome-claude-video-skills** by zhuyansen. https://github.com/zhuyansen/awesome-claude-video-skills
  The list itself is dedicated to the public domain (CC0 1.0); each listed project keeps its own license. Used to survey how existing
  video-editing skills work. Ideas only, no code or text copied, restated in `.../original-edit-planning/references/editing-craft.md`:
  staged approval gates (jtxvideo-skill, MIT), understand the footage and look at your own cut (smart-video-editor, MIT; SeeCut),
  audio-measured tightening with tone presets, preserving laughs and pauses, and checking cut timing (cut-video, MIT), and the community
  test's basic render checks (plays, length and size, copy readable, picture moves).
- **ByteMonk** study notes are user-supplied, unverified reports; the `bytemonk` style profile is a provisional creative direction
  derived from them (see `.../references/style-bytemonk.md`), not a verified description of the channel. No ByteMonk wording, branding,
  sponsor material or footage is included.

## Production-quality practices

Delivery, voice and caption practices were informed by `appariciojunior/video-editor-skills` (MIT), `digitalsamba/claude-code-video-toolkit` (MIT) and
`zhuyansen/awesome-claude-video-skills`. They were read as references only; no code or prompt text was copied.

## Storyboard craft

The storyboard craft reference adapts ideas from `aicontentskills/ai-video-storyboard-skill` (MIT): the brief intake, cadence by platform and length, story-arc patterns, the shared visual-consistency layer, the per-beat structure with audio direction, the prompt anatomy for generated clips, and the closing "why this works" rationale. Its text and example are not copied; the reference is written for real footage with graphics, B-roll and sound, in original wording. (The upstream `SKILL.md` lists four reference files that its repository does not contain.)

## Reviewed, not adopted

`Sousastep/sousa_fx_generator` (audio effect processors for Max/RNBO; no licence file found, bundles ports of other projects) and the
"Sound Effects Expert" skill listed on mcpmarket.com (guidance for external AI sound-effect services; licence not shown on the listing)
were reviewed as references. No code or text from either is used; the toolkit's sound effects are its own FFmpeg synthesis.

## Services (opt-in)

Mirelo (mirelo.ai) text-to-sound-effect API: used only with `--allow-mirelo` and your own `MIRELO_API_KEY`. The prompt is sent to Mirelo and credits are spent under your account.
Mirelo's terms apply (free plan non-commercial use; paid plan for commercial release). No Mirelo code or branding is bundled. Generated files are recorded in the asset library with that note.

Pixabay API (pixabay.com/api/docs): used only with `--allow-search` and your own `PIXABAY_API_KEY`; the query is sent to Pixabay. Downloaded files stay under the Pixabay Content License
(https://pixabay.com/service/license-summary/), which the toolkit records per file with the creator and source page. Responses are cached for 24 hours as the API terms require.

Unsplash API (unsplash.com/documentation): used only with `--allow-search` and your own `UNSPLASH_ACCESS_KEY`; the query is sent to Unsplash and each chosen photo is reported through its
download endpoint, as the API terms require. Photos stay under the Unsplash License (https://unsplash.com/license); the photographer and Unsplash are credited with utm links. Unsplash has no video endpoint.

## Dev and runtime tools (not bundled)

FFmpeg, Google Chrome / Chromium, whisper.cpp and its models, and the Claude Code CLI are separate programs under
their own licenses and terms. Video Monk invokes them but does not redistribute them.
