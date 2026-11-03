# Production assembly and Resolve Free delivery

Use this workflow for actual B-roll, animated graphic clips and audio/picture
assembly, not the earlier picture-only rough-cut schema. Read the shared contract.
Final approval/export remains in Resolve Free; generated MP4s are drafts.

## Plan, source and review

1. Use [production.example.json](./production.example.json) as the strict manifest
   shape. Build separate manifests for 16:9 and 9:16; don't just crop text from
   one orientation into the other. Keep factual labels, actual values/units
   and citations readable; normalized bar lengths must be calculated from data.
2. Obtain original narration and assets with rights. No automatic TTS or
   transcription is supplied. Every scene needs a teaching purpose and fit mode.
   The narration is continuous and must match the scene duration within a frame.
   If A-roll speech is needed, supply an original, synchronized narration/audio
   export; source video audio is intentionally not copied.
3. Route each beat to an original recording, stock illustration, infographic or
   verification lead. Stock pictures can't prove identities, incidents or metrics.
   Do not copy creator footage or download YouTube references.
4. Optional stock search sends query text to Pixabay (when `PIXABAY_API_KEY` is set) or Pexels:
   `video-monk stock-search --query "server racks" --output <candidates.json> --allow-search`.
   Requires `PIXABAY_API_KEY` or `PEXELS_API_KEY`. Review candidates/source pages before selection.
   `video-monk stock-fetch --catalog <candidates.json> --id <video-id> --file-id <file-id> --output <new-asset-folder> --allow-download --rights-confirmed`.
   These flags apply to that selected asset only. Preserve provenance/credit and
   inspect the downloaded MP4. Adjust its relative path when adding asset.json
   to a manifest. No automatic rights verification or stock semantic ranking.
5. Prepare a manifest and discuss scene order, asset choices, narration, citations,
   crop/readability, licenses/releases and music level. A draft validation report:
   `video-monk production-review --manifest <production.json> --output <review.json>`.
   After the user's explicit plan/asset approval, repeat with a NEW report path
   and `--approve-plan`. This is not final-video approval. Don't self-approve.
6. With draft-render approval:
   `video-monk production-build --manifest <production.json> --review <approved-review.json> --output <new-production-folder> --allow-render`.
   The report fingerprint binds the manifest, actual media bytes and font;
   changed inputs require a new review. FFmpeg and ffprobe must be installed.
   Optional executable overrides: `VIDEO_MONK_FFMPEG`, `VIDEO_MONK_FFPROBE`.

## What is actually generated

- Silent, normalized per-scene MP4s: original video, still-image holds, or native
  procedural infographic cards with timed text/bar reveals. This is a limited
  graphic vocabulary, not arbitrary diagram generation or editable Fusion nodes.
- Optional full-screen video B-roll over a scene at explicit relative times;
  original narration continues uninterrupted. B-roll sound is discarded.
- Separate 48 kHz stereo narration/music WAVs with explicit gains; music loops
  and fades out. No automatic speech ducking or final mastering.
- `preview.mp4` with assembled picture and mixed/limited audio; contact images
  per scene; a machine-readable report and attribution records.
- `timeline.xml` with picture clips and prepared audio tracks for Resolve.
  XML audio interoperability still requires an installed-version import test.
  If needed, import preview.mp4 as a flattened audiovisual draft instead.
- Full decode/dimension/duration/audio-presence checks are performed; visual
  meaning, narration correctness, readable crops and final mix remain unverified.

## Manual final production and verification

Import into a NEW Resolve Free project. Verify scene boundaries, both audio
channels, sync, project FPS and target orientation. Review contact images and
preview, and revise the manifest/assets before producing a NEW version folder.
Complete captions, more complex Fusion work, color and audio mastering in Resolve.
The preview safety limiter is not baked into the separate XML audio tracks.

Choose delivery loudness/true-peak requirements and watch/listen to the entire
timeline. Approve and export in Resolve. Then validate the actual export:

`video-monk production-verify --manifest <production.json> --media <Resolve-export.mp4> --output <verification.json> --target-lufs=-16 --max-true-peak=-1`

Those numbers are example delivery choices, not universal YouTube requirements.
Verification fully decodes, checks dimensions/FPS/duration and measures integrated
LUFS/true peak. Loudness must be within 1 LU of the chosen target; true peak must
not exceed its ceiling. Failed technical checks return a failing CLI exit status.
Only after actual whole-file playback may the operator add `--approve-playback`
to a NEW verification report. The attestation doesn't certify facts, rights or
creative quality. Human acceptance and publishing permission remain separate.

## External references (not installed integrations)

- [video-short](https://github.com/petergyang/video-short): MIT; a broader shorts
  workflow with review UI, HyperFrames/Python and optional paid generation.
- [b-roll-finder](https://github.com/louisedesadeleer/b-roll-finder): MIT; semantic
  candidate curation methodology, not a ready-made production rendering engine.
- [EpicInfographics](https://github.com/OrRon/EpicInfographics): MIT; richer
  HTML/CSS design and deterministic Chromium/FFmpeg animation pipeline.
- MCP Market's professional-infographics listing describes external image,
  research and review APIs; infographic-builder describes portrait HTML rendering.
  Marketplace descriptions are not verified integration contracts or licenses.
- "TypingMind B-Roll Skills" had no exact source supplied; integration unknown.

No third-party code or fonts from these projects are bundled. These are research
leads, not dependencies or claims of installed compatibility. The present native
renderer avoids new paid services and browser/Python dependencies. Any future
reuse requires exact source/license review and preserving required notices.
