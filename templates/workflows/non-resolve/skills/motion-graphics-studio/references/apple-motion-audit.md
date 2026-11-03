# Apple-style motion audit

A checklist for motion that feels physical and calm: springs instead of fixed easings, depth instead of flat boxes, type that is set with care, and layouts where every move has a reason.
It is adapted from the MIT-licensed `apple-design` skill by Emil Kowalski (itself distilled from Apple's WWDC talk *Designing Fluid Interfaces*); the wording and the video-specific mapping here are our own. See THIRD_PARTY_NOTICES.md.

Video is not an interface: nobody touches it, so most of that skill (gestures, drag, rubber-banding, interruption, haptics) does not apply. What carries over is the **feel**. Use this as an audit on a piece that looks right but feels stiff or cheap.

## 1. Springs, not stopwatch easing

- Things that arrive from somewhere should settle like a physical object: fast start, soft landing. In the toolkit, `spring-stack` and the `back`/`expo` easings do this.
- **Small overshoot or none.** A card that settles with one small overshoot reads as alive; three bounces read as a toy. For a serious or calm brief, `theme.calm: true` turns overshoot off everywhere.
- **Bounce only when something caused it** (a drop, a flick). Things that simply appear do not bounce.
- One spring character per piece. Mixing a snappy spring with a floaty one reads as two different products.
- Vary the delay, not the physics: stagger by a beat (0.06-0.14 s), so a row cascades instead of sliding as one slab.

## 2. Spatial consistency

- **Things leave the way they came.** If a panel slides in from the right, it exits to the right. A move that ends somewhere unrelated to where it began breaks the viewer's map of the screen.
- **Anchor the transform origin** where the element is attached: a card that grows from a button grows from the button, not from its own centre (`card-workspace`, `button-player`).
- Keep the direction of travel consistent across beats (all forward moves go the same way).
- A faint ghost of the start state helps the eye follow a morph.

## 3. Materials and depth

- Depth says what matters: the focused thing is sharp, bright and slightly larger; the rest is dimmer and softly blurred (`glass-focus`).
- Translucent surfaces need something behind them to be translucent over. A glass panel on a flat colour is just a grey box.
- **Shadows explain height.** Larger and softer when higher; one light direction for the whole piece.
- Keep blur small (a few pixels) and shadows quiet. Heavy blur and hard black shadows are the first sign of "template".
- Use perspective for real depth only (`perspective-layers`); a slight tilt on a flat card is decoration.

## 4. Type

- **Tracking follows size.** Large display type is set tighter (about -2% to -3%); small type and all-caps labels are opened up (+6% to +18%). The toolkit's `title` and `kicker` already do this.
- Leading shrinks as size grows: about 1.05 for a big headline, 1.4-1.5 for body.
- Weight contrast beats size contrast: a heavy headline over a regular subtitle at two-thirds the size.
- One typeface, two or three weights. A second family only for a stressed word.
- Numbers that animate use tabular figures so they do not jitter as digits change.

## 5. Restraint

- **One thing moves at a time**, or one group moving together with a clear lead. If the eye does not know where to look, nothing is moving well.
- Every move answers a question: where did that come from, what changed, what matters now. If you cannot say, cut it.
- Hold the finished frame long enough to read. A move is not the point; the held result is.
- Motion that is just "extra" (a wobble on a static logo, a glow that pulses) is the tell of a first draft.
- Feedback and sound are one gesture: a quiet hit on each new beat, not a sound on everything (`--sfx subtle`).

## 6. Craft details that people feel

- Equal gaps, equal card sizes, shared baselines. A lopsided grid reads as a mistake.
- Optical alignment: a play triangle sits slightly right of centre to look centred; round shapes sit a hair larger than square ones.
- Corner radii that nest: an inner radius is the outer radius minus the padding.
- Edge-to-edge consistency: the same margin everywhere (MOTION.md sets it).
- Respect reduced motion in anything interactive you ship alongside the video: provide a still or a calm variant.

## How to run the audit

1. Render a still at the held frame and a short clip (`video-monk graphic ... --output x.mp4`).
2. Go through sections 1-6 and write down the failures in order of how visible they are.
3. Fix **one** at a time and look again. Keep the first version.
4. Stop when the held frame reads at once and the move has one clear lead.
