# B-roll from Pixabay (and Pexels)

B-roll is picture that covers the speaker while the voice carries on: a place, an object, a process, a metaphor. It is used where a concrete subject is
named and no graphic already explains it. It is not a substitute for the explainer graphics.

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
   Pixabay photos are at most 1280 px wide: fine for a panel or a short slow zoom, soft at full-frame 1080p. Prefer video for full-frame B-roll.
5. **Look before you place.** Download the smallest file or take its frame and view it: `ffmpeg -ss 1 -i stock.mp4 -frames:v 1 frame.png`, then read the PNG. Reject clips with faces, logos, watermarks or text, and anything that does not show what the line says.
6. **Get approval, then download.** `--rights-confirmed` is the user's statement that they accept the licence for the selected asset, so ask before running it, once for the batch with the list of clips, creators and the licence link.
   `video-monk stock-fetch --catalog cands.json --id <id> --file-id <file> --output <new folder> --allow-download --rights-confirmed`
   Files are downloaded into the project (hotlinking is not allowed) and indexed in the asset library with creator, source page and licence.
7. **Place.** `video-monk broll-add --manifest production.json --output production.broll.json --asset-dir <folder> --at <timeline s> --duration <s>`
   One clip runs continuously across the speech cuts underneath. Vertical timelines get `fit blur`; images get a slow zoom. Warnings tell you when a full-frame graphic covers part of the window.
8. **Review.** `production-review`, build a draft, and look at the contact sheet. The picture must change roughly every 5-15 s, and the speaker must still be on screen for most of the video.

## Rights and credits

Pixabay Content License (https://pixabay.com/service/license-summary/): free to use, attribution not required but appreciated; do not sell unaltered copies; check identifiable people, brands and logos.
The toolkit still records creator, source page and licence for every clip: they appear in `CREDITS.txt` and in the `YOUTUBE.md` credits. Search results shown to a user must credit Pixabay, and the catalog does. Availability is not proof of suitability.

## Limits

No semantic ranking: a result can match the words and miss the meaning, which is why you look at it. No audio from stock. Images are 1280 px at most without Pixabay's full API access. `stock-fetch` downloads one selected file at a time by design.
