---
name: motion-graphics-studio
description: 'Use when making motion graphics as code: a branded motion style (MOTION.md), a motion brief, premium effects, standalone launch/explainer/chart/milestone/opener pieces, vertical reels, polish passes and facts-first checks; also for tuning how graphics on a recording look and move.'
---

# Motion graphics studio

Craft for every graphic the toolkit draws, whether it sits on a recording (the `storyboard` step) or is the whole video (graphic scenes in a version-2 manifest).
Adapted from the MIT-licensed [motion-graphics-skills](https://github.com/charlie947/motion-graphics-skills) pack by Charlie Hills, rewritten for this toolkit; see THIRD_PARTY_NOTICES.md.
Everything the toolkit renders is already code: templates are pure functions of time (`seek(t)`), drawn by headless Chrome, frame exact. Custom pieces follow the same contract
([timeline reference](../non-resolve-production/references/timeline-v2.md): `window.__seek(t)`, `window.__vmReady = true`).

## Which job is it?

| The user wants | Do this |
|---|---|
| Graphics on a recording | `storyboard` (automatic in `auto`); craft rules below and [storyboard craft](../original-edit-planning/references/storyboard-craft.md) |
| Their brand in every graphic | [brand and MOTION.md](./references/brand-motion.md): `video-monk brand`, then `--brand brand.json` |
| A precise brief before building | [motion brief](./references/motion-brief.md): the 8-part brief and the reference breakdown |
| A premium effect (button to player, chart morph, masked type, particle logo) | [effects catalog](./references/effects.md): a built-in template, or a custom seekable HTML piece |
| A whole standalone piece (launch film, explainer, animated chart, milestone, opener, promo, loop cover, reel) | `video-monk motion-video --brief brief.json --output dir`, see [standalone motion](./references/standalone-motion.md) |
| 3D, a model, a Lottie file, a library timeline (three.js, GSAP, anime.js, Motion, Lottie, Babylon, PlayCanvas, Rive) | [3D and animation libraries](./references/3d-and-animation-libraries.md): `video-monk libs --add <name> --allow-download`, then a starter from `assets/motion-starters/` |
| Make it feel physical and calm (springs, depth, type, restraint) | [Apple-style motion audit](./references/apple-motion-audit.md) |
| A component from a gallery (21st.dev and similar) | [donor components](./references/donor-components.md): the copy is yours to make and license-check; nothing is bundled |
| Beats that feel like separate slides (seams, direction of travel) | [scene seams](./references/scene-seams.md): one current, matched exits and entries, `"current"` in the brief |
| "It feels cheap" | [polish](./references/polish.md): ranked audit, one fix at a time |

## Always

1. **Read `MOTION.md` first if the project has one.** If not, run the brand intake or ask for hex codes, a font and a logo. Never call a result on-brand without them.
2. **Follow the [house rules](./references/house-rules.md)**: facts first, banned defaults, the first three seconds, sound, real assets, check before export.
3. **Look at your own frames before showing anyone:** `video-monk graphic ... --output x.png` for a still, the contact sheet and `report.graphicAudit` after a build; fix what is real, then show.
4. **Graphics with no transcript behind them** (a script, a launch brief): write the fact list with sources, get a yes, and gate the build with `video-monk facts-check`.
5. Ask for the real content (words, numbers, files) before building; sample numbers carry a visible "illustrative" label.

## Toolkit hooks

- `video-monk brand`: writes `brand.json` and a `MOTION.md` with `ASK ME` where nothing was given.
- `theme.onTwos` (manifest theme, or in `brand.json`): hold every pose for two frames, the stepped hand-made look. `theme.calm`: no overshoot. `--style bytemonk`: calm, diagram-first.
- `video-monk facts-check --manifest M --facts facts.json`: every number on screen is in the approved, sourced list.
- `video-monk cutdown --aspect 9:16` and `--fit blur`: reels from any horizontal piece. Vertical captions and lower thirds already sit above the bottom ~26% that the apps cover.
- `video-monk motion-video --brief B --output DIR [--facts F]`: a standalone piece from beats; checks beat count, last-beat hold, facts and writes the manifest.
- `video-monk libs --add three|gsap|animejs|lottie-web|motion|rive|babylonjs|playcanvas|aframe --allow-download`: opt-in, integrity-checked, never bundled. `<vm-lib>` and `<vm-asset>` in a custom graphic.
- `video-monk graphic --template T --props P --output x.png|.mp4|.mov`: one graphic for review or reuse (the asset library caches every render).
