// ─── Sound map ──────────────────────────────────────────────────────────────
// Every sound the app plays, in one place. Each value is a URL to an audio
// file (.mp3 / .ogg / .wav). Paths starting with "/sounds/" are served from
// frontend/public/sounds/ — drop files there with these names, or replace a
// value with any absolute URL you have the rights to use.
//
// A missing or unreachable file is simply skipped (no error, no fallback).

/** Board sounds — played for every move you land on. */
export const CHESS_SOUNDS = {
  move: '/sounds/move.mp3',
  capture: '/sounds/capture.mp3',
  check: '/sounds/check.mp3',
  castle: '/sounds/castle.mp3',
  promote: '/sounds/promote.mp3',
  gameEnd: '/sounds/game-end.mp3',
  illegal: '/sounds/illegal.mp3', // Retry mode: an illegal move
  premove: '/sounds/premove.mp3', // reserved (the reviewer has no live play)
}

/** Review sounds — played right after the board sound, by move rating. */
export const REVIEW_SOUNDS = {
  brilliant: '/sounds/brilliant.mp3',
  great: '/sounds/great.mp3',
  excellent: '/sounds/excellent.mp3',
  book: '/sounds/book.mp3',
  inaccuracy: '/sounds/inaccuracy.mp3',
  mistake: '/sounds/mistake.mp3',
  miss: '/sounds/miss.mp3',
  blunder: '/sounds/blunder.mp3',
  // best, good and forced have no review sound
}

/** Retry mode results reuse review sounds. */
export const RETRY_SOUNDS = {
  correct: REVIEW_SOUNDS.great,
  wrong: REVIEW_SOUNDS.mistake,
}

/** Delay between the board sound and the review sound (ms). */
export const REVIEW_SOUND_DELAY_MS = 120
