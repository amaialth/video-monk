# Asset library: index everything generated, reuse it everywhere

Everything the pipeline makes can be found and reused by other projects instead of regenerated. Default root
`~/.video-monk/library` (`VIDEO_MONK_LIBRARY=<dir>` to move it, `VIDEO_MONK_LIBRARY=off` to disable).

```
index.json                  entries: id, kind, name, description, tags, rights, attribution, sha256, bytes, uses, meta
objects/<kind>/<id>/...     the files themselves
```

## What is indexed automatically

| Kind | Created by | Reuse |
|---|---|---|
| `graphic` | every rendered motion graphic (template, props, text, size, fps, theme) | the next build with an identical graphic skips rendering entirely |
| `transcript` | `transcribe` (media hash + model + language + prompt) | the same recording is never transcribed twice |
| `storyboard` | `storyboard` / `auto` | a Claude storyboard for the same transcript and settings is reused, so the paid call is not repeated |

## What you or the librarian agent add

Licensed music, SFX, images, fonts and anything hand-made, with rights recorded once:

```
video-monk assets --add bed.mp3 --kind audio --name "Ambient bed" --tags music,calm,loopable \
  --rights "YouTube Audio Library, free to use" --attribution "Artist - Track" --source-url <url> --approved
video-monk assets --search "calm music" --kind audio        # find before you generate or download
video-monk assets --get <id> --output project/media/bed.mp3  # copies it out and prints a ready manifest asset entry
video-monk assets --export <graphic id> --output chart.mov   # a cached graphic as ProRes alpha / mp4 / png
video-monk assets --stats ; video-monk assets --prune --older-than-days 90 --yes
```

`--approved` records that you confirmed the rights. Assets added without it get `approved: false` in the manifest entry until you decide.
Prune removes only generated kinds (graphic, transcript, storyboard, thumbnail), oldest first; user-added audio, image, video and
font assets are never pruned.

## Librarian protocol

1. Before generating or downloading anything, `assets --search` for it. Reuse beats regeneration.
2. After a stage, make sure its outputs are indexed (graphics, transcripts and storyboards are automatic; add stems, thumbnails and
   licensed files by hand with tags, rights and the source URL).
3. Tag with the topic and the use (`music`, `kafka`, `flow`, `intro`), so other projects can find them.
4. Never mark rights approved on the user's behalf.
