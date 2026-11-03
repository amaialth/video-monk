# Script verification: fix what the recogniser got wrong, in context

Speech recognition spells what it *hears*. A speaker who says "REST" may be transcribed as "wrist" or "rist", "Redis" as "red is", "JSON" as
"Jason", "Kafka" as "coffee a", "Apache Camel" as "a patchy camel". Captions, graphics and the storyboard are built from these words, so a
mistake is shown on screen in large type. Verify the script after transcription and **before** `autocut` (corrections are made on the
source-relative `words.json`, so every later stage inherits them).

## Procedure

1. **Get the context.** Topic and title, the audience, and a glossary: product names, acronyms, people, jargon. Ask the user for terms in one
   short question (AskUserQuestion with "Other" for typing) when the topic is technical. Add terms you can infer from the title, the brief and any
   slides or on-screen text you were given. Write them one per line; add hints that show the term is meant:

   ```
   REST | api; http; endpoint; server
   Redis
   Apache Camel | integration; route
   ```

2. **Find candidates.** `video-monk script-check --words words.json --glossary terms.txt --output fixes.json` proposes sound-alike and near-spelling
   fixes with reasons. These are candidates only: the code knows sound, not meaning.
3. **Read the whole transcript as text** (join the words, keep the indexes) and judge each candidate and anything the glossary missed:
   - *Sound-alikes of technical terms* (the table below).
   - *Split or merged words* ("red is", "pub sub" vs "pub/sub", "a patchy").
   - *Numbers and units* ("sixty four" vs 64, "K B" vs KB) and versions.
   - *Grammar the transcriber broke* (a/an, missing or wrong plural caused by a mishear, missing sentence capital, acronyms in lowercase).
4. **Decide in context, never by sound alone.** "Wrist" stays in "my wrist hurts"; "rist" and "wrist" become REST when the sentence is about APIs, endpoints or
   HTTP. If it could be either, keep the original and put it in the "ask the user" list with the timestamp.
5. **Write `fixes.json`** and apply it: `video-monk script-fix --words words.json --fixes fixes.json --output words.corrected.json`. Ops: replace one word
   (`index`, `to`), replace a span with one term (`index`, `count`, `to`), `drop`, or replace a `phrase` everywhere. Every fix has a `reason`. Timing is kept.
6. **Show the log** (`words.corrected.fixes.md`, before / after / why) to the user and get a yes on the ambiguous ones. Re-run
   `video-monk review --stage transcript --words words.corrected.json --glossary terms.txt` (expect no findings), then continue with
   `autocut --words words.corrected.json` (or `auto --words words.corrected.json --glossary terms.txt`).
7. **After the cut**, wording found wrong later is fixed with `captions.fixes` (`replace` / `drop`) in the manifest, and the storyboard is re-planned from the corrected words.

## Common mishearings (check these first)

| Spoken | Often transcribed as |
|---|---|
| REST, RESTful | wrist, rist, rest, wrest, "arrest" |
| API / APIs | "a p i", "ape eye", "happy" (rare) |
| JSON | Jason, "J son" |
| SQL | sequel (both are valid; follow the speaker's spelling in the glossary) |
| Redis | "red is", "radius" |
| Kafka | "coffee", "Kafka" lowercased |
| Kubernetes / k8s | "cooper nettys", "kubernetes" misspelt |
| OAuth | "oh auth", "o off" |
| nginx | "engine x", "engine next" |
| cache | cash |
| GraphQL | "graph Q L", "graph kill" |
| Docker | "doctor" |
| pub/sub | "pub sub", "pubs up" |
| Apache Camel | "a patchy camel", "apache camera" |

## Boundaries

- Fix **mishearings**, not the speaker's style. Do not rewrite sentences, remove dialect or "improve" word choice. If the speaker really said something
  wrong, flag it to the user; do not silently change what was said.
- The audio is not changed. A corrected caption of a mispronounced word is right for readers, but tell the user when you changed a word the speaker pronounced differently.
- Never invent a term that is not in the glossary or clearly implied by context. Unsure: ask.
- Names of people and companies: take the spelling the user gives; do not guess.
- A wrong correction is worse than a missed one: when in doubt, leave it and list it.
