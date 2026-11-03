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

**Eleven v4 and v3** (`--eleven-model eleven_v4`, the recommended default, or `eleven_v3`; or `ELEVENLABS_MODEL_ID`): both read audio tags in square brackets as delivery directions, so the narration sounds live. v4 takes descriptive voice tags, e.g. `[Warm, conversational] Why does this work?`, `[Lowering the voice, serious]`, `[Brief pause]`; v3 takes `[curious]`, `[excited]`, `[whispers]`, `[sighs]`, `[pauses]`, `[sarcastic]`. The scripter opens the hook with a tag and gives most beats one (two at most), varies them, and uses `...` for a beat of thought and one CAPITALISED word per beat for emphasis. Tags are removed from captions and word counts. Not supported: SSML `<break>` (refused), sound-effect tags, tags with other models (refused: they would be spoken aloud), neighbouring-beat text (not sent), v4 style and speed (dropped). Default stability is 0.4 for a livelier delivery. Limits: 10,000 characters per request on v4, 5,000 on v3. Captions sit at the `lower` position (above the platform buttons, below the graphics).
Scenes are as long as their narration plus a short lead and gap (the last beat is held at least 3 s), transitions all travel one direction (`--current`, default up for vertical), and the narration is one track placed on the timeline with music ducking under it.
Optional music needs a licence and attribution (`--music file --music-rights ... --music-attribution ...`).

## Cost, limits and rights

- Credits are ElevenLabs characters. The tool prints the count before recording; `--max-chars` (default 8000) is a guard against an accidental long script. A paid plan is needed for commercial use; on the free plan the audio is non-commercial with attribution. The plan's rights note is written into the production credits.
- One request takes at most the model's limit (the tool splits by beat, so each is short). Rate limits are retried with backoff; an invalid key, out-of-credits and unknown-voice errors say what to do and never contain the key.
- Languages: pass `--language es` (a language code); the script and the voice follow it. Use a multilingual voice and model.

## Web studio

Shorts: paste a blog or describe a concept, choose length, tone, audience, language, theme, captions, sound effects, direction and call to action; Claude writes the script; edit every beat (narration, template, props) with live checks; load your ElevenLabs voices, pick a voice and model, adjust stability, similarity, style and speed; record (a confirmation shows the character count); listen to each beat; approve and build; watch and download. Approvals appear in the Approvals history.
