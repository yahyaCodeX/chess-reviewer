# Move sounds

Drop recorded sounds here to replace the built-in synthesised ones.
Any file that is missing falls back to the synthesised sound.

| File name | Played when |
|---|---|
| `move.mp3` | a normal move |
| `capture.mp3` | a capture |
| `castle.mp3` | castling |
| `check.mp3` | a check |
| `end.mp3` | checkmate |
| `correct.mp3` | Retry: you found the best move |
| `wrong.mp3` | Retry: wrong move |

**Review cues** play right after the piece sound when you land on a rated move:

| File name | Move rating |
|---|---|
| `brilliant.mp3` | Brilliant (!!) |
| `great-move.mp3` | Great (!) |
| `excellent.mp3` | Excellent (falls back to `great-move` if missing) |
| `book.mp3` | Book |
| `inaccuracy.mp3` | Inaccuracy (?!) |
| `mistake.mp3` | Mistake (?) |
| `blunder.mp3` | Blunder (??) |
| `miss.mp3` | Miss |

Best, Good and Forced moves get no cue, only the piece sound.

`.ogg` and `.wav` work too (e.g. `move.ogg`). Keep each file short (under 0.5 s)
and quiet at the start, so it plays exactly when the piece lands.

**Licensing:** only use sounds you have the right to publish, such as CC0 files from
freesound.org (filter by "Creative Commons 0") or a pack you bought. Don't copy
chess.com's or Lichess's standard sounds; they aren't licensed for reuse.
