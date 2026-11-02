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

## Dev and runtime tools (not bundled)

FFmpeg, Google Chrome / Chromium, whisper.cpp and its models, and the Claude Code CLI are separate programs under
their own licenses and terms. Video Monk invokes them but does not redistribute them.
