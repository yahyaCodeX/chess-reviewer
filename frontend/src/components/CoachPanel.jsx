import { Check, Eye, EyeOff, RotateCcw, Sparkles, Target, X } from 'lucide-react'
import ClassIcon from './ClassIcon'
import { CLASSES } from '../lib/review'

const VERDICT = {
  brilliant: 'is brilliant!',
  great: 'is a great move',
  best: 'is the best move',
  excellent: 'is excellent',
  good: 'is good',
  book: 'is a book move',
  inaccuracy: 'is an inaccuracy',
  mistake: 'is a mistake',
  miss: 'is a miss',
  blunder: 'is a blunder',
  forced: 'is forced',
}

const TIPS = {
  brilliant: 'A strong sacrifice that the engine agrees with.',
  great: 'The only good move — every alternative was clearly worse.',
  inaccuracy: 'Not terrible, but there was something better.',
  mistake: 'This lets a good part of the advantage slip.',
  miss: "Your opponent slipped, but this didn't punish it.",
  blunder: 'A serious error that changes the evaluation a lot.',
  forced: 'The only legal move.',
}

/** "Find a better move" practice card shown instead of the explanation. */
function RetryCard({ retry, explanation, side, onReveal, onExit, onRetryAgain }) {
  const { status, tries, attemptSan } = retry
  if (status === 'solved' || status === 'revealed') {
    const solved = status === 'solved'
    return (
      <div className={`retry-card ${solved ? 'solved' : 'revealed'}`}>
        <p className="retry-title">
          {solved ? <Check size={16} /> : <Eye size={16} />}
          {solved ? (
            <span>Correct! <strong className="san">{explanation.bestSan}</strong> is the best move.</span>
          ) : (
            <span>The best move was <strong className="san">{explanation.bestSan}</strong>.</span>
          )}
        </p>
        {explanation.bestWhy && <p className="best-why">{explanation.bestWhy}</p>}
        {explanation.bestLine && <p className="line-text"><span>Line</span> {explanation.bestLine}</p>}
        <div className="retry-actions">
          <button type="button" className="best-btn ghost" onClick={onRetryAgain}><RotateCcw size={14} /> Try again</button>
          <button type="button" className="best-btn" onClick={onExit}>Back to game</button>
        </div>
      </div>
    )
  }
  return (
    <div className={`retry-card ${status === 'wrong' ? 'wrong' : ''}`} aria-live="polite">
      <p className="retry-title">
        {status === 'wrong' ? <X size={16} /> : <Target size={16} />}
        {status === 'wrong' ? (
          <span><strong className="san">{attemptSan}</strong> isn't the best move. Try again!</span>
        ) : (
          <span>Find a better move for {side}.</span>
        )}
      </p>
      <p className="coach-hint">Drag a piece, or tap a piece and then its square.{tries > 0 && ` · ${tries} tr${tries === 1 ? 'y' : 'ies'}`}</p>
      <div className="retry-actions">
        <button type="button" className="best-btn ghost" onClick={onExit}>Cancel</button>
        <button type="button" className="best-btn ghost" onClick={onReveal}><Eye size={14} /> Show answer</button>
      </div>
    </div>
  )
}

/** Chess.com-style coach line explaining the displayed move. */
export default function CoachPanel({
  ply, cls, evalText, bestSan, opening, phase,
  explanation, showingBest, onToggleBest,
  retry, onStartRetry, onRevealRetry, onExitRetry,
}) {
  if (!ply) {
    return (
      <div className="coach-panel">
        <div className="coach-avatar"><Sparkles size={18} /></div>
        <div className="coach-body">
          <p className="coach-eyebrow">Coach</p>
          <p className="coach-text">
            {phase === 'idle'
              ? 'Paste a PGN or pick a Chess.com game to start a review.'
              : 'Starting position. Step through the game with the arrows.'}
          </p>
        </div>
      </div>
    )
  }

  const meta = cls ? CLASSES[cls] : null
  // Errors get the full "instead of X, play Y" card; anything else falls back to a short hint
  const showBest = !explanation && bestSan && bestSan !== ply.san && cls && !['best', 'book', 'brilliant', 'great', 'forced'].includes(cls)
  const side = ply.color === 'w' ? 'White' : 'Black'

  return (
    <div className="coach-panel" style={meta ? { '--cls': meta.color } : undefined}>
      <div className="coach-avatar">{cls ? <ClassIcon cls={cls} size={34} /> : <Sparkles size={18} />}</div>
      <div className="coach-body">
        <p className="coach-eyebrow">
          Move {ply.moveNumber}{ply.color === 'b' ? '…' : '.'} {side}
          {cls && evalText && evalText !== 'Book' && <span className="coach-eval">{evalText}</span>}
        </p>
        <p className="coach-text">
          <strong className="san">{ply.san}</strong>{' '}
          {cls ? <span style={{ color: meta.color }}>{VERDICT[cls]}</span> : <span className="muted">is being analyzed…</span>}
        </p>
        {showBest && (
          <p className="coach-hint">Best was <strong className="san best-san">{bestSan}</strong></p>
        )}
        {cls === 'book' && <p className="coach-hint">{opening && opening !== 'Opening theory' ? opening : 'Known opening theory.'}</p>}
        {explanation && !retry && <p className="coach-hint coach-why">{explanation.why}</p>}
        {explanation && !retry && explanation.replyLine && (
          <p className="line-text reply"><span>Their reply</span> {explanation.replyLine}</p>
        )}
        {!showBest && !explanation && cls && TIPS[cls] && <p className="coach-hint">{TIPS[cls]}</p>}

        {explanation && retry && (
          <RetryCard
            retry={retry}
            explanation={explanation}
            side={side}
            onReveal={onRevealRetry}
            onExit={onExitRetry}
            onRetryAgain={onStartRetry}
          />
        )}

        {explanation && !retry && (
          <div className="best-card">
            <div className="best-compare">
              <div className="best-row played">
                <span className="best-tag">Played</span>
                <strong className="san">{ply.san}</strong>
                <span className="best-eval">{explanation.playedEval}</span>
              </div>
              <div className="best-row better">
                <span className="best-tag">Best</span>
                <strong className="san">{explanation.bestSan}</strong>
                {explanation.bestEval && <span className="best-eval">{explanation.bestEval}</span>}
              </div>
            </div>
            {explanation.bestWhy && <p className="best-why">{explanation.bestWhy}</p>}
            {explanation.bestLine && <p className="line-text"><span>Best line</span> {explanation.bestLine}</p>}
            <div className="retry-actions">
              <button type="button" className="best-btn retry-btn" onClick={onStartRetry} title="Find the best move yourself (R)">
                <Target size={15} /> Retry
              </button>
              <button type="button" className={`best-btn ${showingBest ? 'on' : ''}`} onClick={onToggleBest} aria-pressed={showingBest} title="Show the best move (B)">
                {showingBest ? <EyeOff size={15} /> : <Eye size={15} />}
                {showingBest ? 'Back to game' : 'Show best'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
