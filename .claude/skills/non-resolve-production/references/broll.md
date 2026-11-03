# B-roll from Pixabay, Unsplash and Pexels

B-roll is picture that covers the speaker while the voice carries on: a place, an object, a process, a metaphor. It is used where a concrete subject is
named and no graphic already explains it. It is not a substitute for the explainer graphics.

## Sources

| Source | Gives | Key | Notes |
|---|---|---|---|
| Pixabay | videos and photos | `PIXABAY_API_KEY` | free, no credit required (we record it anyway); photos only up to 1280 px; 100 requests/min; 24-hour cache |
| Unsplash | **photos only, no video** | `UNSPLASH_ACCESS_KEY` | high-resolution originals (resized to 1920 or 2560 wide), the best photo quality; demo apps get **50 requests an hour** (production 1000), so searches are cached and kept few |
| Pexels | videos | `PEXELS_API_KEY` | credit recorded |

`--provider auto` picks Pixabay (or Pexels) for video and Unsplash for photos when its key is set. Use video for full-frame B-roll and Unsplash photos for stills, panels and slow zooms: `stock-search --provider unsplash --type image`. `broll-fetch --type any` (the default) tries video first and falls back to a photo.

Unsplash rules the toolkit follows for you: photos are fetched from `images.unsplash.com` with the `ixid` parameter kept; Unsplash is told about each chosen photo (the download notification, required by its API terms, and the photo is not saved if that fails); the photographer and Unsplash are credited with profile links carrying `utm_source` and `utm_medium=referral` (set `UNSPLASH_APP_NAME` to your registered app name, default `video-monk`); and a photo already in the library is reused without a second notification. Do not sell unaltered photos; the Unsplash app name must not contain "Unsplash". The secret key (`UNSPLASH_SECRET_KEY`) is not needed for search or download and is never read.

## Planning is a standing step

Every storyboard run writes `<name>.BROLL-PLAN.md` and `.json` beside the manifest (offline, no requests; `--broll off` to skip). It lists the moments where B-roll is needed:
a spoken line that names something a viewer can picture and no graphic is already on screen, plus any stretch longer than the footage type's limit with only the speaker visible
(about 25 s for talking heads and explainers, 40 s for screen recordings and interviews). Each moment has a time, a length, a draft search query, alternatives and a confidence.

The editor **always reads the plan** and decides: keep, refine the query (English, 2-4 words, the thing to show), move or drop each moment. `video-monk broll-plan --manifest production.json --output plan.json`
re-plans after the edit changes (`--density light|medium|heavy`, `--content talking-head|screen|explainer|interview`). Then either run the manual steps below, or execute the whole plan:

1. `video-monk broll-fetch --plan plan.json --manifest production.json --output <new folder> --allow-search --allow-download --rights-confirmed` searches, picks a clip per moment (long enough, wide enough, on-topic, small), downloads it and writes a preview frame `bNN.png` and `placements.json`.
2. **Look at every preview PNG.** Set `"drop": true` in `placements.json` for any clip that is wrong, shows faces, logos or text, or hides the point; change `at` or `duration` if needed.
3. `video-monk broll-apply --manifest production.json --placements <folder>/placements.json --output production.broll.json` places the rest.

`auto --broll fetch` does the planning, fetching and placing inside the pipeline (needs `--allow-search --allow-download --rights-confirmed`); if anything fails it keeps the plan and says why. Still look at the previews before delivering.
Moments are never planned in the first 5 s or last 5 s, over a graphic, or closer than 12 s apart; talking heads get about 2 a minute at most, screen recordings and interviews about 1.

## When to use it

- A concrete subject is spoken and a viewer would like to see it ("data center", "a busy warehouse", "typing at a desk").
- A talking head has gone 20-40 s with no change of picture. One clip of 3-8 s, not a collage.
- Not over: an explanatory graphic or panel, the line that is the point of the video, or screen recordings that are the content (use B-roll only at the open and close).
- Not where it would show identifiable people, logos, trademarks or readable text you have no right to show.
- It replaces the picture only; the voice, cuts and captions are untouched. Stock audio is ignored.

## Procedure

1. **Find the moments.** Read the transcript with the storyboard (graphics already planned). List 3-8 candidate moments with timeline seconds, the spoken line and a 2-4 word search query in English (Pixabay allows up to 100 characters). Skip moments covered by a graphic.
2. **Library first.** `video-monk assets --search "data center" --kind video`. Earlier downloads are free to reuse and cost no request.
3. **Search.** `video-monk stock-search --query "data center" --output cands.json --allow-search --type video --orientation landscape`
   (`--provider auto` uses Pixabay when `PIXABAY_API_KEY` is set; `--orientation portrait` for vertical videos; `--type image` for photos).
   The API allows 100 requests a minute and requires a 24-hour cache, which the toolkit does; a repeated search makes no request. Keep to a handful of searches per video: it is for a person's search, not bulk collection.
   AI-generated and low-quality results are left out unless you pass `--include-ai`; if you include them, tell the user, since synthetic footage may need a label on the platform.
4. **Choose.** The catalog lists each file's size. Pick the smallest file at least as wide as the video (1080p needs 1920 wide; for 9:16 pick a portrait clip, or use landscape with `fit blur`). The names (`large`, `medium`, `small`, `tiny`) vary per clip: choose by the listed dimensions, not the name.
   Pixabay photos are at most 1280 px wide: fine for a panel or a short slow zoom, soft at full-frame 1080p. Unsplash photos are sharp at full frame (use the `w1920` file for 1080p). Prefer video for motion, photos for a held still with a slow zoom.
5. **Look before you place.** Download the smallest file or take its frame and view it: `ffmpeg -ss 1 -i stock.mp4 -frames:v 1 frame.png`, then read the PNG. Reject clips with faces, logos, watermarks or text, and anything that does not show what the line says.
6. **Get approval, then download.** `--rights-confirmed` is the user's statement that they accept the licence for the selected asset, so ask before running it, once for the batch with the list of clips, creators and the licence link.
   `video-monk stock-fetch --catalog cands.json --id <id> --file-id <file> --output <new folder> --allow-download --rights-confirmed`
   Files are downloaded into the project (hotlinking is not allowed) and indexed in the asset library with creator, source page and licence.
7. **Place.** `video-monk broll-add --manifest production.json --output production.broll.json --asset-dir <folder> --at <timeline s> --duration <s>`
   One clip runs continuously across the speech cuts underneath. Vertical timelines get `fit blur`; images get a slow zoom. Warnings tell you when a full-frame graphic covers part of the window.
8. **Review.** `production-review`, build a draft, and look at the contact sheet. The picture must change roughly every 5-15 s, and the speaker must still be on screen for most of the video.

## Rights and credits

Pixabay Content License (https://pixabay.com/service/license-summary/): free to use, attribution not required but appreciated; do not sell unaltered copies; check identifiable people, brands and logos.
Unsplash License (https://unsplash.com/license): free for commercial use; credit is required by the Unsplash API terms. The credit lines are written into `CREDITS.txt` and the `YOUTUBE.md` credits; paste them into the video description.
The toolkit still records creator, source page and licence for every clip: they appear in `CREDITS.txt` and in the `YOUTUBE.md` credits. Search results shown to a user must credit Pixabay, and the catalog does. Availability is not proof of suitability.

## Limits

No semantic ranking: a result can match the words and miss the meaning, which is why you look at it. No audio from stock. Pixabay images are 1280 px at most without its full API access; Unsplash has no video and its demo tier is 50 requests an hour. `stock-fetch` downloads one selected file at a time by design.
