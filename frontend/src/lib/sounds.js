// Move sounds synthesised with the Web Audio API — no audio files to ship
// or license. Each sound is a short burst of filtered noise ("wood knock")
// plus an optional tone.

let ctx = null

function audio() {
  if (typeof window === 'undefined') return null
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return null
  ctx ??= new AC()
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

function knock(ac, at, { freq = 900, gain = 0.5, length = 0.07 } = {}) {
  const frames = Math.floor(ac.sampleRate * length)
  const buffer = ac.createBuffer(1, frames, ac.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frames, 4)
  const src = ac.createBufferSource()
  src.buffer = buffer
  const filter = ac.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = freq
  filter.Q.value = 1.2
  const g = ac.createGain()
  g.gain.value = gain
  src.connect(filter).connect(g).connect(ac.destination)
  src.start(at)
}

function tone(ac, at, freq, length = 0.12, gain = 0.12, type = 'sine') {
  const osc = ac.createOscillator()
  osc.type = type
  osc.frequency.value = freq
  const g = ac.createGain()
  g.gain.setValueAtTime(gain, at)
  g.gain.exponentialRampToValueAtTime(0.0001, at + length)
  osc.connect(g).connect(ac.destination)
  osc.start(at)
  osc.stop(at + length + 0.02)
}

const SOUNDS = {
  move: (ac, t) => knock(ac, t, { freq: 700, gain: 0.55 }),
  capture: (ac, t) => {
    knock(ac, t, { freq: 1100, gain: 0.6 })
    knock(ac, t + 0.045, { freq: 600, gain: 0.45 })
  },
  castle: (ac, t) => {
    knock(ac, t, { freq: 700, gain: 0.5 })
    knock(ac, t + 0.09, { freq: 750, gain: 0.5 })
  },
  check: (ac, t) => {
    knock(ac, t, { freq: 800, gain: 0.5 })
    tone(ac, t + 0.02, 880, 0.14, 0.08, 'triangle')
  },
  end: (ac, t) => {
    tone(ac, t, 523, 0.18)
    tone(ac, t + 0.12, 392, 0.3)
  },
  correct: (ac, t) => {
    tone(ac, t, 660, 0.12)
    tone(ac, t + 0.1, 990, 0.22)
  },
  wrong: (ac, t) => tone(ac, t, 220, 0.22, 0.1, 'triangle'),
}

/** The sound a move should make, from its SAN. */
export function soundForSan(san = '') {
  if (san.includes('#')) return 'end'
  if (san.includes('+')) return 'check'
  if (san.startsWith('O-O')) return 'castle'
  if (san.includes('x')) return 'capture'
  return 'move'
}

export function playSound(name) {
  try {
    const ac = audio()
    if (ac && SOUNDS[name]) SOUNDS[name](ac, ac.currentTime + 0.01)
  } catch {
    // audio unavailable (autoplay policy, old browser) — stay silent
  }
}
