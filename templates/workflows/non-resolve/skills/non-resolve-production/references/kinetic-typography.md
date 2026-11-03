# Kinetic typography in the motion templates

All on-screen text (captions, titles, pull-text, definitions, bullets) follows modern kinetic-type
practice: a strong sans for the line, a different **stress face** for the words that carry the
point, reveals that move glyphs without blurring the whole line, and timing that follows speech.
Rules adapted from the kinetic-typography skill by iart.ai (MIT); see
THIRD_PARTY_NOTICES.md in the video-monk package.

## Fonts (bundled, SIL OFL, no downloads)

- **Sans:** Geist Variable (weight 100-900). Headlines weight 800, tracking -0.025em, line-height 1.05-1.1.
- **Stress face:** Instrument Serif Italic, 1.16em, accent colour. Used for stressed words only.
- **Mono:** Geist Mono for the `code` template.
- Override the sans with `theme.font` (.ttf/.otf/.woff/.woff2). The stress face is always Instrument Serif.

## Stress

- In any headline-style prop, wrap the key words in asterisks: `"Caching in *60 seconds*"`.
  Wrap whole whitespace-delimited tokens with punctuation inside: `*caching.*`. Use 1-2 words per line.
- Captions pick stress automatically (`src/stress.js`): numbers, acronyms, proper terms, intensifiers
  (never, always, key...), long words, words the speaker lingers on, words around pauses. About one word
  per seven. A transcript word may carry `"stress": true/false` to override.
- Caption style `kinetic` (default): bold sans, the word being spoken in the accent colour with a small pop,
  stressed words in italic serif. Other styles: `karaoke` (highlight pill), `phrase` (dark plate), `plain`.

## Reveal rules

| Granularity | Use | Timing |
|---|---|---|
| Line / block | calmest, premium: paragraphs, definitions | 60-100 ms stagger |
| Word | energetic: titles, pull-text, captions | 40-70 ms stagger |
| Character | very short strings only | 20-40 ms stagger |

- Words rise from a hidden baseline inside an `overflow:hidden` mask (the most robust reveal).
  Stressed words also focus-pull (blur to sharp) so they read as the beat.
- Ease-out expo for enters (`cubic-bezier(0.16, 1, 0.3, 1)`), 400-600 ms per fragment, whole reveal about
  800 ms; long strings switch to word or line granularity.
- `kinetic-text` options: `reveal: mask | blur | pop`, `mode: build | sequence`, `cues` (the spoken time of
  each word, so every word lands on its audio).
- Static type first: tight tracking on display text, no motion that fights legibility, text stays on screen
  long enough to read (about 0.3 s per word).

## Themes

`theme.preset`: `night` (dark, cyan accent) or `paper` (warm gray canvas, black ink, orange accent, after the
motion-graphics skill defaults). `auto` mode chooses `paper` for bright footage (slides, documents) and
`night` for dark footage. Override any token: `theme: { "preset": "paper", "accent": "#2f6fed" }`.

## Banned

Bouncy easing on UI text, particle bursts, glows, gradients on UI chrome, mixed icon strokes, dead time,
anything that restates the caption word for word, invented data.

## Top bar and captions must not say the same thing

A pull-text strip at the top that repeats the words the burned-in captions show at that moment makes the viewer read the line twice. The planner does not draw a strip when at least 60% of its words are in the captions at that time, and the storyboard reviewer flags any that remain (`sb-caption-duplicate`, fix: drop it). Keep a top-bar strip only if it adds something the captions do not: a shorter key phrase, a different wording of the point, or when captions are off. If you want the emphasis, stress the words in the captions instead (they already render stressed words in italic serif).
