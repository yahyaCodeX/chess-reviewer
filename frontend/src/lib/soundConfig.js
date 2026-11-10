// ─── Sound map ──────────────────────────────────────────────────────────────
// Every sound the app plays, in one place. Each value is a URL to an audio
// file (.mp3 / .ogg / .wav). Paths starting with "/sounds/" are served from
// frontend/public/sounds/ — drop files there with these names, or replace a
// value with any absolute URL you have the rights to use.
//
// A missing or unreachable file is simply skipped (no error, no fallback).

/** Board sounds — played for every move you land on. */
export const CHESS_SOUNDS = {
  move: '/sounds/move.wav',
  capture: '/sounds/capture.wav',
  check: '/sounds/check.wav',
  castle: '/sounds/castle.wav',
  promote: '/sounds/promote.wav',
  gameEnd: '/sounds/game-end.wav',
  illegal: '/sounds/illegal.wav', // Retry mode: an illegal move
  premove: '/sounds/premove.wav', // reserved (the reviewer has no live play)
}

/** Review sounds — played right after the board sound, by move rating. */
export const REVIEW_SOUNDS = {
  brilliant: '/sounds/brilliant.wav',
  great: '/sounds/great.wav',
  excellent: '/sounds/excellent.wav',
  book: '/sounds/book.wav',
  inaccuracy: '/sounds/inaccuracy.wav',
  mistake: '/sounds/mistake.wav',
  miss: '/sounds/miss.wav',
  blunder: '/sounds/blunder.wav',
  // best, good and forced have no review sound
}

/** Retry mode results reuse review sounds. */
export const RETRY_SOUNDS = {
  correct: REVIEW_SOUNDS.great,
  wrong: REVIEW_SOUNDS.mistake,
}

/** Delay between the board sound and the review sound (ms). */
export const REVIEW_SOUND_DELAY_MS = 120
