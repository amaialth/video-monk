# Donor components: turning a component you like into a seekable graphic

Sometimes the best starting point is a component on a gallery site, such as a 21st.dev card, a pricing table or an animated button. This is the workflow for using one **legitimately**.

**Nothing from 21st.dev, or from any component gallery, is bundled with this toolkit, and the toolkit never scrapes one.** 21st.dev's terms restrict redistribution and automated copying, and each component there carries its own author's licence. So the toolkit ships the workflow, not the components. You choose the component, you check its licence, and you do the copying yourself.

## Steps

1. **You pick the component and check its licence.** Open it, find the licence or the author's terms, and confirm they allow what you plan to do (use in a video, modifications). If it is unclear, ask the author or pick another. Never pass on a component you cannot use, and do not paste one into a shared project unless its licence allows redistribution.
2. **Copy it yourself** (from the site's copy button) into a scratch file outside the repo. Do not ask the assistant to download it.
3. **Treat it as a reference, not as code to run.** These are usually React with Tailwind and a UI kit. The renderer has no React, no build step and no network, so it will not run as is.
4. **Rebuild it as one seekable HTML page** (the [custom HTML contract](./effects.md)): plain HTML and CSS, the same structure and proportions, your own words, your brand colours and fonts from `MOTION.md`. Replace the component's own animation with `window.__seek(t)`: every position, opacity and scale is computed from `t`.
5. If it needs motion beyond CSS, use a vault library (`libs --add gsap|animejs|motion --allow-download`) with the clock turned off, as in the starters.
6. **Check the likeness.** Rebuilding is for the structure and the feel, not a copy of someone's exact design. Change the layout, copy, icons and palette until it is yours. A pixel-for-pixel clone of another author's component is still their work.
7. Render a still (`video-monk graphic --html x.html --output x.png --at 2`), look at it, then use it as a graphic scene or a `motion-video` beat.
8. Keep a line in your project notes: where the idea came from, the licence you checked, and what you changed.

## What not to do

- Do not paste the donor's source into a published repo, or into a template this toolkit ships.
- Do not use a brand's logo or product UI as a donor unless you own it or have permission.
- Do not run a donor's install scripts or open its dev server just to look at it. A screenshot is enough for a reference.

## When a built-in template already does it

Check `video-monk templates` first. The ten effect templates (`chart-morph`, `search-results`, `card-workspace`, `button-player`, `tabs-panels`, `spring-stack`, `glass-focus`, `particle-text`, `perspective-layers`, `dock`) plus `comparison`, `flow`, `steps`, `kinetic-text` and the rest cover most component ideas, themed and deterministic.
