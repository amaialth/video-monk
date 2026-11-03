# Version-2 production timeline

`production.json` with `"version": 2` drives the automated renderer. All paths are
relative to the manifest. Unknown fields are rejected. Times are seconds and must
align to the timeline frame rate (millisecond rounding is accepted). Example:
[production-v2.example.json](./production-v2.example.json).

## Top level

| Field | Required | Notes |
|---|---|---|
| `version` | yes | `2` |
| `title` | yes | 1-120 chars; embedded as file metadata |
| `fps` | yes | 24, 25, 30, 50 or 60 |
| `width`, `height` | yes | even, 180-3840 (1920x1080, 1080x1920, 1080x1080...) |
| `theme` | no | `background surface text muted accent` (#RRGGBB), `palette` (2-10 colors), `font` (.ttf/.otf/.woff2 path) |
| `assets` | yes | `{id, path, kind: video\|image\|audio, approved: true, rights, attribution, sourceUrl?}` |
| `scenes` | yes | ordered list, see below |
| `audio` | no | narration, music beds, SFX, ducking |
| `captions` | no | `{words, style: karaoke\|phrase\|plain, position: bottom\|center\|top, maxWords?, maxChars?, burnIn?}` |
| `globalOverlays` | no | overlays timed on the whole timeline (e.g. `progress-bar`) |
| `delivery` | no | `targetLufs` (-14), `truePeak` (-1), `crf` (18), `preset` (medium), `audioBitrate` (192), `thumbnail: {time} or {template, props}` |

## Scenes

`kind`: `video` (asset + `in`), `image` (asset), `graphic` (full-screen motion
graphic) or `color` (`color: "#RRGGBB"`). Every scene needs `purpose` and
`duration`; optional:

- `id`, `chapter` (YouTube chapter label at this scene's start; chapters.txt)
- `fit`: `cover` (default, crops to fill; reframes landscape to vertical) or `contain`
- `motion`: `{type: zoom-in|zoom-out|pan-left|pan-right|pan-up|pan-down|punch-in|none, amount?: 0.01-0.5}`
  Auto-zoom on a spot: `{type: "focus", points: [{at: seconds from the scene start, x: 0-1, y: 0-1, amount?: 0.1-1 (1 = 2x, default 0.5), hold?: 0-10 s (1.5), ramp?: 0.15-2 s (0.5)}]}`. Each point eases in over `ramp`, is fully zoomed at `at`, holds, and eases out; x and y are fractions of the picture as the viewer sees it. `video-monk focus --clicks clicks.json` places the points from click times in the source recording.
- `audio`: keep the source clip's sound: `{gainDb?, fadeIn?, fadeOut?}` (video scenes)
- `broll`: list of `{asset, in?, start, duration, fit?, motion?}` cutaways (scene-relative)
- `overlays`: list of `{template | html, props, start, duration, placement?, panel?}`
- `graphic` (graphic scenes): `{template | html, props, background?: grid|gradient|plain}`
- `transition` into the next scene: `{type, duration}`; types: fade, fadeblack,
  fadewhite, dissolve, wipeleft/right/up/down, slideleft/right/up/down,
  smoothleft/right/up/down, circleopen, circleclose, radial, pixelize, zoomin,
  distance, hblur, squeezeh, squeezev. Transitions overlap scenes, so total
  duration = sum(scene durations) - sum(transition durations).

Overlay `placement`: full, center, left, right, top, bottom, top-left, top-right,
bottom-left, bottom-right. Boxed placements get a translucent panel. In portrait,
left/right become top/bottom halves. Lower-third, callout and progress-bar always
use the full frame.

## Motion templates

Run `video-monk templates` for every prop. Summary: `title`, `chapter`,
`lower-third`, `kinetic-text`, `bar-chart`, `line-chart`, `donut`, `stat`,
`comparison`, `flow` (architecture diagram with icons and moving packets),
`steps`, `bullets`, `callout` (highlight a region of the shot), `quote`, `code`
(typed, highlighted), `table`, `progress-bar`. Icons: server, database, user,
users, cloud, lock, gear, bolt, check, x, code, globe, phone, cpu, queue, file,
chart, clock, shield, search, mail, key, warning, star, arrow, box, network.

Custom animation: `html` points to a local page that defines `window.__seek(t)`
(pure function of time) and sets `window.__vmReady = true`. It renders offline
(network blocked) in headless Chrome. Review its code before approval.

## Audio

- `narration`: `{asset, gainDb?, start?}`; must end within the timeline (no truncation).
- `music`: list of `{asset, start?, end?, in?, gainDb? (-18), fadeIn? (1), fadeOut? (2), loop? (true)}`.
- `sfx`: list of `{asset, at, gainDb? (-6)}`.
- `ducking`: `{enabled (default true), amountDb? (12)}`: music compresses under voice
  (narration plus scene source audio) via sidechain.
- Mix -> two-pass gain + oversampled limiter -> `stems/master.wav` at the target.

## Captions

`words` is a JSON array `[{text, start, end}]` in **edited-timeline** seconds.
`autocut` writes `words.timeline.json` for you. When you insert scenes before
cut material, shift word times by the inserted duration (minus transitions).

## Outputs (`production-build`)

final.mp4, captions.srt/.vtt, chapters.txt, thumbnail.png, contact-sheet.png,
stems/ (voice, music, sfx, master), timeline.xml (Resolve: scene clips on V1/V2
plus stems), report.json (decode, size, fps, duration, loudness, true peak),
REVIEW.txt and CREDITS.txt. `--quality draft` renders faster for iteration.

## Fit, watermark and captions fixes (0.5.0)

- `fit` on a scene or B-roll: `cover` (crop to fill), `contain` (letterbox) or `blur` (whole picture over a darkened blurred copy of itself; the standard vertical reframe).
- `watermark`: `{ "asset": "<image asset id>", "position": "top-right|top-left|bottom-right|bottom-left", "size": 0.1, "opacity": 0.85, "margin": 0.03, "start": 0, "end": <s> }` places a logo bug for the whole video or a window.
- `captions.fixes`: `{ "replace": { "gpt 4": "GPT-4" }, "drop": ["you know"] }` applied to the caption words.
- `audio.voice.enhance`: `auto` (default), `on` or `off`. `delivery.target`: `youtube`, `web` or `master`.
