# @amailath/video-monk

An npm-installable toolkit for studying YouTube editing techniques and planning
**original** videos with an OpenAI-compatible LLM and DaVinci Resolve.

The default reference channel is [ByteMonk](https://www.youtube.com/@ByteMonk).
This project is independent of ByteMonk, YouTube, OpenAI and Blackmagic Design.
No channel media or copied scripts are bundled. Twelve user-supplied, unverified
pilot reports are summarized as explicitly provisional references.

## Status and honest capabilities

Initial release, **0.1.0**. Local CLI and mocked integrations are tested; real
YouTube extraction, provider inference, Resolve import/scripting and rendered
output must be verified on a suitably equipped machine. This is assisted editing,
not a promise to recreate an entire channel or deliver a finished video from a URL.

| Surface | Implemented | Not automated |
|---|---|---|
| Channel discovery | All returned metadata entries per videos/shorts/streams tab via yt-dlp | Access to private, removed or blocked videos |
| Reference analysis | ffprobe metadata, heuristic scene changes, timestamped sampled stills | Actual cut verification, motion/audio analysis, transcription |
| Style study | Optional vision-capable LLM analysis of explicitly approved samples | A claim that sampled frames represent all videos |
| Planning | LLM-generated, bounds-validated sequential cut plan from your source inventory | Unsupervised clip understanding or speech alignment |
| Rough-cut Resolve handoff | Picture-only FCP7 XML, separate SRT, finishing checklist | Source-audio import/mixing, grades, graphics, transitions |
| Production assembly | Video/still scenes, timed video B-roll, animated bar/text graphics, continuous narration/music, audiovisual preview and audio/picture XML | Arbitrary animation, automatic factual/rights review, editable Fusion nodes |
| Stock sourcing | Opt-in Pexels video search and selected-file download, credits/provenance and approval gates | Automatic semantic ranking, verified releases or permission to reuse creator footage |
| Export validation | Decode, dimensions/FPS/duration and integrated-LUFS/true-peak tests on the actual export | Creative/factual certification or replacing whole-video playback |
| Resolve scripting | Optional connection probe, new-project XML import, approved render queue/start | Guaranteed Free support, unattended finishing, render-completion verification |
| Delivery | Human review gates and export instructions | YouTube upload or autonomous publishing |

End-to-end **assisted** production covers every stage through skills and checklists;
the manual finishing steps above are deliberate and must be completed in Resolve.

## Installation

Requires Node.js 22+. There are no npm runtime dependencies or install hooks.

Once published to public npm:

```powershell
npm install --global @amailath/video-monk
video-monk --help
video-monk install --target "C:\Projects\my-video"
```

Before publication, install the locally produced tarball:

```powershell
npm install --global ".\amailath-video-monk-0.1.0.tgz"
```

Or work directly from this source directory without installing:

```powershell
node .\bin\video-monk.js --help
node .\bin\video-monk.js install --target "C:\Projects\my-video"
```

`install` copies three skills and four agents into the target workspace's
`.github\skills` and `.github\agents`. It preflights all destination files and
refuses overwrites. It does not modify user-profile settings or auto-install tools.
For upgrades, back up/remove the specifically installed files yourself before
reinstalling; unrelated customizations are never deleted.

### Claude Code + Resolve Free (no separate planning API)

Install the same skills and converted agents for Claude Code:

```powershell
node .\bin\video-monk.js install --target "C:\Projects\my-video" --format claude
```

This writes `.claude\skills` and `.claude\agents`, renames agents to `.md`,
maps their tool allowlists and removes Copilot-specific delegation metadata.
Analyst/reviewer stay read-only. Claude subagents return coordination requests
to the main conversation rather than spawning nested subagents. Relative
skill/reference links are preserved; existing files are never overwritten.
Restart Claude Code in that project, check `/agents`, and invoke
`/original-edit-planning` or ask to use `video-monk-producer`.
These files are for Claude Code, not automatic installation into Claude.ai chat.

For a local workflow, no `init`, model configuration or API key is required.
Claude Code's own access/usage charges still apply. Instruct it:

> Read the original-edit-planning skill. Use only my original source inventory
> and approved provisional creative direction. Write a draft-plan.json matching
> the documented schema, with empty captions unless I supply a verified source
> transcript. Use import-plan, not the API-based plan command. Do not download,
> install software, call another provider, render or publish.

Create `inventory.json` using the source-inventory example in step 5 below.
For a five-second setup test, this is a complete `draft-plan.json` (the `intro`
source must actually contain at least five seconds):

```json
{
  "version": 1,
  "title": "Original setup test",
  "fps": 24,
  "width": 1920,
  "height": 1080,
  "clips": [{"mediaId": "intro", "in": 0, "out": 5, "purpose": "Import test"}],
  "captions": [],
  "finishing": {
    "audio": ["Restore and verify original source audio in Resolve"],
    "color": ["Verify source color space and scopes"],
    "graphics": ["Check text readability and safe areas"],
    "export": ["Review full timeline and verify test export"]
  }
}
```

From the toolkit directory, using your actual project paths:

```powershell
node .\bin\video-monk.js import-plan `
  --inventory "C:\Projects\my-video\inventory.json" `
  --plan "C:\Projects\my-video\draft-plan.json" `
  --output "C:\Projects\my-video\bundle.json"
node .\bin\video-monk.js validate --bundle "C:\Projects\my-video\bundle.json"
node .\bin\video-monk.js handoff `
  --bundle "C:\Projects\my-video\bundle.json" `
  --output "C:\Projects\my-video\handoff"
```

`import-plan` reads strict JSON (not Markdown fences or a bundle), re-probes
actual source files and refuses invalid plans or existing outputs. Add
`--transcript "C:\Projects\my-video\transcript.txt"` only for a supplied verified
source transcript; nonempty captions without it are rejected. Supplying a file
does not prove caption words/timing match speech: human review is still required.
No video, transcript or plan is sent to any provider by this command.

**Resolve Free acceptance test:** install Resolve separately, record its exact
edition/version, and confirm `ffprobe` is on PATH. Use integer-rate footage
(24/25/30/50/60); conform fractional/VFR copies intentionally before XML handoff.
In a new Resolve project, import the handoff's `timeline.xml` via File > Import >
Timeline. Verify clip order, duration, frame rate, resolution and media relinking.
The XML is picture-only: restore source audio, import any separate SRT, and finish
graphics/color/mixing manually. Save, approve a test export, then inspect the
actual file and play it through. Mark each unperformed check NOT VERIFIED.
No Python/MCP bridge, Studio scripting or third-party editing service is required.
Live Claude discovery and Resolve import/render must be checked on your machine;
automated template tests are not proof those applications accepted the files.

Reload VS Code if needed. Use **video-monk-producer** in the Copilot agent picker.
The installed skills are:

- `channel-editing-study`
- `original-edit-planning`
- `resolve-assisted-finishing`

Specialist agents: **video-monk-analyst**, **video-monk-editor** and
**video-monk-quality-reviewer**. These are Copilot customization files, not a
separate paid agent runtime. CLI commands also work without Copilot.

### Optimized skills, agents and reference loading

The [study index](templates/skills/channel-editing-study/references/study-index.md)
routes all twelve supplied reports by topic and narrative/visual use. It owns
the current coverage ledger: eleven declared runtimes total **139:30**, with
OWASP duration unknown. This is not independently watched time, verified source
identity or complete-channel coverage. Duplicate submissions add no coverage.

The three skills share one
[evidence and approval contract](templates/skills/channel-editing-study/references/workflow-contract.md).
Load the index and only the relevant reports for a topic; full-corpus synthesis
is explicit, bounded work. Reports retain provenance, timestamped findings and
local technical caveats rather than outdated aggregate histories. New reports
extend the index, not every agent's prompt.

| Role | Boundary and handoff |
|---|---|
| Producer | Coordinates scope, approvals, operator collection and stage handoffs |
| Analyst | Read/search-only evidence assessment; collection gaps return to the operator |
| Editor | Original storyboard, source inventory, validated rough cut and manual finishing tasks |
| Quality reviewer | Read/search-only PASS/FAIL/NOT VERIFIED checks; never executes missing checks |

Planning accepts verified evidence or explicitly approved **provisional creative
direction**, preserving that label. Captions need a verified source transcript.
The [optional manual recipes](templates/skills/resolve-assisted-finishing/references/manual-recipes.md)
cover original cards, diagrams, maps, tables, execution lanes and captures, loaded
only when needed. Fusion/Fairlight availability needs installed-version checks.
The CLI still exports picture-only cuts and finishing notes, not applied effects.

Customization tests check discovery/frontmatter, tool/delegation boundaries,
installed links, routing/declared durations, preserved caveats and context budgets.
These structural checks do not prove model behavior or actual Resolve integration.

## B-roll, animated infographics and production assembly

The production workflow goes beyond the original picture-only rough-cut handoff.
See the [full production procedure](templates/skills/original-edit-planning/references/production.md)
and [manifest example](templates/skills/original-edit-planning/references/production.example.json).
It supports separate landscape **16:9** and portrait **9:16** projects.
Final finishing and final export stay in **Resolve Free**, not an unattended API.

1. Prepare original narration and permitted video/images/music. Have Claude
   create `production.json` using the example. All paths resolve relative to the
   manifest; give every asset rights, credit and explicit approval. The example
   expects exactly ten seconds of narration and five usable seconds of camera.
2. Select B-roll per narration beat, not by random keyword illustration.
   Local video/image assets work without any service. For optional online stock:

   ```powershell
   $env:PEXELS_API_KEY = "<your-key>"
   node .\bin\video-monk.js stock-search --query "server racks" `
     --output ".\candidates.json" --allow-search
   ```

   This sends query text to Pexels. Review its source page, current license,
   releases/context, creator credit and the specific video-file choice.
   Then download only that selected asset:

   ```powershell
   node .\bin\video-monk.js stock-fetch --catalog ".\candidates.json" `
     --id "<video-id>" --file-id "<file-id>" --output ".\stock-selected" `
     --allow-download --rights-confirmed
   ```

   Candidates aren't rights clearance. Downloads reject redirects/unapproved
   origins, limit each file to 250 MiB and preserve creator/source/hash metadata.
   Credit Pexels and the creator; read current [license](https://www.pexels.com/license/)
   and [API terms](https://www.pexels.com/api/documentation/) for your use.
   This does not download YouTube/ByteMonk references or generate paid AI footage.
3. Configure `scenes` as video, still-image holds or procedural graphics.
   Each can include a timed full-screen `broll` video with `asset`, source `in`,
   scene-relative `start` and `duration`. B-roll/source-video sound is discarded;
   the supplied narration is continuous. See the production reference for details.
   Graphics have a title (max 32 characters), citation and 1-5 rows with short
   labels and normalized bar values 0-1. Calculate values, show real units and
   cite sources. Text/bars reveal progressively; these aren't arbitrary node
   diagrams or AI-generated photographic clips. Images are PNG/JPEG/WebP/BMP/TIFF.
4. Validate/review the manifest. Only after explicit user approval of the plan,
   asset rights and choices, create an approved review:

   ```powershell
   node .\bin\video-monk.js production-review --manifest ".\production.json" `
     --output ".\approved-review.json" --approve-plan
   node .\bin\video-monk.js production-build --manifest ".\production.json" `
     --review ".\approved-review.json" --output ".\production-v1" --allow-render
   ```

   Omit `--approve-plan` for a pending validation report. Review includes media
   bounds, narration-duration alignment and content hashes of manifest/media/font.
   Any changed input requires fresh approval. Rendering uses FFmpeg; no LLM
   request is made. Failures are explicit and can leave a partial output folder;
   inspect it and use a new version folder, never silently reuse it.
5. Review the assembled `preview.mp4`, per-scene contact images, credits and
   `production-report.json`. The preview contains mixed/limited audio.
   `timeline.xml` references generated picture clips and separate prepared
   narration/music WAVs. Import it into a NEW Resolve Free project, checking
   both audio channels, sync, FPS and duration. XML audio interoperability must
   be tested in your installed Resolve version. The audiovisual preview is a
   flattened import fallback, not a claim that layered import succeeded.
6. Revise as needed, finish in Resolve (captions, complex Fusion work, color,
   dynamics/loudness), watch/listen end-to-end, then approve/export there.
   Separate XML audio tracks don't contain the preview's safety limiter.
   Music uses fixed gain and an ending fade; no automatic ducking is implemented.
7. Check the actual Resolve export against your chosen delivery targets:

   ```powershell
   node .\bin\video-monk.js production-verify --manifest ".\production.json" `
     --media ".\resolve-final.mp4" --output ".\verification.json" `
     --target-lufs=-16 --max-true-peak=-1
   ```

   These target values are examples, not mandatory platform settings. Decode,
   dimensions, FPS, duration, integrated loudness (within 1 LU) and true peak are
   checked. Failed checks return nonzero. After actual complete export playback,
   add `--approve-playback` with a NEW report path to record user attestation.
   Facts, licenses, artistic quality and publication permission remain human gates.

### Media tools

Use official FFmpeg/ffprobe builds approved by your organization. Either add
them to PATH or set executable paths for production commands:

```powershell
$env:VIDEO_MONK_FFMPEG = "C:\Tools\ffmpeg\bin\ffmpeg.exe"
$env:VIDEO_MONK_FFPROBE = "C:\Tools\ffmpeg\bin\ffprobe.exe"
```

These overrides are for the new production commands; older analyze/import-plan
commands still require tools on PATH. No Python, Chromium, paid image/video
service or Resolve scripting is required for this native production renderer.
The installed FFmpeg must include libx264, drawtext and loudnorm filters.
For automated real-media tests, set both executable overrides and
`VIDEO_MONK_TEST_FONT` to a permitted local font, then run `npm test`.
Without those variables the real-media test is explicitly skipped.

### Referenced projects

The supplied [video-short](https://github.com/petergyang/video-short),
[b-roll-finder](https://github.com/louisedesadeleer/b-roll-finder) and
[EpicInfographics](https://github.com/OrRon/EpicInfographics) repositories
advertise MIT licenses. They informed the workflow review; no third-party code,
fonts, agents or dependencies from them are bundled or auto-installed.
Their broader features (review web UI, richer HTML animation, external generation)
are **not** claimed as toolkit features. Marketplace infographic skills have
their own dependencies/licenses; "TypingMind B-Roll Skills" had no exact link
to verify. See the production reference for the comparison and remaining gaps.

## Prerequisites

Run `video-monk doctor`. Missing prerequisites produce explicit diagnostics and a
nonzero exit code.

- **yt-dlp** on PATH for public channel metadata and authorized reference downloads.
- **ffmpeg and ffprobe** on PATH for local analysis and source validation.
- An **OpenAI-compatible chat-completions endpoint** and an appropriate model.
  Vision is required for actual frame interpretation; compatibility with image
  inputs varies by provider. Endpoint selection does not imply provider testing.
- **DaVinci Resolve**, installed separately, for timeline import and finishing.
  Free is the manual-import baseline. Blackmagic documents scripting and workflow
  integration as [Studio features](https://www.blackmagicdesign.com/products/davinciresolve/studio).
- Optional **Python 3** plus Resolve's scripting modules for the bridge. Follow
  the Developer Scripting README shipped with your Resolve version to configure
  `RESOLVE_SCRIPT_API`, `RESOLVE_SCRIPT_LIB`, module paths and scripting access.
  Scripting being unavailable is a blocker for the bridge, not for manual XML import.

Install prerequisites from their official distributions under your organization's
software/network policy. The toolkit does not bypass blocked downloads.

## Walkthrough

Commands below assume a global installation. In a source checkout, replace
`video-monk` with `node .\bin\video-monk.js`.

### 1. Initialize a study and configure the provider

```powershell
video-monk init --dir ".\work\bytemonk" `
  --channel "https://www.youtube.com/@ByteMonk" `
  --base-url "https://api.openai.com/v1" --model "<your-vision-capable-model>"

$env:OPENAI_API_KEY = "<set securely in your local session>"
```

The base URL must include your provider's API prefix (commonly `/v1`), not
`/chat/completions`. HTTPS is required except for loopback HTTP endpoints.
Keys stay in environment variables; never commit them. To use a different key
environment-variable name, edit `llm.apiKeyEnv` in `video-monk.json`.

Local OpenAI-compatible servers are supported through an explicit loopback base
URL. No specific local runtime is required or installed.

### 2. Catalog the channel

```powershell
video-monk catalog --project ".\work\bytemonk" --limit 0
video-monk catalog --project ".\work\bytemonk" --limit 0 --tab shorts
video-monk catalog --project ".\work\bytemonk" --limit 0 --tab streams
```

Each command writes a distinct `catalog-<tab>.json`. `--limit 0` means all entries
returned for that tab, **not** guaranteed access to all historical uploads.
Missing tabs are reported as errors. Use a fresh project/output for refreshes.

For a complete study, iterate every returned video ID across the tabs in scope,
recording failures and analyzed time windows. For a sample, select different
lengths/formats/eras and disclose the sampling policy. Neither mode is silently
substituted for the other. The CLI does not start a costly whole-channel download.

### 3. Analyze references

Public availability does not establish download/reuse permission. Use videos you
are authorized to download/analyze and comply with applicable platform terms:

```powershell
video-monk fetch --project ".\work\bytemonk" --id "<11-character-ID>" --allow-download
```

The ID must appear in this project's catalog. Downloads are limited to
720p-selected formats, with a 2 GiB per-download limit where yt-dlp can determine
the size. Interrupted downloads leave their reference folder for inspection;
retry requires a new project or manually cleaning that specific failed folder.
No cookies, DRM circumvention or login-bypass options are supplied.

Alternatively, provide an authorized local reference file directly:

```powershell
video-monk analyze --media "C:\Media\reference.mp4" `
  --output ".\work\evidence-01" --seconds 180 --frames 8 `
  --source-url "https://www.youtube.com/watch?v=<video-ID>"
```

This writes `evidence.json` and sampled JPEGs. Scene threshold is 0.3. Scene
changes are candidate cuts, not exact edit decisions. Sampling defaults to the
first 180 seconds, with 1-24 stills; `--seconds` supports 1-86400. Longer analysis
is slower and external commands time out after ten minutes with an explicit error.
Audio content and animation are not measured.

### 4. Draft an evidence-grounded style guide

```powershell
video-monk style --project ".\work\bytemonk" `
  --evidence ".\work\evidence-01\evidence.json" `
  --output ".\work\style.md" --allow-llm --send-media
```

Repeat `--evidence` to include additional records. At most 48 images and 20 MiB
per model request; split large catalogs into batches. **`--send-media` uploads the
extracted stills to your configured provider.** Review rights, privacy, cost and
retention first. Without it, only evidence records/technical measurements are sent,
and visual conclusions are unsupported. No video or audio file is uploaded.

Review the draft against actual reference playback and consolidate batches with
coverage counts. A good guide separates facts, hypotheses and unknowns, with
video/timestamp citations. Do not trust model assertions without checking evidence.

### 5. Plan an original video

Create `inventory.json` from the generated example, replacing paths/descriptions:

```json
{
  "version": 1,
  "media": [
    {
      "id": "intro",
      "path": "media/intro.mp4",
      "role": "source",
      "description": "Original presenter footage. 0-5s: topic hook; 5-18s: overview."
    }
  ]
}
```

Paths are relative to the inventory file. All inventory media are re-probed; model
duration claims are never trusted. Only `role: "source"` is accepted. Do not put
unlicensed reference footage in the inventory.

Write an original brief and, if available, a verified source transcript:

```powershell
video-monk plan --project ".\work\bytemonk" `
  --inventory ".\work\bytemonk\inventory.json" `
  --brief ".\work\bytemonk\brief.txt" --style ".\work\style.md" `
  --output ".\work\edit-bundle.json" --allow-llm
```

Add `--transcript <file>` for captions. Without it, captions must remain empty.
The toolkit does not transcribe speech; LLM-generated caption alignment is a
draft even with a transcript.

`plan` sends the brief, style guide, technical metadata, source descriptions and
optional transcript to the provider, **not source video bytes or filesystem paths**.
Private information in descriptions/briefs still needs explicit review.

Edit the draft JSON as needed, then validate:

```powershell
video-monk validate --bundle ".\work\edit-bundle.json"
video-monk handoff --bundle ".\work\edit-bundle.json" --output ".\work\handoff"
```

Plans use source seconds for clip in/out and final timeline seconds for captions.
They must have finite, valid bounds; captions must be ordered/non-overlapping and
fit the frame-quantized timeline. Supported timeline/source handoff frame rates
are integer 24/25/30/50/60. Fractional-rate sources (23.976/29.97/59.94) are explicitly
rejected for XML handoff; conform copies intentionally rather than relabeling them.
Variable-frame-rate footage should also be conformed to a constant-rate copy.

### 6. Finish in Resolve Free

Read `FINISHING.txt` in the handoff folder:

1. Import `timeline.xml` via **File > Import > Timeline**.
2. Verify frame rate, resolution, clip order, source frame bounds and duration.
3. Rebuild/sync source audio; mix dialogue/music with actual loudness measurements.
4. Import nonempty `captions.srt`, verify speech alignment, and style captions.
5. Add original diagrams/B-roll/motion, match color with scopes, and review.
6. Configure delivery settings, export, and watch the entire result.

The XML is **picture-only**. Color, sound and graphics notes are instructions for
finishing, not applied effects. No Studio-only feature is silently substituted.

### Optional scripting-enabled Resolve

```powershell
python ".\work\handoff\resolve_bridge.py" --probe
python ".\work\handoff\resolve_bridge.py" `
  --handoff ".\work\handoff" --project-name "Original-video-draft"
```

The bridge creates a NEW project only. It never opens/replaces an existing one.
Import is not a finished production. Complete and review audio/captions/color/
graphics in Resolve, then render the **currently open reviewed project** separately:

```powershell
python ".\work\handoff\resolve_bridge.py" --render-current `
  --project-name "Original-video-draft" --render-preset "<existing-preset-name>" `
  --render-dir "C:\Exports\new-empty-folder" --approve-render
```

The render folder must exist and be empty. This queues a single-clip render only.
Add `--start-render` to explicitly start it. The bridge checks API return values
but does **not** claim render completion. Monitor Resolve, inspect the actual file,
and verify full playback plus technical metadata. Publishing remains separate.

## Data and failure behavior

- No telemetry, runtime npm dependencies, bundled credentials or auto-downloads.
- `fetch` needs `--allow-download`; LLM commands need `--allow-llm`; images also
  need `--send-media`; rendering needs separate explicit approval.
- External tools run as argument arrays, without a shell.
- Outputs refuse overwrite. Failed multi-file operations may leave partial output
  folders; failures are explicit, not disguised as successful studies.
- HTTPS credentials/query parameters and redirects are rejected for LLM endpoints.
- Model output is schema/bounds-validated before handoff; nothing executes model
  code. Schema validation cannot prove creative quality or transcript accuracy.
- Provider errors report HTTP status rather than potentially sensitive response
  bodies. Project work/media should not be committed or included in npm packages.

## Development and publishing

```powershell
npm run check
npm test
npm pack
```

Tests use local fixtures, subprocess smoke checks and mocked media/provider
responses, not third-party content or live inference. Resolve/Python are not
required for npm tests; the bridge still needs separate runtime validation.

`npm pack` runs checks/tests through `prepack`. The package allowlist includes only
the CLI, source, templates, README and license; tests, local media and API keys
are excluded.

On a machine authorized for public npm, check ownership/availability, inspect the
tarball, authenticate interactively, then publish the tested tarball:

```powershell
npm view @amailath/video-monk --registry=https://registry.npmjs.org
npm login --registry=https://registry.npmjs.org
npm publish ".\amailath-video-monk-0.1.0.tgz" --access public --registry=https://registry.npmjs.org
```

A 404 does not establish scope ownership; verify that your account controls
`@amailath`. This workspace's initial public-npm check was blocked by network
policy and public npm authentication was absent. **No publication was performed.**
Do not disable TLS validation, bypass network policy or publish to a corporate
registry as a substitute.

## License

MIT for this toolkit only. Referenced videos, music, fonts, footage and other
third-party assets retain their respective licenses and ownership.
