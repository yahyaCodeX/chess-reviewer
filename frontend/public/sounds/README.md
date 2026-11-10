# Sounds

The app plays audio files only. Every sound is listed in
[`src/lib/soundConfig.js`](../../src/lib/soundConfig.js), and by default each
one points to a file in this folder. Add files with these names; any that are
missing are simply skipped.

**Board sounds**, for every move you land on:

| File | When |
|---|---|
| `move.mp3` | normal move |
| `capture.mp3` | capture |
| `check.mp3` | check |
| `castle.mp3` | castling |
| `promote.mp3` | promotion |
| `game-end.mp3` | checkmate |
| `illegal.mp3` | illegal move in Retry mode |
| `premove.mp3` | reserved (not used yet) |

**Review sounds**, played right after the board sound:

| File | Move rating |
|---|---|
| `brilliant.mp3` | Brilliant (!!) |
| `great.mp3` | Great (!), and a correct answer in Retry |
| `excellent.mp3` | Excellent |
| `book.mp3` | Book |
| `inaccuracy.mp3` | Inaccuracy (?!) |
| `mistake.mp3` | Mistake (?), and a wrong answer in Retry |
| `miss.mp3` | Miss |
| `blunder.mp3` | Blunder (??) |

To use a different name, format or an absolute URL, edit `soundConfig.js`.
Keep files short (under about 0.5 s) with no silence at the start.

**Licensing:** this site is public, so only use sounds you have the right to
publish, such as CC0 files from freesound.org or a pack you bought.
