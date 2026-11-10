// Move sounds + review sounds.
//
// Two kinds of sound play when you step onto a move:
//   • the piece sound  — move / capture / castle / check / end
//   • the review cue   — brilliant / great-move / excellent / book /
//                        inaccuracy / mistake / blunder / miss
//                        (forced, best and good get no cue)
//
// 1. Recorded files win: drop e.g. `brilliant.mp3` or `move.mp3` (.ogg/.wav
//    also work) into frontend/public/sounds/ and it is used automatically.
// 2. Otherwise each sound is synthesised below.

const NAMES = [
  'move', 'capture', 'castle', 'check', 'end', 'correct', 'wrong',
  'brilliant', 'great-move', 'excellent', 'book', 'inaccuracy', 'mistake', 'blunder', 'miss',
]
const EXTENSIONS = ['mp3', 'ogg', 'wav']
const MAKEUP_GAIN = 2.2

let ctx = null
let master = null
const samples = {} // name → AudioBuffer | null (null = no file, use synth)
let loading = null

function audio() {
  if (typeof window === 'undefined') return null
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return null
  ctx ??= new AC()
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

/** Look for recorded sounds once. Missing files (or an SPA's index.html) are ignored. */
function loadSamples(ac) {
  loading ??= Promise.all(
    NAMES.map(async name => {
      for (const ext of EXTENSIONS) {
        try {
          const res = await fetch(`/sounds/${name}.${ext}`)
          const type = res.headers.get('content-type') || ''
          if (!res.ok || type.includes('text/html')) continue
          samples[name] = await ac.decodeAudioData(await res.arrayBuffer())
          return
        } catch {
          // not decodable — try the next extension
        }
      }
      samples[name] = null
    }),
  )
  return loading
}

// ── Building blocks ─────────────────────────────────────────────────────────

/** Optional low-pass in front of `out` (for muted / dull sounds). */
function muffled(ac, out, cutoff) {
  if (!cutoff) return out
  const lp = ac.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = cutoff
  lp.connect(out)
  return lp
}

function noiseBuffer(ac, seconds) {
  const frames = Math.max(1, Math.floor(ac.sampleRate * seconds))
  const buffer = ac.createBuffer(1, frames, ac.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1
  return buffer
}

// Modes of a small wooden bar: frequency ratio, relative loudness, decay (s)
const WOOD_MODES = [
  [1.0, 1.0, 0.075],
  [2.57, 0.42, 0.045],
  [4.21, 0.2, 0.03],
  [6.1, 0.08, 0.02],
]

/** One wooden knock: a short contact click plus fast-decaying partials. */
function tock(ac, out, at, { pitch = 620, gain = 0.6, body = 1, cutoff = 0 } = {}) {
  const dest = muffled(ac, out, cutoff)

  const click = ac.createBufferSource()
  click.buffer = noiseBuffer(ac, 0.003)
  const hp = ac.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 2500
  const clickGain = ac.createGain()
  clickGain.gain.setValueAtTime(gain * 0.35, at)
  clickGain.gain.linearRampToValueAtTime(0, at + 0.003)
  click.connect(hp).connect(clickGain).connect(dest)
  click.start(at)

  for (const [ratio, level, decay] of WOOD_MODES) {
    const osc = ac.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(pitch * ratio * 1.015, at)
    osc.frequency.exponentialRampToValueAtTime(pitch * ratio, at + 0.02) // tiny pitch drop on impact
    const g = ac.createGain()
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(gain * level * 0.5, at + 0.001)
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay * body)
    osc.connect(g).connect(dest)
    osc.start(at)
    osc.stop(at + decay * body + 0.02)
  }
}

/** A struck bell / chime: fundamental plus a few overtones. */
function bell(ac, out, at, freq, { length = 0.4, gain = 0.12, partials = [[1, 1], [2, 0.3], [3, 0.12]] } = {}) {
  for (const [ratio, level] of partials) {
    const osc = ac.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = freq * ratio
    const g = ac.createGain()
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(gain * level, at + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, at + length / Math.sqrt(ratio))
    osc.connect(g).connect(out)
    osc.start(at)
    osc.stop(at + length + 0.02)
  }
}

/** Filtered noise, optionally swept — page flips, whooshes. */
function swish(ac, out, at, { length = 0.08, from = 3000, to = from, q = 1, gain = 0.3, attack = 0.01 } = {}) {
  const src = ac.createBufferSource()
  src.buffer = noiseBuffer(ac, length)
  const bp = ac.createBiquadFilter()
  bp.type = 'bandpass'
  bp.Q.value = q
  bp.frequency.setValueAtTime(from, at)
  bp.frequency.exponentialRampToValueAtTime(to, at + length)
  const g = ac.createGain()
  g.gain.setValueAtTime(0, at)
  g.gain.linearRampToValueAtTime(gain, at + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, at + length)
  src.connect(bp).connect(g).connect(out)
  src.start(at)
}

/** Echo send (feedback delay) for the "celestial" brilliant sound. */
function echo(ac, out, { time = 0.16, feedback = 0.38, tone = 4000 } = {}) {
  const input = ac.createGain()
  const delay = ac.createDelay(1)
  delay.delayTime.value = time
  const fb = ac.createGain()
  fb.gain.value = feedback
  const lp = ac.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = tone
  input.connect(out) // dry
  input.connect(delay)
  delay.connect(lp).connect(fb).connect(delay)
  lp.connect(out) // wet
  return input
}

// ── The sounds ──────────────────────────────────────────────────────────────

const SYNTH = {
  // Piece sounds
  move: (ac, out, t) => tock(ac, out, t, { pitch: 640, gain: 0.55 }),
  capture: (ac, out, t) => {
    tock(ac, out, t, { pitch: 520, gain: 0.7, body: 1.2 })
    tock(ac, out, t + 0.035, { pitch: 900, gain: 0.35, body: 0.7 })
  },
  castle: (ac, out, t) => {
    tock(ac, out, t, { pitch: 620, gain: 0.42 })
    tock(ac, out, t + 0.11, { pitch: 680, gain: 0.38 })
  },
  check: (ac, out, t) => {
    tock(ac, out, t, { pitch: 640, gain: 0.55 })
    bell(ac, out, t + 0.03, 988, { length: 0.22, gain: 0.07 })
  },
  end: (ac, out, t) => {
    tock(ac, out, t, { pitch: 560, gain: 0.6 })
    bell(ac, out, t + 0.05, 659, { length: 0.35, gain: 0.09 })
    bell(ac, out, t + 0.2, 523, { length: 0.5, gain: 0.09 })
  },

  // Retry
  correct: (ac, out, t) => {
    bell(ac, out, t, 784, { length: 0.2, gain: 0.1 })
    bell(ac, out, t + 0.1, 1175, { length: 0.35, gain: 0.1 })
  },
  wrong: (ac, out, t) => {
    bell(ac, out, t, 330, { length: 0.18, gain: 0.1 })
    bell(ac, out, t + 0.12, 262, { length: 0.28, gain: 0.1 })
  },

  // Review cues
  // !! — bright, echoing celestial bell: a quick rising arpeggio that rings out
  brilliant: (ac, out, t) => {
    const wet = echo(ac, out, { time: 0.17, feedback: 0.4 })
    const shimmer = [[1, 1], [2.0, 0.35], [3.01, 0.15], [4.2, 0.06]]
    bell(ac, wet, t, 1047, { length: 0.9, gain: 0.07, partials: shimmer })      // C6
    bell(ac, wet, t + 0.07, 1319, { length: 0.9, gain: 0.07, partials: shimmer }) // E6
    bell(ac, wet, t + 0.14, 1568, { length: 1.3, gain: 0.09, partials: shimmer }) // G6
    bell(ac, wet, t + 0.14, 2093, { length: 1.0, gain: 0.03 })                    // C7 sparkle
  },
  // ! — snappy wooden click with a small uplifting ding
  'great-move': (ac, out, t) => {
    tock(ac, out, t, { pitch: 820, gain: 0.45, body: 0.7 })
    bell(ac, out, t + 0.04, 1319, { length: 0.28, gain: 0.07 })
    bell(ac, out, t + 0.1, 1760, { length: 0.35, gain: 0.06 })
  },
  // excellent — same family as great, a touch softer
  excellent: (ac, out, t) => {
    tock(ac, out, t, { pitch: 780, gain: 0.35, body: 0.7 })
    bell(ac, out, t + 0.04, 1319, { length: 0.25, gain: 0.05 })
  },
  // book — soft, hollow page flip
  book: (ac, out, t) => {
    swish(ac, out, t, { length: 0.07, from: 2200, to: 3800, q: 0.8, gain: 0.32, attack: 0.02 })
    swish(ac, out, t + 0.05, { length: 0.05, from: 4200, to: 2600, q: 0.9, gain: 0.22, attack: 0.008 })
    tock(ac, out, t + 0.09, { pitch: 380, gain: 0.2, body: 0.5, cutoff: 1500 })
  },
  // ?! — dry, muted double tap
  inaccuracy: (ac, out, t) => {
    tock(ac, out, t, { pitch: 470, gain: 0.4, body: 0.6, cutoff: 1400 })
    tock(ac, out, t + 0.085, { pitch: 450, gain: 0.32, body: 0.6, cutoff: 1300 })
  },
  // ? — dull, low wooden drop
  mistake: (ac, out, t) => {
    tock(ac, out, t, { pitch: 250, gain: 0.75, body: 1.8, cutoff: 1100 })
    tock(ac, out, t + 0.06, { pitch: 230, gain: 0.25, body: 1.2, cutoff: 900 }) // small bounce
  },
  // ?? — heavy deep thud + a sagging minor-chord buzz
  blunder: (ac, out, t) => {
    tock(ac, out, t, { pitch: 120, gain: 0.95, body: 3, cutoff: 900 })
    const lp = ac.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(1400, t)
    lp.frequency.exponentialRampToValueAtTime(350, t + 0.6)
    lp.connect(out)
    for (const freq of [220, 261.6, 329.6]) { // A minor
      const osc = ac.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(freq, t + 0.04)
      osc.frequency.exponentialRampToValueAtTime(freq * 0.89, t + 0.6) // sags down ~2 semitones
      const g = ac.createGain()
      g.gain.setValueAtTime(0, t + 0.04)
      g.gain.linearRampToValueAtTime(0.045, t + 0.07)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.65)
      osc.connect(g).connect(lp)
      osc.start(t + 0.04)
      osc.stop(t + 0.7)
    }
  },
  // ✕ — sharp sweeping whoosh with a metallic edge
  miss: (ac, out, t) => {
    swish(ac, out, t, { length: 0.28, from: 500, to: 6000, q: 2.5, gain: 0.8, attack: 0.05 })
    bell(ac, out, t + 0.2, 2637, { length: 0.18, gain: 0.06, partials: [[1, 1], [2.76, 0.5], [5.4, 0.3]] })
  },
}

// Review cue per move classification (no cue: best, good, forced)
const CLASS_CUE = {
  brilliant: 'brilliant',
  great: 'great-move',
  excellent: 'excellent',
  book: 'book',
  inaccuracy: 'inaccuracy',
  mistake: 'mistake',
  blunder: 'blunder',
  miss: 'miss',
}

// ── Public API ──────────────────────────────────────────────────────────────

/** The piece sound a move should make, from its SAN. */
export function soundForSan(san = '') {
  if (san.includes('#')) return 'end'
  if (san.includes('+')) return 'check'
  if (san.startsWith('O-O')) return 'castle'
  if (san.includes('x')) return 'capture'
  return 'move'
}

/** The review cue for a move classification, or null. */
export function cueForClass(cls) {
  return CLASS_CUE[cls] ?? null
}

/** Play a sound now, or `delay` seconds from now. */
export function playSound(name, delay = 0) {
  try {
    const ac = audio()
    if (!ac || !SYNTH[name]) return
    if (!master) {
      // A gentle compressor keeps overlapping sounds from clipping; the
      // make-up gain brings the level back up afterwards
      master = ac.createDynamicsCompressor()
      const makeup = ac.createGain()
      makeup.gain.value = MAKEUP_GAIN
      master.connect(makeup).connect(ac.destination)
    }
    loadSamples(ac)
    const t = ac.currentTime + 0.005 + delay
    const sample = samples[name] ?? (name === 'excellent' ? samples['great-move'] : null)
    if (sample) {
      const src = ac.createBufferSource()
      src.buffer = sample
      src.connect(master)
      src.start(t)
    } else {
      SYNTH[name](ac, master, t)
    }
  } catch {
    // audio unavailable (autoplay policy, old browser) — stay silent
  }
}
