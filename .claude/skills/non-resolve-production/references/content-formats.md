# Settle the format before editing

A landscape long-form edit and a vertical Short are different products: different frame, pace, caption size, graphics layout and length.
**Never start `auto` or `autocut` until the format is settled.** If the user's request does not already say it, ask.

## How to ask

Run `video-monk brief --questions` to get the question set as JSON, then ask with the AskUserQuestion tool (one call, up to four
questions at a time, "Other" is always available). Ask in this order and skip what the user already told you:

1. **Format** (`deliverable`): long-form 16:9 / short-form 9:16 / long-form plus a vertical short / square or 4:5 feed post.
2. **Footage** (`content`): talking head / screen recording / explainer with slides / interview. This sets sensible pace and graphics defaults.
3. Only if vertical or square is involved:
   - **Framing** (`vertical`): `blur` (whole picture over a blurred background, best for screens and slides), `cover` (centre crop, best for a
     centred talking head), `contain`.
   - **Short length** (`shortLength`): 30 s / under 60 s / 90 s / the whole video. Shorts allow up to 3 minutes, under 60 s performs best.
   - **Which part** (`shortPick`): the opening / the strongest moment (you propose it from the transcript and the user approves the time range) / a range the user gives.
4. **Pace**, **graphics density**, **captions** (animated, plain, file only) and **destination** (YouTube/social, web, archive master). Offer the
   defaults the brief suggests for the footage type and only ask when the user wants to override.

Write the answers to a file and resolve them:

```
video-monk brief --answers answers.json --output brief.json
video-monk auto --brief brief.json --media <recording> --output <new folder> --transcribe --allow-render --approve-plan --rights-confirmed
```

## What each answer does

| Answer | Result |
|---|---|
| long | landscape 1920x1080 edit, `render/final.mp4` |
| short | the edit is made vertical 1080x1920 from the start (graphics planned for the vertical frame), fit `blur` or `cover` |
| both | landscape edit first; then `video-monk cutdown` takes the chosen part of the approved edit into 9:16 and renders `short/final.mp4` with the same cuts, captions and graphics |
| feed | 1080x1080 (or 4:5 with `cutdown --aspect 4:5`) |

For "the strongest moment", read the transcript, choose a self-contained 20-60 s stretch that opens on a hook and ends on a full sentence,
tell the user the time range and why, and only then run `video-monk cutdown --manifest <final manifest> --output <name.json> --aspect 9:16 --from <s> --to <s>`
(or `--highlight --max-seconds 55` for a rules-based proposal that the user must still approve).

## After rendering a vertical cut

Graphics laid out for landscape can be tight in 9:16. The render reviewer runs a layout audit (text off the frame, clipped, too small, low
contrast) and reports it under `graphicAudit` in `report.json` and as findings; fix those before delivering. Watch the whole vertical video:
captions sit above the platform's bottom UI zone, and faces must not be hidden by panels.
