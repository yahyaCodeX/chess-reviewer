// Move sounds.
//
// 1. Real recordings win: drop files named move / capture / castle / check /
//    end / correct / wrong (.mp3, .ogg or .wav) into frontend/public/sounds/
//    and they are used automatically.
// 2. Otherwise a synthesised wooden "tock" is played: a wood block rings at a
//    few inharmonic frequencies that die away within ~0.1 s, started by a very
//    short click. That's what makes it sound like a piece on a board rather
//    than a beep.

const NAMES = ['move', 'capture', 'castle', 'check', 'end', 'correct', 'wrong']
const EXTENSIONS = ['mp3', 'ogg', 'wav']

let ctx = null
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

// ── Synthesis ───────────────────────────────────────────────────────────────

// Modes of a small wooden bar: frequency ratios, relative loudness, decay (s)
const WOOD_MODES = [
  [1.0, 1.0, 0.075],
  [2.57, 0.42, 0.045],
  [4.21, 0.2, 0.03],
  [6.1, 0.08, 0.02],
]

/** One wooden knock: a short click plus a few fast-decaying partials. */
function tock(ac, out, at, { pitch = 620, gain = 0.6, body = 1 } = {}) {
  // Contact click: 3 ms of high-passed noise
  const frames = Math.floor(ac.sampleRate * 0.003)
  const buffer = ac.createBuffer(1, frames, ac.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames)
  const click = ac.createBufferSource()
  click.buffer = buffer
  const hp = ac.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 2500
  const clickGain = ac.createGain()
  clickGain.gain.value = gain * 0.35
  click.connect(hp).connect(clickGain).connect(out)
  click.start(at)

  // Resonant body
  for (const [ratio, level, decay] of WOOD_MODES) {
    const osc = ac.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(pitch * ratio * 1.015, at)
    osc.frequency.exponentialRampToValueAtTime(pitch * ratio, at + 0.02) // tiny pitch drop on impact
    const g = ac.createGain()
    const peak = gain * level * 0.5
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(peak, at + 0.001)
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay * body)
    osc.connect(g).connect(out)
    osc.start(at)
    osc.stop(at + decay * body + 0.02)
  }
}

function chime(ac, out, at, freq, length = 0.25, gain = 0.12) {
  for (const [ratio, level] of [[1, 1], [2, 0.3], [3, 0.12]]) {
    const osc = ac.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = freq * ratio
    const g = ac.createGain()
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(gain * level, at + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, at + length)
    osc.connect(g).connect(out)
    osc.start(at)
    osc.stop(at + length + 0.02)
  }
}

const SYNTH = {
  move: (ac, out, t) => tock(ac, out, t, { pitch: 640, gain: 0.55 }),
  // A capture is a heavier knock with a second piece clacking against it
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
    chime(ac, out, t + 0.03, 988, 0.22, 0.07)
  },
  end: (ac, out, t) => {
    tock(ac, out, t, { pitch: 560, gain: 0.6 })
    chime(ac, out, t + 0.05, 659, 0.35, 0.09)
    chime(ac, out, t + 0.2, 523, 0.5, 0.09)
  },
  correct: (ac, out, t) => {
    chime(ac, out, t, 784, 0.2, 0.1)
    chime(ac, out, t + 0.1, 1175, 0.35, 0.1)
  },
  wrong: (ac, out, t) => {
    chime(ac, out, t, 330, 0.18, 0.1)
    chime(ac, out, t + 0.12, 262, 0.28, 0.1)
  },
}

// ── Public API ──────────────────────────────────────────────────────────────

/** The sound a move should make, from its SAN. */
export function soundForSan(san = '') {
  if (san.includes('#')) return 'end'
  if (san.includes('+')) return 'check'
  if (san.startsWith('O-O')) return 'castle'
  if (san.includes('x')) return 'capture'
  return 'move'
}

let master = null
const MAKEUP_GAIN = 2.2

export function playSound(name) {
  try {
    const ac = audio()
    if (!ac || !SYNTH[name]) return
    if (!master) {
      // A gentle compressor keeps overlapping knocks from clipping; the
      // make-up gain brings the level back up afterwards
      master = ac.createDynamicsCompressor()
      const makeup = ac.createGain()
      makeup.gain.value = MAKEUP_GAIN
      master.connect(makeup).connect(ac.destination)
    }
    loadSamples(ac)
    const t = ac.currentTime + 0.005
    const sample = samples[name]
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
