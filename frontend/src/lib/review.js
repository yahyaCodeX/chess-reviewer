import { Chess } from 'chess.js'

export const STARTING_FEN = new Chess().fen()

// ─── Classification metadata ────────────────────────────────────────────────
// `icon` is either a short text glyph or the name of a lucide icon that
// ClassIcon knows how to render.
export const CLASSES = {
  brilliant:  { key: 'brilliant',  label: 'Brilliant',  glyph: '!!', color: '#26c2a3' },
  great:      { key: 'great',      label: 'Great',      glyph: '!',  color: '#749bbf' },
  best:       { key: 'best',       label: 'Best',       icon: 'star',  color: '#81b64c' },
  excellent:  { key: 'excellent',  label: 'Excellent',  icon: 'thumb', color: '#98bc4b' },
  good:       { key: 'good',       label: 'Good',       icon: 'check', color: '#97af8b' },
  book:       { key: 'book',       label: 'Book',       icon: 'book',  color: '#a88865' },
  inaccuracy: { key: 'inaccuracy', label: 'Inaccuracy', glyph: '?!', color: '#f7c631' },
  mistake:    { key: 'mistake',    label: 'Mistake',    glyph: '?',  color: '#ffa459' },
  miss:       { key: 'miss',       label: 'Miss',       glyph: '✕',  color: '#ff7769' },
  blunder:    { key: 'blunder',    label: 'Blunder',    glyph: '??', color: '#fa412d' },
  forced:     { key: 'forced',     label: 'Forced',     glyph: '→',  color: '#8b8984' },
}

// Display order for the summary table (same as chess.com's Game Review)
export const CLASS_ORDER = [
  'brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder',
]

/** Book move? New worker sends the opening name; old rows used "BOOK" as eval. */
export function isBook(move) {
  return Boolean(move?.opening) || move?.evaluation === 'BOOK'
}

const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

// ─── Timeline (local source of truth for board positions) ───────────────────

/**
 * Parse a PGN into a list of plies with before/after FENs.
 * The board is always driven by this local timeline, so navigation works
 * instantly — engine results are attached to plies as they stream in.
 */
export function buildTimeline(pgn) {
  const game = new Chess()
  try {
    game.loadPgn(pgn)
  } catch (err) {
    return { ok: false, error: err?.message || 'Invalid PGN', plies: [], headers: {} }
  }
  const plies = game.history({ verbose: true }).map((m, i) => ({
    index: i,
    moveNumber: Math.floor(i / 2) + 1,
    color: m.color,
    san: m.san,
    from: m.from,
    to: m.to,
    piece: m.piece,
    captured: m.captured,
    promotion: m.promotion,
    uci: m.from + m.to + (m.promotion || ''),
    before: m.before,
    after: m.after,
  }))
  if (plies.length === 0) {
    return { ok: false, error: 'The PGN has no moves.', plies: [], headers: {} }
  }
  return { ok: true, plies, headers: game.getHeaders() }
}

/** Ply index (0-based) of an analyzed move coming from the backend. */
export function plyOf(move) {
  const isBlack = String(move.player || '').toLowerCase() === 'black'
  return (Number(move.moveNumber) - 1) * 2 + (isBlack ? 1 : 0)
}

// ─── Evaluation helpers ─────────────────────────────────────────────────────

function mateSide(evalStr, san) {
  const lower = evalStr.toLowerCase()
  // A checkmating move: the mover wins regardless of how the score is labelled
  // (older worker versions reported "Mate in 0 for <loser>").
  if (san && san.includes('#')) return null
  if (lower.includes('white')) return 'w'
  if (lower.includes('black')) return 'b'
  return evalStr.trim().startsWith('-') ? 'b' : 'w'
}

/** White's win probability (0–100) after a move, using the Lichess logistic curve. */
export function whiteWinProbability(move, mover) {
  if (!move) return 50
  const str = String(move.evaluation ?? '').trim()
  if (!str || str === 'BOOK') return 50 // legacy rows had no eval for book moves
  if (move.moveSan?.includes('#')) return mover === 'b' ? 0 : 100
  if (str.toLowerCase().includes('mate')) return mateSide(str, move.moveSan) === 'b' ? 0 : 100
  const pawns = parseFloat(str)
  if (Number.isNaN(pawns)) return 50
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * pawns * 100)) - 1)
}

/** Short eval label for the eval bar / coach panel: "+1.3", "M4", "-M2", "1-0". */
export function evalLabel(move, mover) {
  if (!move) return '0.0'
  const str = String(move.evaluation ?? '').trim()
  if (str === 'BOOK') return 'Book'
  if (move.moveSan?.includes('#')) return mover === 'b' ? '0-1' : '1-0'
  const mate = str.match(/mate in (\d+)/i)
  if (mate) {
    const side = mateSide(str, move.moveSan)
    if (mate[1] === '0') return side === 'b' ? '0-1' : '1-0'
    return `${side === 'b' ? '-' : ''}M${mate[1]}`
  }
  const pawns = parseFloat(str)
  if (Number.isNaN(pawns)) return '0.0'
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(1)}`
}

// ─── Classification ─────────────────────────────────────────────────────────

/**
 * A "sacrifice": a non-pawn piece left en prise — attacked by something
 * cheaper, or attacked and undefended — without winning back equal material.
 */
function isSacrifice(ply) {
  if (!ply || ply.piece === 'p' || ply.piece === 'k' || ply.promotion) return false
  const value = PIECE_VALUE[ply.piece]
  const gained = ply.captured ? PIECE_VALUE[ply.captured] : 0
  if (value - gained < 2) return false

  const board = new Chess(ply.after)
  const opponent = ply.color === 'w' ? 'b' : 'w'
  const attackers = board.attackers(ply.to, opponent)
  if (attackers.length === 0) return false
  const defenders = board.attackers(ply.to, ply.color)
  if (defenders.length === 0) return true
  const cheapest = Math.min(
    ...attackers
      .map(sq => board.get(sq)?.type)
      .filter(t => t && t !== 'k') // a king can't take a defended piece
      .map(t => PIECE_VALUE[t]),
  )
  return cheapest < value
}

/**
 * Win-probability drop for the side that moved, in percentage points.
 * Positive = the move made things worse for the mover.
 */
function moverDrop(index, analysis, plies) {
  const cur = analysis[index]
  const prev = index > 0 ? analysis[index - 1] : null
  const mover = plies[index]?.color ?? (cur.player === 'Black' ? 'b' : 'w')
  const prevMover = mover === 'w' ? 'b' : 'w'
  const before = prev ? whiteWinProbability(prev, prevMover) : 50
  const after = whiteWinProbability(cur, mover)
  const moverBefore = mover === 'w' ? before : 100 - before
  const moverAfter = mover === 'w' ? after : 100 - after
  return { drop: moverBefore - moverAfter, moverBefore, moverAfter }
}

function legalMoveCount(fen) {
  try {
    return new Chess(fen).moves().length
  } catch {
    return 0
  }
}

/**
 * Returns a CLASSES key, or null if the move has not been analyzed yet.
 *
 * Mirrors chess.com's published rules, using win-probability ("expected
 * points") lost by the mover:
 *   Best        – the engine's top move
 *   Excellent   – loss < 2%      Good – loss < 5%
 *   Inaccuracy  – loss ≥ 5%      Mistake – ≥ 10%      Blunder – ≥ 20%
 *   Miss        – a mistake/blunder right after the opponent's own error
 *                 (you failed to punish it) without ending up lost
 *   Great       – the only good move: best move, every alternative loses ≥ 10%
 *   Brilliant   – a good piece sacrifice, when not already completely winning
 *   Book        – opening theory     Forced – the only legal move
 */
export function classifyPly(index, analysis, plies) {
  const cur = analysis[index]
  if (!cur) return null
  if (isBook(cur)) return 'book'
  const ply = plies[index]
  if (ply && legalMoveCount(ply.before) === 1) return 'forced'
  if (cur.moveSan?.includes('#')) return 'best'

  const { drop, moverBefore, moverAfter } = moverDrop(index, analysis, plies)
  const playedBest = Boolean(cur.bestMove && ply && cur.bestMove === ply.uci)

  // Did the opponent just make a mistake (that we could punish)?
  const prev = index > 0 ? analysis[index - 1] : null
  const opponentErred = Boolean(prev && !isBook(prev) && moverDrop(index - 1, analysis, plies).drop >= 10)

  // Walking into a forced mate that wasn't there before is always a blunder
  const prevMover = ply.color === 'w' ? 'b' : 'w'
  const allowsMate = mateAgainst(cur, ply.color) && !(prev && mateAgainst(prev, prevMover === 'w' ? 'b' : 'w'))
  if (!playedBest && allowsMate && drop >= 5) return 'blunder'

  // The engine's own top move is not an error — a moderate eval "drop" after
  // it is just the engine seeing deeper on the next ply (horizon effect).
  // But if the deeper look shows the mover is now clearly lost, trust it.
  if (!playedBest || moverAfter < 20) {
    if (drop >= 20) return opponentErred && moverAfter >= 35 ? 'miss' : 'blunder'
    if (drop >= 10) return opponentErred ? 'miss' : 'mistake'
    if (drop >= 5) return 'inaccuracy'
  }

  // Sacrifices count as brilliant unless the game was already won — except a
  // sacrifice that keeps a forced mate on the board (e.g. Morphy's Qb8+!!).
  const matingSac = moverAfter >= 99.9 && /mate/i.test(cur.evaluation)
  if ((playedBest || drop < 2) && moverAfter >= 50 && (moverBefore < 95 || matingSac) && isSacrifice(ply)) {
    return 'brilliant'
  }

  // "Only move": the engine's second choice would have cost ≥ 10%.
  if (playedBest && cur.altEvaluation && !isRecapture(index, plies)) {
    const altWhite = whiteWinProbability({ evaluation: cur.altEvaluation }, ply.color)
    const moverAlt = ply.color === 'w' ? altWhite : 100 - altWhite
    if (moverBefore - moverAlt >= 10) return 'great'
  }

  if (playedBest) return 'best'
  if (drop < 2) return 'excellent'
  return 'good'
}

/** Is `move`'s evaluation a forced mate against the given side? */
function mateAgainst(move, side) {
  if (!move || move.moveSan?.includes('#')) return false
  const str = String(move.evaluation ?? '')
  if (!/mate in [1-9]/i.test(str)) return false
  return mateSide(str, move.moveSan) !== side
}

/** Taking back a piece on the square where the opponent just captured. */
function isRecapture(index, plies) {
  const ply = plies[index]
  const prev = plies[index - 1]
  return Boolean(ply?.captured && prev?.captured && prev.to === ply.to)
}

/** Lichess-style per-move accuracy from the win-probability drop. */
function moveAccuracy(drop) {
  const d = Math.max(0, drop)
  const acc = 103.1668100711649 * Math.exp(-0.04354415386753951 * d) - 3.166924740191411
  return Math.min(100, Math.max(0, acc))
}

/**
 * Per-side accuracy and classification counts.
 * Accuracy = average of arithmetic and harmonic means (harmonic punishes
 * blunders harder, like Lichess). Book moves are excluded.
 */
export function summarize(plies, analysis, classes) {
  const sides = {
    w: { accs: [], counts: Object.fromEntries(CLASS_ORDER.map(k => [k, 0])) },
    b: { accs: [], counts: Object.fromEntries(CLASS_ORDER.map(k => [k, 0])) },
  }
  plies.forEach((ply, i) => {
    const cls = classes[i]
    if (!cls) return
    const side = sides[ply.color]
    if (cls in side.counts) side.counts[cls] += 1
    if (cls === 'book' || cls === 'forced') return
    // Playing the engine's top move is 100% accurate, whatever the eval did
    const playedBest = analysis[i]?.bestMove === ply.uci && !['blunder', 'mistake', 'inaccuracy', 'miss'].includes(cls)
    side.accs.push(playedBest ? 100 : moveAccuracy(moverDrop(i, analysis, plies).drop))
  })
  const accuracy = accs => {
    if (accs.length === 0) return null
    const mean = accs.reduce((a, b) => a + b, 0) / accs.length
    const harmonic = accs.length / accs.reduce((a, b) => a + 1 / Math.max(b, 1), 0)
    return (mean + harmonic) / 2
  }
  return {
    w: { accuracy: accuracy(sides.w.accs), counts: sides.w.counts },
    b: { accuracy: accuracy(sides.b.accs), counts: sides.b.counts },
  }
}

/** Convert a UCI move to SAN in the given position (null if illegal). */
export function uciToSan(fen, uci) {
  if (!uci || uci.length < 4) return null
  try {
    const board = new Chess(fen)
    return board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san
  } catch {
    return null
  }
}

// ─── Material ───────────────────────────────────────────────────────────────

const START_COUNTS = { p: 8, n: 2, b: 2, r: 2, q: 1 }

/** Pieces each side has captured, plus the material balance, from a FEN. */
export function materialFromFen(fen) {
  const counts = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } }
  for (const ch of fen.split(' ')[0]) {
    const lower = ch.toLowerCase()
    if (!(lower in START_COUNTS)) continue
    counts[ch === lower ? 'b' : 'w'][lower] += 1
  }
  const captured = { w: [], b: [] } // pieces captured BY each side
  let balance = 0 // positive = White ahead
  for (const t of ['q', 'r', 'b', 'n', 'p']) {
    const lostByBlack = Math.max(0, START_COUNTS[t] - counts.b[t])
    const lostByWhite = Math.max(0, START_COUNTS[t] - counts.w[t])
    for (let i = 0; i < lostByBlack; i++) captured.w.push(t)
    for (let i = 0; i < lostByWhite; i++) captured.b.push(t)
    balance += (counts.w[t] - counts.b[t]) * PIECE_VALUE[t]
  }
  return { captured, balance }
}

// ─── Engine lines ───────────────────────────────────────────────────────────

/**
 * Engine line (space-separated UCI) → readable SAN with move numbers,
 * e.g. "5. O-O Qxe4 6. Re1". Stops at the first illegal move.
 */
export function formatLine(fen, uciLine, maxPlies = 6) {
  if (!fen || !uciLine) return null
  let board
  try {
    board = new Chess(fen)
  } catch {
    return null
  }
  const parts = []
  for (const uci of uciLine.trim().split(/\s+/).slice(0, maxPlies)) {
    const moveNo = board.moveNumber()
    const white = board.turn() === 'w'
    let move
    try {
      move = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
    } catch {
      break
    }
    if (white) parts.push(`${moveNo}. ${move.san}`)
    else parts.push(parts.length === 0 ? `${moveNo}… ${move.san}` : move.san)
  }
  return parts.length ? parts.join(' ') : null
}

// ─── Estimated rating ───────────────────────────────────────────────────────

// Rough accuracy → rating curve, in the spirit of chess.com's "Game Rating".
// It's an estimate from a single game, so it's shown rounded to 50.
const RATING_CURVE = [
  [0, 100], [40, 250], [50, 400], [60, 650], [70, 950], [75, 1200],
  [80, 1500], [85, 1850], [90, 2200], [95, 2600], [98, 2850], [100, 3000],
]

export function estimateRating(accuracy) {
  if (accuracy == null || Number.isNaN(accuracy)) return null
  const a = Math.max(0, Math.min(100, accuracy))
  for (let i = 1; i < RATING_CURVE.length; i++) {
    const [x1, y1] = RATING_CURVE[i]
    if (a <= x1) {
      const [x0, y0] = RATING_CURVE[i - 1]
      const r = y0 + ((a - x0) / (x1 - x0)) * (y1 - y0)
      return Math.round(r / 50) * 50
    }
  }
  return 3000
}
