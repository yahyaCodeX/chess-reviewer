import { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import ClassIcon from './ClassIcon'

/**
 * Paired move list ("1. e4 e5"). Moves not yet analyzed shimmer; the move
 * the engine is working on shows a spinner.
 */
export default function MoveList({ plies, classes, activeIndex, analyzingIndex, onSelect }) {
  const containerRef = useRef(null)
  const activeRef = useRef(null)

  // Keep the active move visible without scrolling the whole page
  useEffect(() => {
    const box = containerRef.current
    const el = activeRef.current
    if (!box || !el) return
    const top = el.offsetTop - box.offsetTop
    if (top < box.scrollTop) box.scrollTop = top - 8
    else if (top + el.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = top + el.offsetHeight - box.clientHeight + 8
    }
  }, [activeIndex])

  const rows = []
  for (let i = 0; i < plies.length; i += 2) rows.push(i)

  const cell = i => {
    const ply = plies[i]
    if (!ply) return <span className="move-cell empty" />
    const cls = classes[i]
    const isActive = i === activeIndex
    const isAnalyzing = i === analyzingIndex
    return (
      <button
        type="button"
        ref={isActive ? activeRef : undefined}
        className={`move-cell ${isActive ? 'active' : ''} ${cls ? `cls-${cls}` : 'pending'}`}
        onClick={() => onSelect(i)}
      >
        <span className="move-cell-icon">
          {cls ? <ClassIcon cls={cls} size={16} /> : isAnalyzing ? <Loader2 size={14} className="spin" /> : <span className="dot-pending" />}
        </span>
        <span className="move-cell-san">{ply.san}</span>
      </button>
    )
  }

  return (
    <div className="move-list" ref={containerRef}>
      {rows.map(i => (
        <div className="move-row" key={i}>
          <span className="move-num">{i / 2 + 1}.</span>
          {cell(i)}
          {cell(i + 1)}
        </div>
      ))}
    </div>
  )
}
