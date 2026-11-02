# Review loops: producer ⇄ reviewer per stage, one lead loop

Every stage has two roles that must not be the same agent: a **producer** that makes the artifact and an independent **reviewer**
that sees only the artifact and the criteria. A **lead** (the editor/producer agent, or `video-monk auto`) orders the stages and sends
feedback back to whoever owns the problem.

```
transcript ──► cut ──► storyboard ──► render
   ▲  │         ▲ │        ▲ │           │
   └──┘         └─┘        └─┘           │   each stage: produce → review → (rejected) → producer revises ONLY
        ▲___________________________________┘  the flagged parts → review again (max 3 rounds, then a human decides)
          findings owned by an earlier stage are routed there; downstream stages are then re-produced
```

## Automatic (`video-monk auto`, on by default)

`--review-loop off` skips it, `--max-rounds N` (default 3), `--review-agent claude --allow-llm` adds an independent Claude reviewer
(transcript misheard terms, storyboard teaching quality, visual review of rendered frames). Every round lands in `loop-ledger.json`
and a readable `REVIEW-LOOP.md`. If a stage is still rejected after the round limit the run stops with `needs-human`.

## In a Claude Code conversation (subagents)

1. Producer agent writes the artifact (words.json, edit manifest, storyboard, render folder).
2. `video-monk-stage-reviewer` runs the deterministic check and adds its own judgment:
   `video-monk review --stage <stage> ... --output review-<stage>-<round>.json --ledger loop-ledger.json --round <n>`
   (arguments per stage are in `video-monk review --help`). It returns the verdict JSON; it never edits the artifact.
3. If `rejected`, the producer reads the findings, changes **only** the targets they name (scene, item, word, window), and records what
   changed: `video-monk review ... --record-revision "split scene 12; dropped g07"` on the next review.
4. Repeat up to 3 rounds. Then escalate to the user with the open findings and what was tried.
5. A finding with `owner` ≠ the reviewed stage goes to that stage's producer; re-produce downstream stages afterwards.

## Finding schema (shared by code, Claude and subagent reviewers)

```json
{ "id": "cut-quiet-12-33.20", "severity": "blocker | major | minor", "owner": "cut",
  "target": { "scene": 12, "source": [33.2, 33.5] }, "message": "scene 12 keeps a 0.30 s quiet stretch",
  "suggestion": "cut the quiet stretch", "fix": { "op": "removeQuiet", "range": 11, "from": 33.2, "to": 33.5 } }
```
Rejected = any blocker or major. Minors are notes. `fix` is optional and machine-applicable.

## What each reviewer checks

| Stage | Checks (code) | Fix ops |
|---|---|---|
| transcript | timestamps ordered; plausible words/min; stutters; glossary near-misses (`--glossary`) | `replaceWord`, `dropWord` |
| cut | quiet stretches over the pace limit (natural 0.6 s, tight 0.25 s, extra 0.18 s); clearly voiced audio kept ≥ 99.5%; choppy segments; pace note | `removeQuiet`, `restore`, `mergeNeighbors` |
| storyboard | numbers the speaker never said (blocker); labels not in the transcript; overlaps/bounds; cutaways ≤ 22% of the video; empty stretches that have a fillable idea; style share caps | `dropItem`, `toPanel`, `setProps`, `fillWindow` |
| render | technical checks (decode, size, fps, duration, loudness, true peak); black frames; dead air in the final audio; captions present | route to storyboard `dropItem` / cut `removeQuiet`, or rebuild |

Visual review (Claude reviewer or a subagent reading `contact-sheet.png` and sampled frames): text clipped or overlapping, graphics
covering something important, unreadable small text, caption collisions, empty or broken frames, style drift. Four basic checks from the
community video-skill tests apply to every render: it plays, it has the requested length and size, all on-screen copy is readable,
and the picture moves.

## Reviewer rules

- Independent: do not read the producer's reasoning; judge the artifact against the criteria.
- Report only real problems; rank them; return an empty list when the work is good.
- A rejection must say what to change and where. Never reject with "make it better".
- The producer must not argue a finding away; if it disagrees it escalates to the lead with evidence.
