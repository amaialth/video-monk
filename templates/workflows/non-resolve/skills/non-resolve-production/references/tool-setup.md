# External tools: installation and verified command contracts

The toolkit wraps existing HyperFrames CLI commands; no dependency, model,
browser, account or paid service is auto-installed. Review the chosen upstream
version and its license, privacy/telemetry settings, hardware and language support.
Installation/model downloads require approval and can be large.

## HyperFrames + Parakeet

Official upstream: [HyperFrames](https://github.com/heygen-com/hyperframes).
Check its current README and CLI help. The adapter uses:

```
hyperframes transcribe <absolute-media> --engine parakeet --json --dir <output>
hyperframes render <project> --composition <relative-html> --output <mp4> --fps 24
```

The transcription result must be JSON with `transcriptPath`, referencing a JSON
array of `{text,start,end}` within the output directory. Word times must be
ordered/in bounds. Upstream command/schema changes require adapter verification;
invalid output is rejected. No automatic Whisper/HeyGen fallback is used.
The installed version's setup command is `hyperframes models install parakeet`;
run only after confirming platform/language support and download approval.
Failure is a blocker, not proof Parakeet works on every Windows machine.

For project-local setup after user approval:

```powershell
npm install --save-dev --save-exact hyperframes@<reviewed-version>
```

Do that in your video project, not necessarily in the toolkit repository.
Resolve its installed JS CLI entry from the package's `bin` field:

```powershell
$root = Join-Path (Get-Location) "node_modules\hyperframes"
$manifest = Get-Content -Raw (Join-Path $root "package.json") | ConvertFrom-Json
$entry = if ($manifest.bin -is [string]) { $manifest.bin } else { $manifest.bin.hyperframes }
$env:VIDEO_MONK_HYPERFRAMES = Join-Path $root $entry
node $env:VIDEO_MONK_HYPERFRAMES --version
node $env:VIDEO_MONK_HYPERFRAMES transcribe --help
node $env:VIDEO_MONK_HYPERFRAMES render --help
```

The adapter executes Node with this absolute JS entry, not `npx` or a shell
command string. Thus filenames with spaces remain literal and package downloads
aren't triggered implicitly by the wrapper. FFmpeg/ffprobe are also needed; use
PATH or production's `VIDEO_MONK_FFMPEG`/`VIDEO_MONK_FFPROBE` overrides.

HyperFrames itself also needs FFmpeg on PATH (the toolkit overrides apply to
the wrapper's measurements, not all upstream internals). If its browser download
fails, use an existing compatible Chrome rather than disabling TLS verification:

```powershell
$env:HYPERFRAMES_BROWSER_PATH = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
```

Verify that path on your machine. Installing the npm CLI does not install or
verify the Parakeet model. Check `node $env:VIDEO_MONK_HYPERFRAMES models list --json`
and explicitly approve any missing-model setup.

`--allow-tool-network` acknowledges that upstream may fetch models/runtimes/
browser dependencies or contact telemetry endpoints. It is not a guarantee of
offline operation or an authorization to transmit private media. Inspect upstream
settings before confidential work. No paid remote inference is enabled by the
wrapper. `animate` executes trusted HTML, including its scripts and asset loads;
it is NOT a sandbox. Review the whole project, not just its HTML hash.

`animate` verifies decoded output dimensions/FPS/duration against explicit
expectations and records the source HTML hash for provenance. Asset-tree approval,
frame-by-frame visual review and factual correctness remain outside that check.

## Browser-connected roles

Google Chrome needs an explicitly connected browser tool/extension accessible to
the host agent. Claude agent files don't create that connection or automatically
grant MCP permissions. Use the main conversation's browser tools for approved
actions when a restricted subagent cannot access them; return results for review.

[OBS Studio](https://obsproject.com/) is the free local screen/webcam recorder.
No account/cloud upload is needed; no OBS remote-control integration is bundled.
The user operates capture and may edit manually with [Shotcut](https://shotcut.org/).
Check capture permissions, private on-screen data, mic/system track selection and
audio sync with a short test. Export or remux actual media and provide synchronized
narration separately for the assembler. Software installation needs approval.

Use [YouTube Audio Library](https://support.google.com/youtube/answer/3376882)
for free music/SFX; [Pixabay](https://pixabay.com/service/license-summary/) is
optional. Check current per-track license/attribution, intended platform/use and
third-party rights, not just a library's free label. Save source URL, creator,
license text/date and download evidence. Do not guarantee claim-free music.
The user signs into YouTube Studio directly if needed; never collect credentials
or cookies. Approved browser tools may assist selection/download, but no scraping
API or automatic license verification is supplied. Without browser access, request
lawfully downloaded local audio. No music subscription or purchase is required.

Local Parakeet/HyperFrames execution must be verified after installation. Mock
adapter tests establish command/output contracts only, not upstream compatibility
or model accuracy. The native FFmpeg production tests are a separate validation.
