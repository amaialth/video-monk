# Educational shorts: a blog or a concept, narrated by ElevenLabs

A short is a 30, 45 or 60 second vertical explainer (1080x1920): a script written from the user's text, narration recorded with ElevenLabs, and one animated graphic scene per beat with word-timed captions.
It is made by `video-monk short` or from **Shorts** in the web studio (`video-monk ui`). Both use the same code and the same gates.

## Setup (once)

Put these in your environment or a `.env` file (see `.env.example`; the names are read, the values are never printed, stored in a project or sent to the browser):

| Name | What |
|---|---|
| `ELEVENLABS_API_KEY` | required to record and to list voices |
| `ELEVENLABS_VOICE_ID` | optional default voice (an id from `video-monk short --voices`) |
| `ELEVENLABS_MODEL_ID` | optional model, default `eleven_multilingual_v2` (`video-monk short --models`; flash models cost fewer credits per character) |

`video-monk short --check` says what is set (yes or no only). Writing scripts needs the `claude` command-line tool (Claude Code).

## The path

```
video-monk short --source post.md --output shorts/plants --script-only --allow-llm [--length 45 --tone friendly --audience beginner --cta "Follow for more"]
   -> script.json and SCRIPT.md: read them, edit the narration or the on-screen text
video-monk short --script shorts/plants/script.json --source post.md --output shorts/plants-v1 --voice <id> --allow-eleven [--captions highlight --theme night --sfx subtle]
   -> audio/ (one recording per beat), narration.wav, words.timeline.json, production.json, PLAN.md
video-monk short ... --build --approve-plan [--quality final]      or      production-review ... --approve-plan  then  production-build
   -> build/final.mp4, contact sheet, captions, review notes
```

Each step that sends text out or spends money has its own switch: `--allow-llm` (your text goes to Claude), `--allow-eleven` (credits), `--approve-plan` (you have read the script, heard the voice and checked the plan). Nothing is published.

## The script rules (checked by the tool)

- 5 to 12 beats, 10 to 30 words each, about 2.5 spoken words per second of the chosen length. Beat 1 is the hook (a question or surprising true claim, at most about 14 words); the last beat is the takeaway.
- `show` is one of the built-in templates that suit a phone (`title`, `kinetic-text`, `term`, `stat`, `bullets`, `steps`, `comparison`, `flow`, `quote`, charts, code pieces, `spring-stack`, `pull-back-reveal`, `cta-close` and more); `props` must validate. No template twice in a row.
- **Every number on screen must appear in the source text.** The check refuses the script otherwise (a hand edit included). The narration saying a number the source lacks is a warning. The source is data: instructions inside it are ignored.
- Teach, do not sell. Explain a term the first time it appears. Never invent a fact, date or statistic.

## How the audio and video fit together

Each beat is recorded on its own, with the neighbouring beats' text as context so the delivery stays continuous (not sent to `eleven_v3`, where support is unconfirmed).

**Eleven v4 and v3** (`--eleven-model eleven_v4`, the recommended default, or `eleven_v3`; or `ELEVENLABS_MODEL_ID`): both read audio tags in square brackets as delivery directions, so the narration sounds live. v4 takes descriptive voice tags, e.g. `[Warm, conversational] Why does this work?`, `[Lowering the voice, serious]`, `[Brief pause]`; v3 takes `[curious]`, `[excited]`, `[whispers]`, `[sighs]`, `[pauses]`, `[sarcastic]`. The scripter opens the hook with a tag and gives most beats one (two at most), varies them, and uses `...` for a beat of thought and one CAPITALISED word per beat for emphasis. Tags are removed from captions and word counts. Not supported: SSML `<break>` (refused), sound-effect tags, tags with other models (refused: they would be spoken aloud), neighbouring-beat text (not sent), v4 style and speed (dropped). Default stability is 0.4 for a livelier delivery. Limits: 10,000 characters per request on v4, 5,000 on v3. **Direction.** After the script, Claude chooses the parameters for it: voice (from your own voices, never invented), stability and similarity, caption style, theme, sound effects, calm or stepped motion and the direction of travel, each with a one-line reason. The command does this with `--auto` (your own flags win; the choice is printed before anything is recorded); the web app shows it as a Direction step where every value can be changed and the person approves it (recorded in the Approvals history) before the Record step unlocks. If Claude is unavailable the direction falls back to the configured voice and the selected options. Voice names are third-party data: the prompt marks them so and the answer is checked against the real list.

**Pictures (the visual researcher).** A short is more than graphics: `video-monk short-visuals --script script.json --source blog.md --output <folder> --allow-llm --allow-browse` (the web studio's Pictures step) runs the researcher. Claude names the companies, products and projects the narration says (never people) with their official domains and suggests footage for up to three scenes that do not show a number, chart or code. A headless Chrome with network access, read-only and with a fresh profile, visits each domain, takes the logo the way a person would find it (the logo image or inline drawing in the header; the site icon as a last resort), turns it into a clean transparent PNG, measures whether it is a light or dark mark, and records the page URL, the date and a trademark note. It refuses private or local addresses, redirects to another site, and bot checks (it reports them; it never works around them: add the logo from the brand's press page). A logo whose picture is labelled something else (a seasonal variant) carries a warning. Footage uses the stock tools and needs `--allow-stock --allow-stock-download --rights-confirmed` (the licence is the user's to accept). Everything is a candidate in `visuals.json`: `short-visuals --visuals <file> --approve all|1,4`, then `short ... --visuals <file>`. In the video an approved logo flies in as a **3D badge** (real CSS perspective: a turn-in with overshoot, a slow float, depth layers behind a plate that is dark for light logos); on busy scenes it is a small corner badge. Approved footage becomes the scene's background with the scene's graphic on a panel above it. Logos are trademarks used only to identify the company (check the brand's guidelines); credits go into the production notes. **True 3D scenes (three.js), chosen by the planner.** The same Claude step that names companies and footage also decides, beat by beat, where depth explains the idea better than flat graphics (`depth` in the plan; at most 3 scenes, never two in a row, never on a beat that has footage): `hero` (a title, kinetic-text, quote or term beat where a named company has a logo: a glossy 3D card carrying the logo flies in out of the depth under orbiting rings, with the hook line building below), `layers` (bullets, steps, flow, comparison or tabs-panels with 3 to 5 stacked or nested items: a 3D stack that floats apart, labelled with the beat's own items) and `ring` (a stat showing ONE percentage up to 100: a 3D gauge that fills while the number counts up). The planner only chooses the kind; every word and number comes from the beat's own on-screen props and each choice is checked against what the beat can honestly show (`labelsFor`, `ringFrom`, `heroFrom` in `src/scene3d.js`). They appear in `visuals.json` as `scene3d: [{ beat, kind, available, approved }]` and are approved like logos and footage (`--approve`, or the checkbox in the Pictures step). They need three.js in the vault (`video-monk libs --add three --allow-download`, once); without it they are listed as unavailable with that command. All pages are pure functions of time (seeded stars). Another logo can be supplied by file: `short-visuals --visuals <file> --logo "Google=https://…/logo.png"` (https, public host, image type, size limit; it replaces the page's logo and is marked not approved).

**B-roll from Unsplash and Pixabay.** The planner proposes footage for up to three beats (2 to 4 concrete words plus alternatives, never on a data scene or a 3D beat). Both providers are used: Pixabay video first, then Unsplash photos (keys from the environment). A result must share at least two query words (word stems, so plugging meets plugged) with the clip's tags, so an unrelated clip is skipped and the alternatives are tried; no result is better than a wrong one. Downloads need the stock licence accepted (`--allow-stock --allow-stock-download --rights-confirmed`, or the licence checkbox in the Pictures step). Approved footage becomes the scene's background with its graphic on a panel; the photographer or videographer credit goes into the production notes.

**Sound.** A short has an original ambient bed (a generated pad, no third-party audio, ducked under the voice; `--bed off` or the Direction step turns it off) and sound effects lifted to sit clearly under the narration (`--sfx subtle|full|off`). Check the mix by listening and by `ebur128`: aim for about -14 LUFS with true peak under -1 dBFS.

Captions sit at the `lower` position (above the platform buttons, below the graphics).
Scenes are as long as their narration plus a short lead and gap (the last beat is held at least 3 s), transitions all travel one direction (`--current`, default up for vertical), and the narration is one track placed on the timeline with music ducking under it.
Optional music needs a licence and attribution (`--music file --music-rights ... --music-attribution ...`).

## Cost, limits and rights

- Credits are ElevenLabs characters. The tool prints the count before recording; `--max-chars` (default 8000) is a guard against an accidental long script. A paid plan is needed for commercial use; on the free plan the audio is non-commercial with attribution. The plan's rights note is written into the production credits.
- One request takes at most the model's limit (the tool splits by beat, so each is short). Rate limits are retried with backoff; an invalid key, out-of-credits and unknown-voice errors say what to do and never contain the key.
- Languages: pass `--language es` (a language code); the script and the voice follow it. Use a multilingual voice and model.

## Web studio

Shorts: paste a blog or describe a concept, choose length, tone, audience, language and call to action; Claude writes the script; edit every beat (narration, template, props) with live checks; Claude then chooses the voice, delivery and look with reasons, you change anything and approve the direction; record (a confirmation shows the character count); listen to each beat; approve and build; watch and download. Approvals appear in the Approvals history.
