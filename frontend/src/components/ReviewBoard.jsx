import { useCallback, useMemo, useState } from 'react'
import { Chessboard } from 'react-chessboard'
import ClassIcon from './ClassIcon'
import EvalBar from './EvalBar'
import { CLASSES, materialFromFen } from '../lib/review'
import { BOARD_THEMES } from '../lib/themes'

const PIECE_GLYPH = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛' }

function PlayerStrip({ name, rating, color, captured, advantage, active }) {
  return (
    <div className={`player-strip ${active ? 'to-move' : ''}`}>
      <span className={`player-avatar ${color === 'w' ? 'avatar-white' : 'avatar-black'}`} aria-hidden="true">
        {color === 'w' ? '♔' : '♚'}
      </span>
      <span className="player-name">{name || (color === 'w' ? 'White' : 'Black')}</span>
      {rating && <span className="player-rating">({rating})</span>}
      <span className="player-captured" aria-label="Captured pieces">
        {captured.map((t, i) => (
          <span key={i} className={`cap cap-${color === 'w' ? 'b' : 'w'}`}>{PIECE_GLYPH[t]}</span>
        ))}
        {advantage > 0 && <span className="cap-adv">+{advantage}</span>}
      </span>
    </div>
  )
}

/**
 * The review board: eval bar + chessboard + player strips + overlays.
 *
 * highlight: { from, to, cls } — squares of the displayed move; cls tints them
 * arrows:    react-chessboard arrow objects (best-move hint)
 * overlay:   ReactNode drawn over the board (analysis animations)
 * movable:   'w' | 'b' — lets that side move (Retry mode); null = view only
 * onMove:    (from, to) => boolean — called for a drag or tap-tap move
 */
export default function ReviewBoard({
  fen,
  orientation = 'white',
  theme = 'green',
  highlight,
  badgeKey,
  arrows = [],
  evalWp,
  evalText,
  evalPending,
  headers = {},
  overlay,
  scanning = false,
  movable = null,
  onMove,
}) {
  const colors = BOARD_THEMES[theme] ?? BOARD_THEMES.green
  // Tap-to-move (phones): first tap picks a piece, second tap its target
  const [picked, setPicked] = useState(null)
  const selected = movable && picked?.fen === fen ? picked.square : null

  const squareTints = useMemo(() => {
    const tints = {}
    if (highlight) {
      const base = highlight.cls ? CLASSES[highlight.cls].color : '#ffd84f'
      tints[highlight.from] = `${base}73` // ~45% alpha
      tints[highlight.to] = `${base}99`   // ~60% alpha
    }
    if (selected) tints[selected] = '#ffd84fa6'
    return tints
  }, [highlight, selected])

  const pieceColorAt = useCallback(square => {
    const rows = fen.split(' ')[0].split('/')
    const file = square.charCodeAt(0) - 97
    const rank = 8 - Number(square[1])
    let col = 0
    for (const ch of rows[rank] ?? '') {
      if (/\d/.test(ch)) col += Number(ch)
      else {
        if (col === file) return ch === ch.toUpperCase() ? 'w' : 'b'
        col++
      }
    }
    return null
  }, [fen])

  // Idempotent on purpose: a tap on a piece can arrive both as a click and as
  // a zero-distance drag, and selecting the same piece twice must not undo it.
  const tapSquare = useCallback(square => {
    if (!movable) return
    if (pieceColorAt(square) === movable) {
      setPicked({ fen, square })
    } else if (selected) {
      onMove?.(selected, square)
      setPicked(null)
    } else {
      setPicked(null)
    }
  }, [movable, selected, pieceColorAt, onMove, fen])
  const onSquareClick = useCallback(({ square }) => tapSquare(square), [tapSquare])

  const squareRenderer = useCallback(
    ({ square, children }) => (
      <div className="sq" style={squareTints[square] ? { backgroundColor: squareTints[square] } : undefined}>
        {children}
        {highlight?.cls && square === highlight.to && (
          <span className="sq-badge" key={badgeKey}>
            <ClassIcon cls={highlight.cls} size={26} />
          </span>
        )}
      </div>
    ),
    [squareTints, highlight, badgeKey],
  )

  const { captured, balance } = useMemo(() => materialFromFen(fen), [fen])
  const sideToMove = fen.split(' ')[1]
  const top = orientation === 'white' ? 'b' : 'w'
  const bottom = top === 'w' ? 'b' : 'w'
  const strip = color => (
    <PlayerStrip
      name={color === 'w' ? headers.White : headers.Black}
      rating={color === 'w' ? headers.WhiteElo : headers.BlackElo}
      color={color}
      captured={captured[color]}
      advantage={color === 'w' ? balance : -balance}
      active={sideToMove === color}
    />
  )

  return (
    <div className="review-board">
      {strip(top)}
      <div className="board-row">
        <EvalBar whiteWp={evalWp} label={evalText} orientation={orientation} pending={evalPending} />
        <div className={`board-frame ${movable ? 'is-movable' : ''}`}>
          <Chessboard
            options={{
              id: 'review-board',
              position: fen,
              boardOrientation: orientation,
              allowDragging: Boolean(movable),
              canDragPiece: ({ piece }) => Boolean(movable) && piece?.pieceType?.[0] === movable,
              onPieceDrop: ({ sourceSquare, targetSquare }) => {
                if (!targetSquare) return false
                if (targetSquare === sourceSquare) {
                  tapSquare(sourceSquare) // a tap on a draggable piece ends as a same-square drop
                  return false
                }
                setPicked(null)
                return Boolean(onMove?.(sourceSquare, targetSquare))
              },
              onSquareClick,
              allowDrawingArrows: false,
              clearArrowsOnPositionChange: false,
              animationDurationInMs: 220,
              showNotation: true,
              arrows,
              darkSquareStyle: { backgroundColor: colors.dark },
              lightSquareStyle: { backgroundColor: colors.light },
              darkSquareNotationStyle: { color: colors.light, fontWeight: 700 },
              lightSquareNotationStyle: { color: colors.dark, fontWeight: 700 },
              squareRenderer,
            }}
          />
          {scanning && <div className="board-scanner" aria-hidden="true" />}
          {overlay}
        </div>
      </div>
      {strip(bottom)}
    </div>
  )
}
