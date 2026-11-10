import { useEffect, useState } from 'react'

const WARMUP_PHRASES = [
  'Sending game to the engine…',
  'Warming up Stockfish…',
  'Checking the opening book…',
  'Setting up the position…',
]

const LIVE_PHRASES = [
  'Calculating variations',
  'Looking for tactics',
  'Weighing candidate moves',
  'Checking for blunders',
  'Measuring win chances',
]

function useCycle(list, ms) {
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setI(v => (v + 1) % list.length), ms)
    return () => clearInterval(t)
  }, [list, ms])
  return list[i]
}

/**
 * Full-board overlay while the game waits in the queue / engine boots.
 * queue: server status ({ queuePosition, etaSeconds }) when known.
 */
export function WarmupOverlay({ total, queuePosition = 0, eta = null }) {
  const phrase = useCycle(WARMUP_PHRASES, 1800)
  const waiting = queuePosition > 0
  return (
    <div className="warmup-overlay" role="status" aria-live="polite">
      <div className="warmup-card">
        <div className="thinking-pieces" aria-hidden="true">
          <span>♞</span><span>♝</span><span>♜</span><span>♛</span>
        </div>
        <p className="warmup-title">{waiting ? 'Waiting in line' : 'Reviewing your game'}</p>
        {waiting ? (
          <p className="warmup-phrase queue-line">
            {queuePosition === 1 ? "You're next" : `You're #${queuePosition} in line`}
            {eta && <span> · {eta}</span>}
          </p>
        ) : (
          <p className="warmup-phrase" key={phrase}>{phrase}</p>
        )}
        <p className="warmup-sub">
          {waiting ? 'Other games are being analyzed first' : `${total} moves to analyze`}
        </p>
      </div>
    </div>
  )
}

/** Progress ring + current move pill, shown while results stream in. */
export function LiveProgressPill({ done, total, currentLabel }) {
  const phrase = useCycle(LIVE_PHRASES, 1600)
  const pct = total > 0 ? done / total : 0
  const r = 15
  const circ = 2 * Math.PI * r
  return (
    <div className="live-pill" role="status" aria-live="polite">
      <svg width="38" height="38" viewBox="0 0 38 38" className="live-ring" aria-hidden="true">
        <circle cx="19" cy="19" r={r} className="ring-track" />
        <circle
          cx="19" cy="19" r={r}
          className="ring-fill"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
        />
        <text x="19" y="23" textAnchor="middle" className="ring-text">{Math.round(pct * 100)}</text>
      </svg>
      <div className="live-text">
        <span className="live-phrase">{phrase}<span className="dots"><i>.</i><i>.</i><i>.</i></span></span>
        <span className="live-move">{currentLabel}</span>
      </div>
    </div>
  )
}
