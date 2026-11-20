import { Chess } from 'chess.js'
import { evalLabel, formatLine, uciToSan } from './review.js'

// Classes that get a "here's what you should have played" explanation
export const ERROR_CLASSES = new Set(['inaccuracy', 'mistake', 'miss', 'blunder'])

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
const NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }

/** { n, side } from "Mate in 3 for White", or null. */
function parseMate(move) {
  const m = String(move?.evaluation ?? '').match(/mate in (\d+) for (white|black)/i)
  return m ? { n: Number(m[1]), side: m[2][0].toLowerCase() } : null
}

/**
 * The opponent's most profitable capture in `fen` (side to move = opponent).
 * Uses legal moves, so pinned attackers are ignored. Returns null when nothing
 * of the mover's can be won.
 */
function biggestHangingPiece(fen, mover, ply) {
  let board
  try { board = new Chess(fen) } catch { return null }
  if (board.isGameOver()) return null
  let best = null
  for (const m of board.moves({ verbose: true })) {
    if (!m.captured || m.captured === 'k') continue
    const defended = board.attackers(m.to, mover).length > 0
    let gain = defended ? VALUE[m.captured] - VALUE[m.piece] : VALUE[m.captured]
    if (ply?.captured && m.to === ply.to) gain -= VALUE[ply.captured] // just a trade/recapture
    if (gain >= 1 && (!best || gain > best.gain)) best = { gain, piece: m.captured, square: m.to }
  }
  return best
}

/** Material the best move wins outright with a capture, or null. */
function captureGain(fen, uci, mover) {
  let board
  try { board = new Chess(fen) } catch { return null }
  let move
  try { move = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }) } catch { return null }
  if (!move.captured) return null
  const opp = mover === 'w' ? 'b' : 'w'
  const recapturable = board.attackers(move.to, opp).length > 0
  const gain = recapturable ? VALUE[move.captured] - VALUE[move.piece] : VALUE[move.captured]
  return gain >= 1 ? { gain, piece: move.captured, clean: gain === VALUE[move.captured] } : null
}

/**
 * Chess.com-style explanation for an error move.
 *
 * Returns null for non-errors. Otherwise:
 *   bestSan / bestUci   the engine's preferred move
 *   playedEval/bestEval eval labels (White's point of view) after each move
 *   why                 what was wrong with the played move
 *   bestWhy             what the best move would have achieved (may be null)
 *   bestLine            engine line starting with the best move ("5. O-O Qxe4 6. Re1")
 *   replyLine           opponent's best answer to the played move, as a line
 */
export function explainMove(index, plies, analysis, cls) {
  if (!ERROR_CLASSES.has(cls)) return null
  const ply = plies[index]
  const data = analysis[index]
  const bestUci = data?.bestMove
  if (!ply || !bestUci || bestUci === ply.uci) return null
  const bestSan = uciToSan(ply.before, bestUci)
  if (!bestSan) return null

  const mover = ply.color
  const prev = index > 0 ? analysis[index - 1] : null // eval of the position before = eval of best play
  const playedMate = parseMate(data)
  const bestMate = parseMate(prev)

  const opp = mover === 'w' ? 'b' : 'w'
  const playedEval = evalLabel(data, mover)
  const bestEvalRaw = prev ? evalLabel(prev, plies[index - 1].color) : null
  const bestEval = bestEvalRaw === 'Book' ? null : bestEvalRaw

  // ── What the best move achieves ──
  let bestWhy = null
  if (bestSan.includes('#')) bestWhy = `${bestSan} was checkmate!`
  else if (bestMate && bestMate.side === mover) bestWhy = `${bestSan} forces checkmate in ${bestMate.n}.`
  else {
    const won = captureGain(ply.before, bestUci, mover)
    if (won) bestWhy = won.clean ? `${bestSan} wins a ${NAME[won.piece]}.` : `${bestSan} wins material.`
    else if (prev && !parseMate(prev)) {
      const pawns = parseFloat(prev.evaluation) * (mover === 'w' ? 1 : -1) // mover's point of view
      if (!Number.isNaN(pawns)) {
        bestWhy = pawns >= 2 ? `${bestSan} keeps a winning advantage.`
          : pawns >= 0.7 ? `${bestSan} keeps a clear advantage.`
          : pawns > -0.7 ? `${bestSan} keeps the position balanced.`
          : pawns > -2 ? `${bestSan} keeps you in the game.`
          : `${bestSan} was the most stubborn defence.`
      }
    }
  }

  // ── What went wrong with the played move ──
  // The engine's best reply in the new position tells us what the move allows.
  const nextBest = analysis[index + 1]?.bestMove
  const replySan = nextBest ? uciToSan(ply.after, nextBest) : null
  let replyWin = replySan ? captureGain(ply.after, nextBest, opp) : null
  if (replyWin && ply.captured && nextBest.slice(2, 4) === ply.to) {
    // Recapturing what we just took is a trade, not a win
    const net = replyWin.gain - VALUE[ply.captured]
    replyWin = net >= 1 ? { ...replyWin, gain: net, clean: false } : null
  }
  const oppName = opp === 'w' ? 'White' : 'Black'

  let why
  if (playedMate && playedMate.side !== mover) {
    const how = replySan ? `, starting with ${replySan}` : ''
    why = playedMate.n === 1 ? `This allows checkmate in one: ${replySan || 'mate'}.` : `This allows a forced checkmate in ${playedMate.n}${how}.`
  } else if (bestMate && bestMate.side === mover && !(playedMate && playedMate.side === mover)) {
    why = `You had a forced checkmate in ${bestMate.n} and missed it.`
  } else if (replyWin && (cls !== 'inaccuracy' || replyWin.gain >= 3)) {
    // Eval lost (in pawns, mover's view) far beyond the material → there's an attack too
    const sign = mover === 'w' ? 1 : -1
    const lost = (parseFloat(prev?.evaluation) - parseFloat(data.evaluation)) * sign
    const more = lost > replyWin.gain + 1.5 ? ' and gets a strong attack' : ''
    why = replyWin.clean
      ? `This allows ${replySan}, and ${oppName} wins a ${NAME[replyWin.piece]}${more}.`
      : `This allows ${replySan}, and ${oppName} wins material${more}.`
  } else {
    const hanging = biggestHangingPiece(ply.after, mover, ply)
    if (hanging && (cls === 'blunder' || cls === 'mistake' || hanging.gain >= 3)) {
      why = `This leaves your ${NAME[hanging.piece]} on ${hanging.square} ${hanging.gain === VALUE[hanging.piece] ? 'hanging' : 'under attack'}.`
    } else if (cls === 'miss') {
      why = "Your opponent slipped up, but this lets them off the hook."
    } else if (replySan && cls !== 'inaccuracy') {
      why = `This allows ${oppName} to play the strong ${replySan}.`
    }
  }
  if (!why) {
    why = bestEval
      ? `This shifts the evaluation from ${bestEval} to ${playedEval}, in ${oppName}'s favour.`
      : 'There was a stronger move here.'
  }

  const bestLine = formatLine(ply.before, data.bestLine || bestUci, 6)
  const replyLine = formatLine(ply.after, analysis[index + 1]?.bestLine || nextBest, 4)
  return { bestSan, bestUci, playedEval, bestEval, why, bestWhy, bestLine, replyLine }
}

/** FEN after playing `uci` from `fen` (null if illegal). */
export function fenAfter(fen, uci) {
  try {
    const board = new Chess(fen)
    board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
    return board.fen()
  } catch {
    return null
  }
}
