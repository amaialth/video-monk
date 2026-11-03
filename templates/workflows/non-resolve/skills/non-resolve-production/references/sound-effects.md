# Sound effects

Two sources, same cues and same library:

- **Built-in synthesis** (default): original sounds made with FFmpeg. No samples, no downloads, no key, nothing to attribute. Free and offline.
- **Mirelo text-to-SFX** (optional): richer, more natural sounds from a text prompt, and any other sound or ambience you can describe. Needs `MIRELO_API_KEY`.

Either way each sound is generated once, indexed in the asset library and reused (`sfx-<kind>-v1` for synthesis; `sfx-mirelo-<hash>` for Mirelo, keyed by prompt, length and model), so credits are never spent twice on the same sound.

| Kind | Length | Used for |
|---|---|---|
| whoosh | 0.9 s | a full-frame cutaway appearing |
| swipe | 0.4 s | a side panel appearing, or a cutaway leaving (full mode) |
| pop | 0.25 s | a stat, term or callout reveal |
| chime | 1.6 s | chapter and title cards |
| ding, click, tick, impact, riser | 0.08-2 s | available for hand placement (`video-monk sfx --kind <name> --output x.wav`) |

## Use

- `video-monk auto ... --sfx subtle` (or `full`) accents every planned graphic. `subtle` is one quiet accent per graphic (-15 to -18 dB), at least 2 s
  apart, at most 5 a minute; `full` adds pops and exit swipes, 1 s apart, at most 10 a minute. Default is off for `auto`; the brief suggests `subtle` for explainers and screen tutorials.
- On an existing manifest: `video-monk sfx --manifest production.json --output production.sfx.json --mode subtle` (`--plan` prints the cues without writing).
- Cues are ordinary `audio.sfx` entries (`asset`, `at`, `gainDb`); edit them like any other. Music ducks under speech; SFX sit under the voice at their low gain.

## Taste rules

- Sound effects accent, they do not decorate. If you notice one while listening, it is too loud or too frequent: lower `gainDb` or use `subtle`.
- Never on top of a key word in the voice: move the cue 0.3 s earlier or drop it.
- No effect on interviews, quiet or serious pieces.
- Generated sounds are checked for level and length, but not auditioned by an agent: **listen to the result and adjust** (see Listening).

## Mirelo (credits)

Setup: put `MIRELO_API_KEY=sk-...` in the environment or in a `.env` file in the folder you run from (git ignores `.env`; see `.env.example`). The key is never printed, logged or stored in a manifest.

- It is **opt-in**: a prompt is sent to Mirelo and credits are spent. Every command needs `--allow-mirelo`. Without it, nothing leaves the machine.
- `video-monk sfx --credits` shows the balance. Pricing (sfx-2.0): 10 credits per second until 2026-12-12, 15 after, per variant. The toolkit asks for one variant.
- A budget caps each run: `--budget 300` (`--mirelo-budget 300` on `auto`). When the next sound would exceed it, or the account is short, that sound falls back to the built-in synthesised version and the run says so. A full set of the nine built-in kinds costs about 85 credits once.
- Place sounds on graphics: `video-monk sfx --manifest production.json --output production.sfx.json --engine mirelo --allow-mirelo` or `auto --sfx subtle --sfx-engine mirelo --allow-mirelo`.
- One named sound: `video-monk sfx --kind whoosh --engine mirelo --allow-mirelo --output whoosh.wav`.
- **Any other sound or ambience** from a prompt: `video-monk sfx --prompt "quiet open-plan office, distant keyboards, soft air conditioning" --seconds 30 --engine mirelo --allow-mirelo --output office.wav`. Use it as an `audio` asset with an `audio.sfx` cue, or as a low-level bed in `audio.music` (it ducks under speech). It makes sound effects and ambience, **not music**: use licensed music for beds with melody.
- Not built: video-to-sound-effects (Mirelo can generate sound that follows a video clip; it needs uploads and costs per second of video).

Terms to check: the Free plan is for **non-commercial** use, and a paid plan is needed to ship commercially. A fully automatic pipeline needs no "Powered by Mirelo" badge. Generated files are deleted from Mirelo after 7 days, so the toolkit copies them into the library at once. Facts here are from Mirelo's published API reference (November 2026); re-read https://mirelo.ai/api-terms before relying on them for a commercial release.

## Mirelo MCP server (for Claude Code agents)

The same account and key also work through Mirelo's MCP server, `https://mcp.mirelo.ai/mcp`. The repository's `.mcp.json` registers it as `mirelo`
and reads the token from the `MIRELO_API_KEY` environment variable (the file holds no secret). Claude Code does not read `.env` by itself, so start it from a
shell that has the variable: `set -a; . ./.env; set +a; claude`. Approve the project server when prompted, then check it with `/mcp`.

Tools (verified against the server): `get_account` (credits), `preflight` (exact credit quote, free), `text_to_sfx`, `video_to_sfx` (foley and ambience that follow a video clip),
`extend_audio`, `inpaint_audio`, `create_upload` / `create_asset` / `inspect_asset` (media in), `get_job` / `wait_job`, plus `audio_to_midi`. **It does not make music.**

Rules for agents using it:
1. `get_account` first, then `preflight` every generation and tell the user the credit cost; cost is per second per variant (about 10 credits per second on sfx-2.0 until 2026-12-12, 15 after). Ask for approval before anything over about 100 credits, and always before `video_to_sfx` on long footage (it bills per second of video).
2. Ask for one variant unless the user wants choices.
3. Download the result at once (Mirelo deletes files after 7 days) and register it: `video-monk assets --add <file> --kind audio --name "..." --rights "Generated with Mirelo; paid plan for commercial use" --approved`, then add it as an `audio` asset with an `audio.sfx` cue, or `audio.music` for a quiet ambience bed.
4. Check the library first (`video-monk assets --search "whoosh"`): the built-in sounds and earlier generations are free to reuse.
5. You cannot hear the result. Build the audition page and ask the user to listen.

The CLI (`--engine mirelo --allow-mirelo`) covers text-to-SFX with budgets and caching; the MCP adds video-to-SFX, extend and inpaint, which the CLI does not.

## Listening

An agent cannot hear audio. What can be checked without ears: length, peak and loudness, silence, clipping, and a spectrogram image (attack, decay, and what frequencies it uses). That catches broken sounds, not a wrong *feel*.
`video-monk sfx --audition <folder of .wav> --output audition.html` writes a page with a player, waveform and spectrogram for every sound so a person can judge them in a minute. Play them against the voice at normal level, then adjust `gainDb` or the mode.

## Other sources

Other AI sound-effect services or files (ElevenLabs, AudioCraft, stock libraries) are not called by the toolkit. If you use one, get the user's approval, save the file, record the licence and account terms (`video-monk assets --add ... --kind audio --rights ... --approved`), and add it as an `audio` asset with an `audio.sfx` cue.
