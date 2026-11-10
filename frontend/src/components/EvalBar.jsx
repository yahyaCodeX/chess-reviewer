/**
 * Vertical evaluation bar. `whiteWp` is White's win probability (0–100);
 * the white section grows from the bottom when the board is White-oriented.
 */
export default function EvalBar({ whiteWp = 50, label = '0.0', orientation = 'white', pending = false }) {
  const pct = Math.min(98, Math.max(2, whiteWp))
  const whiteAhead = whiteWp >= 50
  const flipped = orientation === 'black'

  return (
    <div className={`eval-bar ${flipped ? 'flipped' : ''} ${pending ? 'pending' : ''}`} aria-label={`Evaluation ${label}`}>
      <div className="eval-bar-white" style={{ height: `${pct}%` }} />
      <span className={`eval-bar-label ${whiteAhead ? 'on-white' : 'on-black'}`}>{label}</span>
    </div>
  )
}
