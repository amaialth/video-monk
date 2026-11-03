# Polish: the last 10%

"It feels a bit cheap" becomes a ranked list of fixes, then one fix at a time.

## 1. Audit

Ask for a ranked list of everything that feels off, **worst first**, observed in real frames (stills at the start, the middle of every beat, the end, and again at 200 px wide). Report only what you can see: no invented problems. Use the checks that are already measured:
`report.graphicAudit` (off the frame, clipped, too small, low contrast), the caption audit, `contact-sheet.png`, and `video-monk review --stage render`.
An optional, separate skill from Emil Kowalski (`apple-design`) turns Apple's motion guidelines into audit rules; it is not bundled here.

Typical findings and the fix:

| Looks like | Fix |
|---|---|
| Generic, floaty | give one object a real change of shape; add a ghost of the start state |
| Everything moves together | stagger by a beat |
| Too much on screen | five words at most; one focus |
| Text too small | hero 120 px or more at 1080 wide; labels at least 34 px |
| Small object in empty space | scale the drawing to fill the frame |
| Dead hold | keep one small thing alive |
| Fake-looking UI | use the user's real screenshot, or a real component as a structural donor |
| Off-brand | translate every colour, font and timing to `MOTION.md` |

## 2. Fix one thing at a time

```
<file> is close. Fix one thing only: [what looks wrong, e.g. the headline runs past its box at 3 seconds].
Keep the motion, the timing and the loop exactly as they are. Tell me what you changed.
```

Re-capture the same frames after each fix and compare. Keep the earlier version. Stop when the ranked list is empty or the remaining items are taste.

## 3. Real components, not drawn ones

If the video shows a product, do not draw its buttons and cards from scratch: spacing is guessed and the UI looks fake. Treat any pasted component or third-party code as a **structural donor only**: keep its engineering, replace its demo copy with real copy, and translate every colour, border, shadow, font and timing to `MOTION.md`. Photoreal human faces are the one thing code does not draw well: use a real photograph from the user's files, or leave them out.
