# Delivery quality: what is checked and why

`production-build` verifies the real `final.mp4`, not the plan. Technical checks are not a creative review: a person still watches the whole file.

| Area | What the toolkit does | Where to look |
|---|---|---|
| Video encode | x264 High profile, capped CRF with maxrate/bufsize by resolution and fps, 2-second closed GOP, BT.709 tags, `+faststart`. Targets: `youtube` (default), `web`, `master` via `delivery.target` | `delivery.js`, report `verification.checks.colorTags` / `bitrate` |
| Colour | Graphics are PNGs: converted with an explicit RGB to BT.709 matrix so brand colours keep their values. HDR sources are warned about, not converted | `report.warnings` |
| Audio | Two-pass loudness to -14 LUFS / -1 dBTP with the real AAC file re-measured (local gain dips fix overshoot), 320 kb/s AAC | `verification.measured` |
| Voice | Per-recording measurement: high-pass, de-ess, gentle compression always; presence EQ only when the voice is dull; denoise only when the room is noisy; near-silent clips never boosted. `audio.voice.enhance` auto/on/off | `report.voice` |
| Captions | Fragments, fillers and stutters removed; `captions.fixes` for names; pages stay >= 0.9 s; the caption audit flags overlaps, reading speed (> 20 chars/s), long pages and lone words | `captions.srt`, render review findings |
| Graphics | Layout/contrast audit in the render browser: text off the frame or clipped (defect), text under 2.2% of the short side, contrast under 3:1 (advisories) | `report.graphicAudit` |
| Picture | Black frames, frozen picture (>= 4 s, advisory), silence in the final | render review |
| Branding | `watermark` (logo bug) and `--brand brand.json` (theme tokens + logo) | `timeline-v2.md` |
| Publishing | `YOUTUBE.md`: title options, description draft from the transcript, chapters only when YouTube would accept them, credits, tags, upload checklist | render folder |

## brand.json

```json
{ "theme": { "preset": "paper", "accent": "#ff5a1f" },
  "logo": { "path": "logo.png", "position": "top-right", "size": 0.1, "opacity": 0.85 },
  "rights": "Own logo", "attribution": "Studio name" }
```

Pass `--brand brand.json` to `auto` or `autocut`. Paths are relative to the brand file. The logo asset is approved only with `--rights-confirmed`.

## Not verified by tools

Facts and numbers, caption wording, whether a graphic actually explains the point, and the feel of the pacing. Say so in the hand-off.
