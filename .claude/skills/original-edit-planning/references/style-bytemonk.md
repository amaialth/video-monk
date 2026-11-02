# House style: ByteMonk-inspired (provisional)

Status: **creative direction, not a verified description of the channel.** It comes from the "approved provisional design direction" in the
[study index](../../channel-editing-study/references/study-index.md), which rests on twelve user-supplied, unverified pilot reports. The user
approved it as the style every video should follow. Never copy the channel's wording, branding, sponsor material, thumbnails or exact timings.

`video-monk auto|storyboard|autocut --style bytemonk` (the default; `--style plain` turns it off) applies it:

| Aspect | What the profile does |
|---|---|
| Canvas | `night` theme with a dark neutral background (#0d0f14) and rounded surface cards; one reusable card vocabulary |
| Color | cyan accent plus a semantic palette (warm, green, blue, violet...). Pair color with icons or text; never color alone |
| Motion | `calm`: expo-out easing, no overshoot; nodes, edges and steps reveal as the narration names them; no gratuitous transitions |
| Graphics | diagrams first: flow, steps, comparison, term, chapter and table are boosted; pull-text is capped at 25% of graphics |
| Honesty | flow, steps and comparison cards carry "Conceptual schematic"; no invented numbers; charts need data, units and sources |
| Pace | `tight` (measured noise floor); no fixed cutting formula: hold each idea until it is understood |
| Audio | narration first; a restrained licensed ambient bed ducked 14 dB under speech; sparse UI cues only at meaningful state changes |
| Structure | concrete question or stake first; mechanism built progressively; comparisons on a consistent layout; implications kept separate; recap that rebuilds the mental model; a practical next step |

Structures that recur in the reports (choose by teaching goal): problem → causal loop → constraints → trade-offs; mechanism →
architecture comparison → implications; analogy → mechanism → workload comparison → roadmap; contradiction → bounded analogy →
execution walkthrough → options; syllabus → concept/code → result checkpoints → labs → recap; series recap → journey → taxonomy → matrix.

Overrides: a manifest's own `theme` tokens win over the profile; `--theme paper` or `--density heavy` are explicit choices.
