# Brand intake and MOTION.md

Run once per brand. The result is two files every later job reads first: `brand.json` (what the toolkit consumes) and `MOTION.md` (what an agent reads before it animates).

## The interview: two batches, then stop

Start straight away with batch 1 as your first message; no summary of the skill. Wait for answers each time.

**Batch 1**
1. The brand's name and what it does, in one line.
2. Who watches: one sentence about that person.
3. What the videos promote (the offer, product or newsletter), with its real link.
4. What viewers should feel in the first second (up to three: calm, premium, playful, urgent, technical, warm, bold).

**Batch 2**
5. Colours as hex codes, font files, logo files (SVG or PNG). With no hex codes, ask for a link to sample from.
6. Three to five reference frames of motion they like (screenshots in a folder).
7. One thing the motion must never do.

If an answer is blank, ask once more, then move on. **Never fill a gap with a guess.**

## Write the files

```
video-monk brand --output brand-kit --name "Acme Studio" \
  --background #0b0d12 --surface #151d33 --text #f4f6fb --muted #9aa5bd --accent #ff5a1f \
  --font ./Brand-Sans.woff2 --logo ./logo.png --feel "calm, premium" \
  --never "glow; bounce; typewriter headlines; stock icons; purple gradients" [--on-twos] [--calm]
```

`brand.json` carries the theme tokens, the logo bug and motion flags: pass it with `--brand brand-kit/brand.json` to `auto` or `autocut`. `MOTION.md` has the colours and what each is for, type, timing and movement, finish, the never list and one example; anything not given says `ASK ME`.
Read the reference frames and fill the gaps in `MOTION.md` yourself from what is visible (timing, easing, texture, one shot-by-shot example); where you cannot tell, keep `ASK ME`. Show the user the file before saving it.

Add this block to the project's CLAUDE.md so it is read first:

```
Before designing, generating or animating anything, read MOTION.md in full.
Every colour, font, timing and motion value comes from that file.
The file sets the look, not the ambition. When I say go all out, go all out.
If something I ask for is not covered there, ask me rather than choosing for yourself.
When you have finished, check your own frames against MOTION.md, fix what fails, and only then show me.
```

## Lessons

- **Mixed frames give mixed looks.** If the references hold several looks, name them and ask which to use, or which look goes with which job.
- **The ambition line is not optional.** Without "the file sets the look, not the ambition", results come out too polite.
- **`ASK ME` is a feature.** With the file in place, a one-line request should stop and ask, not guess.
- **Sampled hex codes drift.** A colour read off a JPEG is a few points out; use typed hex codes wherever they exist.
- **Prove it** (optional): run the same one-line request in an empty folder and in the project. Both should go all out; only one should look like the brand.
