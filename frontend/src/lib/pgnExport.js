import { CLASSES, evalLabel, formatLine, uciToSan } from './review.js'

// Standard PGN move suffixes, as chess.com / Lichess annotate
const SUFFIX = {
  brilliant: '!!',
  great: '!',
  inaccuracy: '?!',
  mistake: '?',
  miss: '?',
  blunder: '??',
}

const ERRORS = new Set(['inaccuracy', 'mistake', 'miss', 'blunder'])

/** PGN `[%eval]` value: pawns or #N (mate), White's point of view. */
function evalTag(move, mover) {
  const label = evalLabel(move, mover)
  if (!label || label === 'Book' || label === '1-0' || label === '0-1') return null
  if (label.includes('M')) return label.startsWith('-') ? `#-${label.slice(2)}` : `#${label.slice(1)}`
  return label.replace('+', '')
}

const escape = s => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')

/**
 * The reviewed game as PGN: original headers, move-quality symbols,
 * engine evals ([%eval]) and a "Best was …" comment on every error.
 */
export function buildAnnotatedPgn(plies, analysis, classes, headers = {}, summary = null) {
  const tags = { Event: '?', Site: '?', Date: '????.??.??', Round: '?', White: '?', Black: '?', Result: '*', ...headers }
  tags.Annotator = 'AI Chess Reviewer (Stockfish)'
  if (summary?.w?.accuracy != null) tags.WhiteAccuracy = summary.w.accuracy.toFixed(1)
  if (summary?.b?.accuracy != null) tags.BlackAccuracy = summary.b.accuracy.toFixed(1)

  const head = Object.entries(tags).map(([k, v]) => `[${k} "${escape(v)}"]`).join('\n')

  const tokens = []
  plies.forEach((ply, i) => {
    if (ply.color === 'w') tokens.push(`${ply.moveNumber}.`)
    else if (i === 0 || tokens.at(-1)?.endsWith('}')) tokens.push(`${ply.moveNumber}...`)

    const cls = classes[i]
    tokens.push(ply.san + (SUFFIX[cls] ?? ''))

    const move = analysis[i]
    const notes = []
    const ev = move && evalTag(move, ply.color)
    if (ev) notes.push(`[%eval ${ev}]`)
    if (cls === 'book' && move?.opening && move.opening !== 'Opening theory' && move.opening !== analysis[i + 1]?.opening) {
      notes.push(move.opening)
    }
    if (ERRORS.has(cls) && move?.bestMove && move.bestMove !== ply.uci) {
      const line = formatLine(ply.before, move.bestLine || move.bestMove, 5)
      const best = uciToSan(ply.before, move.bestMove)
      notes.push(`${CLASSES[cls].label}. Best was ${best}${line ? ` (${line})` : ''}.`)
    }
    if (notes.length) tokens.push(`{ ${notes.join(' ')} }`)
  })
  tokens.push(tags.Result)

  // Wrap movetext at ~80 columns like most PGN tools
  const lines = []
  let line = ''
  for (const t of tokens) {
    if (line && line.length + 1 + t.length > 80) {
      lines.push(line)
      line = t
    } else {
      line = line ? `${line} ${t}` : t
    }
  }
  if (line) lines.push(line)
  return `${head}\n\n${lines.join('\n')}\n`
}

/** Ask the browser to save a text file. */
export function downloadText(filename, text, type = 'application/x-chess-pgn') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** "Morphy-vs-Duke-1858.pgn" */
export function pgnFilename(headers = {}) {
  const clean = s => String(s || '').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30)
  const parts = [clean(headers.White) || 'White', 'vs', clean(headers.Black) || 'Black']
  const year = (headers.Date || '').slice(0, 4)
  if (/^\d{4}$/.test(year)) parts.push(year)
  return `${parts.join('-')}-review.pgn`
}
