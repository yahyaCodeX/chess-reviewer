import { useEffect, useRef, useState } from 'react'
import { Check, Download, Share2 } from 'lucide-react'
import ClassIcon from './ClassIcon'
import { CLASSES, CLASS_ORDER, estimateRating } from '../lib/review'

/** Animates a number toward `value` (count-up when the review finishes). */
function useTweened(value, ms = 700) {
  const [shown, setShown] = useState(value ?? 0)
  const from = useRef(value ?? 0)
  useEffect(() => {
    if (value == null) return
    const start = performance.now()
    const a = from.current
    let raf
    const step = now => {
      const t = Math.min(1, (now - start) / ms)
      const eased = 1 - Math.pow(1 - t, 3)
      setShown(a + (value - a) * eased)
      if (t < 1) raf = requestAnimationFrame(step)
      else from.current = value
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return shown
}

function AccuracyTile({ name, accuracy, color, rating }) {
  const shown = useTweened(accuracy)
  return (
    <div className={`acc-tile acc-${color}`}>
      <span className="acc-name" title={name}>{name}</span>
      <span className="acc-value">{accuracy == null ? '—' : shown.toFixed(1)}</span>
      <span className="acc-caption">Accuracy</span>
      {rating != null && (
        <span className="acc-rating" title="A rough estimate of the playing strength shown in this game, based on accuracy">
          Played like <strong>{rating}</strong>
        </span>
      )}
    </div>
  )
}

// Need enough non-book moves for the estimate to mean anything
const MIN_MOVES_FOR_RATING = 8

export default function ReviewSummary({ summary, headers, done, progress, opening, scoredMoves, onShare, shareState, onDownload }) {
  const rating = side => (done && scoredMoves?.[side] >= MIN_MOVES_FOR_RATING ? estimateRating(summary[side].accuracy) : null)
  return (
    <section className="card summary-card" aria-label="Game review summary">
      <div className="card-head">
        <h2 className="card-title">Game Review</h2>
        {done ? <span className="chip chip-ok">Complete</span> : <span className="chip chip-live">Live · {progress}%</span>}
      </div>
      {opening && <p className="opening-name" title="Opening">📖 {opening}</p>}
      <div className="acc-row">
        <AccuracyTile name={headers.White || 'White'} accuracy={summary.w.accuracy} color="w" rating={rating('w')} />
        <AccuracyTile name={headers.Black || 'Black'} accuracy={summary.b.accuracy} color="b" rating={rating('b')} />
      </div>
      {(onShare || onDownload) && (
        <div className="summary-actions">
          {onShare && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onShare}>
              {shareState === 'copied' ? <Check size={15} /> : <Share2 size={15} />}
              <span>{shareState === 'copied' ? 'Link copied!' : shareState === 'failed' ? 'Copy failed' : 'Share review'}</span>
            </button>
          )}
          {onDownload && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onDownload} disabled={!done} title={done ? 'Download the annotated PGN' : 'Available when the review finishes'}>
              <Download size={15} />
              <span>Download PGN</span>
            </button>
          )}
        </div>
      )}
      <div className="class-table">
        {CLASS_ORDER.map(key => {
          const w = summary.w.counts[key]
          const b = summary.b.counts[key]
          return (
            <div className={`class-line ${w + b === 0 ? 'zero' : ''}`} key={key}>
              <span className="class-count" style={{ color: w ? CLASSES[key].color : undefined }}>{w}</span>
              <span className="class-label">
                <ClassIcon cls={key} size={18} />
                {CLASSES[key].label}
              </span>
              <span className="class-count" style={{ color: b ? CLASSES[key].color : undefined }}>{b}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
