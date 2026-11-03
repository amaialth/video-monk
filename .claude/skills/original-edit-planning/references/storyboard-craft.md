# Storyboard craft: plan the whole video before you build any of it

A storyboard is a coordinated plan, not a list of separate good ideas. **Consistency across beats matters more than any one beat being perfect:** a plain set of beats that share a look and a story edits together; six brilliant but mismatched ones do not.
Method adapted from the MIT-licensed [ai-video-storyboard-skill](https://github.com/aicontentskills/ai-video-storyboard-skill) (aicontentskills): its intake, cadence, visual-consistency layer and per-beat structure, rewritten here for real footage with graphics, B-roll and sound. See THIRD_PARTY_NOTICES.md.

## 1. Intake: ask once, accept short answers

Skip what the user already said; confirm the rest in one message.

1. **Format and length**: long-form, vertical short, both, feed (`video-monk brief` asks the format questions).
2. **Subject, audience and the one thing the viewer should take away.**
3. **Tone**: calm, energetic, premium, playful, serious. It decides pacing, theme and music.
4. **Call to action** (optional): the exact words, e.g. "Subscribe for part two". The toolkit puts them on a closing title card (`--cta`); it never writes one for you.
5. **Hard constraints**: logo and brand colours (`--brand`), must-include or must-avoid subjects, rights limits.

## 2. Cadence: how often the picture should change

| Format | Length | Beats | Rhythm |
|---|---|---|---|
| Short hook | 15 s | 3 | a change every 4-5 s, one idea |
| Short / Reel | 30 s | 6 | Hook, build, payoff, CTA |
| Short / Reel | 60 s | 10-12 | Hook, three-act build, CTA |
| Ad | 15-30 s | 3-6 | Hook, problem, product, benefit, proof, CTA |
| Explainer | 5-10 min | a graphic or B-roll every 8-15 s | chapter cards every 60-90 s |
| Screen tutorial | any | sparse | the screen is the content; graphics beside it, B-roll only at the open and close |

The toolkit's graphics density is a budget for this: light 3, medium 6 and heavy 10 a minute. On top of it the speaker must stay visible for most of the video.

## 3. Story arc: choose one and keep to it

- **Hook, build, payoff, CTA** (short-form default): a first second that earns the next ten; context; the point; the ask.
- **Problem, solution, proof, CTA** (ads, product explainers): a relatable problem, your answer, evidence, the ask.
- **Question, mechanism, example, recap, next step** (teaching explainers, the house style): open on a concrete question, build the mechanism progressively, ground it in an example, recap, say what comes next.
- **Atmosphere to climax** (brand story): longer holds, a slow reveal, one emotional peak, the logo last.

Every graphic carries a **beat label** in `STORYBOARD.md`: Hook, Setup, Explain, Proof, Emphasis, Recap or CTA. If a beat has no label from the arc you chose, ask whether it earns its place.

## 4. The visual theme: write it first, apply it to everything

Before planning any beat, fix the shared look. `STORYBOARD.md` now opens with a **Visual theme** block from the planner: palette, type, motion language, caption treatment, house style. Extend it for B-roll:

- **Graphics** (decided by the theme preset and style): palette of 3-5 colours with one accent, one sans plus one italic serif for stress, calm easing, banned effects.
- **B-roll look words**: add the same 2-4 words to every stock search or generation prompt, for example "warm, overhead, shallow depth of field, natural light". Same time of day, same colour temperature, same framing habits.
- **Motion language**: locked-off or slow moves only, or handheld throughout. Never both in one video.
- **Sound**: one music bed character; sound effects stay quiet and few.

A beat that breaks the theme is wrong even if it is good in isolation.

## 5. The beat card

Plan each beat with these fields (the existing beat table, extended):

`beat | time | purpose label | what is said | visual (graphic template, B-roll query, or speaker) | motion | audio (voice, music, SFX cue) | evidence or approval blocker`

Purpose labels: Hook, Setup, Explain, Detail, Proof, Reveal, Recap, CTA. Keep one idea per beat. Request missing assets; never claim a graphic or clip exists when it does not.

## 6. Optional: prompts for B-roll you generate with AI video tools

The toolkit does not call video generators. If the user makes B-roll that way, write each prompt like this, as **model-agnostic** text:

1. **Anatomy** (40-80 words): subject, action, environment, camera, lighting, style, then the technical line: duration (4-8 s), aspect ratio (9:16, 16:9, 1:1) and resolution.
2. **Concrete, never abstract**: not "a woman" but "a barista in her late twenties with wavy auburn hair, denim apron". Say what the camera sees.
3. **The theme's look words in every prompt**: palette, lighting, lens character, film look. This is what makes separately generated clips match.
4. **Cinematography vocabulary**: shot sizes (extreme close-up, close-up, medium, wide), angles (overhead, low, high, over-the-shoulder, point of view), moves (locked off, slow push-in, dolly, tracking, crane, pedestal), lighting (golden hour, rim light, motivated window light, overcast, practical lamps).
5. **No model-specific tricks.** Write plain cinematic prompts that work anywhere.
6. **Rights and honesty**: generated footage is not evidence. Do not depict real people, events, products or results the video makes claims about. Record the tool, its terms and the prompt in the asset ledger (`video-monk assets --add ... --rights ... --approved`) and disclose synthetic footage where the platform asks for it.

## 7. Close with a post-production checklist and the reasoning

```
- [ ] Draft build (production-build --quality draft); read the contact sheet for theme breaks
- [ ] Graphics, B-roll and captions follow the visual theme; one grade across all clips
- [ ] Transitions: dissolves between related beats, hard cuts where the energy shifts
- [ ] Music bed: one character, ducked under speech; SFX quiet (subtle mode)
- [ ] Captions and top bar say different things (no repeated words)
- [ ] Export target for the destination (youtube / web / master); YOUTUBE.md drafted
```

**Why this works**: finish every storyboard with a short rationale for the user: the hook (the first second decides whether they stay), the pacing (matched to how long people dwell on that platform), the arc (why the order matters), the consistency (what ties the beats together) and any platform convention you followed. It lets them overrule a choice knowingly.

## Review questions (stage reviewer)

1. Does the first beat earn the next ten seconds, and does the last beat close the video (recap or the CTA you were given)?
2. Is every beat labelled, and does the arc read in order?
3. Do all graphics, B-roll and sounds share the visual theme?
4. Is anything invented: a number, a quote, a result, a claim the speaker never made?
5. Is the speaker still on screen for most of the video?
