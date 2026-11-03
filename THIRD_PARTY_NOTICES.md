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

## Reviewed, not adopted

`Sousastep/sousa_fx_generator` (audio effect processors for Max/RNBO; no licence file found, bundles ports of other projects) and the
"Sound Effects Expert" skill listed on mcpmarket.com (guidance for external AI sound-effect services; licence not shown on the listing)
were reviewed as references. No code or text from either is used; the toolkit's sound effects are its own FFmpeg synthesis.

## Services (opt-in)

Mirelo (mirelo.ai) text-to-sound-effect API: used only with `--allow-mirelo` and your own `MIRELO_API_KEY`. The prompt is sent to Mirelo and credits are spent under your account.
Mirelo's terms apply (free plan non-commercial use; paid plan for commercial release). No Mirelo code or branding is bundled. Generated files are recorded in the asset library with that note.

## Dev and runtime tools (not bundled)

FFmpeg, Google Chrome / Chromium, whisper.cpp and its models, and the Claude Code CLI are separate programs under
their own licenses and terms. Video Monk invokes them but does not redistribute them.
