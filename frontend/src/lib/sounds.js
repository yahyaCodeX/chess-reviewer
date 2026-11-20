// Plays the audio files listed in soundConfig.js — no synthesis.
//
// Each URL gets a small pool of preloaded <audio> elements, so a sound can
// start instantly and overlap itself when moves are stepped through quickly.

import { CHESS_SOUNDS, PLAY_REVIEW_SOUNDS, RETRY_SOUNDS, REVIEW_SOUNDS, REVIEW_SOUND_DELAY_MS } from './soundConfig.js'

const POOL_SIZE = 3
const VOLUME = 0.8

const pools = new Map() // url → { players: HTMLAudioElement[], next: number }
const broken = new Set() // urls that failed to load — never retried

function pool(url) {
  let p = pools.get(url)
  if (!p) {
    const players = Array.from({ length: POOL_SIZE }, () => {
      const a = new Audio(url)
      a.preload = 'auto'
      a.volume = VOLUME
      a.addEventListener('error', () => broken.add(url), { once: true })
      return a
    })
    p = { players, next: 0 }
    pools.set(url, p)
  }
  return p
}

/** Play an audio file by URL. Silently does nothing if it can't. */
export function playUrl(url) {
  if (!url || broken.has(url) || typeof Audio === 'undefined') return
  const p = pool(url)
  const audio = p.players[p.next]
  p.next = (p.next + 1) % p.players.length
  try {
    audio.currentTime = 0
    const played = audio.play()
    played?.catch?.(() => {}) // autoplay blocked or file missing
  } catch {
    // ignore
  }
}

/** Start loading every configured sound so the first plays are instant. */
export function preloadSounds() {
  const review = PLAY_REVIEW_SOUNDS ? Object.values(REVIEW_SOUNDS) : []
  for (const url of [...Object.values(CHESS_SOUNDS), ...review]) {
    if (url && !broken.has(url)) pool(url)
  }
}

/** Board sound key for a move, from its SAN. */
export function boardSoundFor(san = '') {
  if (san.includes('#')) return 'gameEnd'
  if (san.includes('+')) return 'check'
  if (san.includes('=')) return 'promote'
  if (san.startsWith('O-O')) return 'castle'
  if (san.includes('x')) return 'capture'
  return 'move'
}

/** Board sound for a move, then its review sound (if the rating has one). */
export function playMoveSounds(san, cls) {
  playUrl(CHESS_SOUNDS[boardSoundFor(san)])
  const review = PLAY_REVIEW_SOUNDS && cls && REVIEW_SOUNDS[cls]
  if (review) setTimeout(() => playUrl(review), REVIEW_SOUND_DELAY_MS)
}

export const playBoardSound = key => playUrl(CHESS_SOUNDS[key])
export const playRetrySound = key => playUrl(RETRY_SOUNDS[key])
