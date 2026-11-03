# The shorts pipeline: agents on a queue, a reviewer for every stage, and a studio that learns

`video-monk short-pipeline` (and the Pipeline panel on every short in the web studio) is the careful way to make a short. It is slow on purpose: nothing is rushed, a 3D page or a recording takes as long as it takes, and a person approves the things only a person should approve.

## Agents never call each other: they react to events

Every event is stored in the database queue (`pipeline_jobs`). When an event is published, each agent subscribed to its type gets its own job. One job runs at a time, with no deadline. A restart loses nothing (jobs left running go back to pending), a failing job retries with growing delays and then lands as `dead` where `short-pipeline` / the panel can retry it.

```
short.requested ─► script-writer ─► script.written ─► script-reviewer ─► script.approved | script.revise (back to the writer, with the findings)
script.approved ─► director ─► direction.proposed ─► direction-reviewer ─► direction.ready | direction.revise
direction.ready ─► visual-planner [waits: direction] ─► visuals.researched ─► visual-reviewer ─► visuals.ready | visuals.revise | visuals.skipped
visuals.ready   ─► narrator [waits: visuals, spend] ─► audio.recorded ─► audio-reviewer ─► audio.ready | script.revise | needs.human
audio.ready     ─► producer [waits: audio] ─► plan.ready ─► plan-reviewer ─► plan.reviewed | audio.ready (re-plan)
plan.reviewed   ─► renderer [waits: plan] ─► render.done ─► final-reviewer ─► short.completed | audio.ready (fix, re-plan, re-render) | needs.human
```

## The team

Each agent is named, as a homage, after a person known for that craft (the names are labels in the UI and logs, not impersonations). All of them use Claude Opus 5.5 (`claude-opus-5-5`; set `VIDEO_MONK_CLAUDE_MODEL` to change it), and the installed agent definitions say `model: opus`.

| Agent | Named for | Does |
|---|---|---|
| script-writer | Carl Sagan | writes and revises the script |
| script-reviewer | Maxwell Perkins | reviews the script |
| director | Alfred Hitchcock | voice, delivery and look |
| direction-reviewer | Roger Ebert | reviews the direction |
| visual-planner | Paul Rand | logos, footage, 3D plan |
| visual-reviewer | Massimo Vignelli | reviews the pictures (looks at them) |
| narrator | Orson Welles | records the narration |
| audio-reviewer | Les Paul | checks the recording against the script |
| producer | Sergei Eisenstein | plans the video |
| plan-reviewer | Dede Allen | reviews the plan |
| renderer | Georges Méliès | builds the video |
| final-reviewer | Pauline Kael | reviews the finished video, frame by frame |

## Gates: what only the person can allow

A job that needs the person parks as `waiting` on a named gate and wakes the moment the gate is granted. Gates: `llm` (text goes to Claude: scripts, reviews, planning), `browse` (a browser visits company websites), `stock` (stock search and download; also accepts the provider's licence), `spend` (ElevenLabs credits, with a character cap; one go-ahead covers one recording), `direction`, `visuals`, `audio` (you have listened), `plan` (approve and build; quality draft or final). Each grant is explicit and recorded; nothing is granted by default.

## Reviewers: independent, per stage, with a feedback loop

Each reviewer sees only the artifact. Code checks run first; Claude adds a review when `llm` is granted (it can look at images for pictures and frames). Findings use the shared schema plus a stable `code` (for example `script.hook-long`) and, where possible, a general `lesson`.

| Stage | What is checked |
|---|---|
| script | the template rules and sourcing (numbers on screen must be in the source), hook at most 14 words, word budget for the length, 6 to 9 beats, text that reads badly aloud (symbols, links, abbreviations), audio tags (too few, repeated), template variety; Claude: faithfulness, teaching, tone |
| direction | the voice exists on the account, the model reads audio tags, stability fits the tone, sound effects fit; simple problems are fixed in code, the rest goes back to the director |
| pictures | each logo is on a beat whose narration says the brand, is not blank, has a recorded source, carries no "seasonal variant" warning; footage has a credit and is never behind a number, chart or code; Claude looks at the images |
| narration | too long for the length, pace, clipping, the recording transcribed with whisper.cpp and compared with the script (match rate), tags read aloud |
| plan | validates, scene count, total length, credits for logos and footage, rights on assets, narration, captions, music bed |
| finished video | size, audio, duration against the plan, loudness (about -14 LUFS), true peak, dead air, black frames, on-screen readability audit, then a Claude review of the contact sheet and a still from every scene |

A reviewer that finds a blocker or major problem sends it back to the agent that made the work, with exactly what to fix and the previous version; the agent changes only that. After three rounds it comes to the person (`needs.human`). Problems the pipeline can fix for free it fixes: drop a flagged logo or clip, lower stability, switch the model, then re-plan and re-render. A problem that needs new recordings (credits) or a different script waits for the person. When a short comes to the person, `--resume [--note "..."]` (or "Let them try again" in the panel) gives every stage a fresh set of rounds and sends the open findings, plus the note, back to the agent that stopped.

## Learning

The script budget is measured, not guessed: Eleven v4/v3 with audio tags and pauses speaks about 1.85 words a second (2.5 without tags), so the writer is told the right number of words for the length. (This came from the reviewers: the first production ran a third too long twice before the rate was fixed.)


Every review is stored. A finding seen twice becomes a lesson: a short rule put in front of the producing agent the next time it works on that stage (the script writer, the director and the visual planner read them). Lessons are measured: each time one is applied, the next review shows whether the problem stayed away (`held`) or came back (`recurred`); one that keeps coming back is marked ineffective and waits for a better wording. What persists is under the person's control: rules written by this toolkit's own checks become active after two sightings; rules written by a Claude reviewer wait as `proposed` until approved (a model that has read the source text must not be able to plant standing instructions); rules the person writes as feedback are active at once; "the reviewer was wrong" lowers a finding's standing. Lessons are cleaned (no links or code, capped, anything that reads like an instruction aimed at the agent is refused) and are guidance, never instructions from the source. See them, edit them, turn them off in the Lessons page or with `short-pipeline --lessons`.

## Commands

```
video-monk short-pipeline --create --source blog.md --length 45 --eleven-model eleven_v4
video-monk short-pipeline --id <sid> --start --allow-llm --allow-browse [--allow-stock --rights-confirmed] [--allow-eleven --max-chars 3000] [--script script.json]
video-monk short-pipeline --id <sid> --run                  # works through everything that is ready, slowly, then reports what is waiting
video-monk short-pipeline --id <sid> --grant direction,visuals,audio,plan --quality final
video-monk short-pipeline --id <sid> --feedback "Explain acronyms the first time" --stage script
video-monk short-pipeline --lessons [--stage script] [--approve <id> | --disable <id> | --delete <id>]
```
`--script` starts from a script you already have (the writer is skipped; the reviewer still reviews it). `--seed-audio <folder>` reuses recordings you already paid for.
