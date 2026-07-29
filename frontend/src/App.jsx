import { useState, useEffect, useCallback } from 'react'
import { Chessboard } from 'react-chessboard'
import { Chess } from 'chess.js'
import {
  Cpu,
  Activity,
  ChevronRight,
  Database,
  AlertCircle,
  CheckCircle2,
  Clock,
  Swords,
  BarChart3,
  Loader2,
} from 'lucide-react'
import './index.css'

// ─── Helpers ────────────────────────────────────────────────────────────────

function getEvalClass(evaluation) {
  if (!evaluation) return ''
  if (evaluation.toLowerCase().includes('mate')) return 'eval-mate'
  if (evaluation.startsWith('+')) return 'eval-positive'
  if (evaluation.startsWith('-')) return 'eval-negative'
  return ''
}

function StatusIndicator({ status }) {
  const configs = {
    Idle: { dot: 'status-idle', icon: <Clock size={13} />, color: '#71717a' },
    'Analyzing Engine Data...': { dot: 'status-analyzing', icon: <Loader2 size={13} className="animate-spin" />, color: '#facc15' },
    'Analysis Complete': { dot: 'status-complete', icon: <CheckCircle2 size={13} />, color: '#4ade80' },
    'Error connecting to server': { dot: 'status-error', icon: <AlertCircle size={13} />, color: '#f87171' },
    'Game submitted!': { dot: 'status-analyzing', icon: <Activity size={13} />, color: '#a78bfa' },
  }
  const cfg = configs[status] || configs['Idle']

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: cfg.color, fontSize: '0.8rem', fontWeight: 500 }}>
      <span className={`status-dot ${cfg.dot}`} />
      {cfg.icon}
      <span>{status}</span>
    </div>
  )
}

function EvalCell({ evaluation }) {
  return (
    <span className={getEvalClass(evaluation)}>
      {evaluation || '—'}
    </span>
  )
}

// ─── Main App ────────────────────────────────────────────────────────────────

const STARTING_FEN = new Chess().fen()

export default function App() {
  const [pgnInput, setPgnInput] = useState('')
  const [moves, setMoves] = useState([])
  const [status, setStatus] = useState('Idle')
  const [currentPosition, setCurrentPosition] = useState(STARTING_FEN)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [debugError, setDebugError] = useState(null)
  const [playbackIndex, setPlaybackIndex] = useState(-1)

  // ── Poll backend every 3 seconds ───────────────────────────────────────
  const fetchMoves = useCallback(async () => {
    try {
      const res = await fetch('/api/analysis/moves')
      if (!res.ok) throw new Error('Server error')
      const data = await res.json()
      
      const sortedData = [...data].sort((a, b) => (a.id || 0) - (b.id || 0))
      setMoves(sortedData)
      
      setStatus(prev =>
        sortedData.length > 0 ? 'Analysis Complete' : (prev === 'Analyzing Engine Data...' ? prev : 'Idle')
      )
    } catch (err) {
      console.error("Fetch error:", err)
      setStatus(prev => prev === 'Idle' ? 'Error connecting to server' : prev)
    }
  }, [])

  useEffect(() => {
    fetchMoves()
    const interval = setInterval(fetchMoves, 3000)
    return () => clearInterval(interval)
  }, [fetchMoves])

  // ── Smooth Playback of Moves ───────────────────────────────────────────
  useEffect(() => {
    if (moves.length === 0) {
      setCurrentPosition(STARTING_FEN)
      setPlaybackIndex(-1)
      return
    }

    // If we have more moves than currently played back, advance by one every 500ms
    if (playbackIndex < moves.length - 1) {
      const timer = setTimeout(() => {
        const nextIndex = playbackIndex + 1
        const tempGame = new Chess()
        let failed = null
        
        // Replay up to nextIndex
        for (let i = 0; i <= nextIndex; i++) {
          try {
            tempGame.move(moves[i].moveSan)
          } catch (err) {
            failed = `Failed to apply "${moves[i].moveSan}" (Move ${moves[i].moveNumber} ${moves[i].player}): ${err.message}`
            break
          }
        }
        
        if (failed) {
          setDebugError(failed)
          // Stop playback on error
          setPlaybackIndex(moves.length) 
        } else {
          setCurrentPosition(tempGame.fen())
          setDebugError(null)
          setPlaybackIndex(nextIndex)
        }
      }, 500)
      
      return () => clearTimeout(timer)
    }
  }, [moves, playbackIndex])

  // ── Submit PGN to backend ──────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!pgnInput.trim()) return
    setIsSubmitting(true)
    setStatus('Analyzing Engine Data...')
    setDebugError(null)
    setPlaybackIndex(-1)
    
    try {
      await fetch('/api/analysis/clear', { method: 'DELETE' })
      setMoves([])
      setCurrentPosition(STARTING_FEN)

      // Step 3: Submit the new PGN to be analyzed
      await fetch('/api/analysis/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: pgnInput,
      })
      setStatus('Game submitted!')
    } catch {
      setStatus('Error connecting to server')
    } finally {
      setIsSubmitting(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'relative', minHeight: '100vh', overflowX: 'hidden' }}>

      {/* Ambient background blobs */}
      <div className="bg-blob" style={{ width: 500, height: 500, background: '#6366f1', top: -100, left: -150 }} />
      <div className="bg-blob" style={{ width: 400, height: 400, background: '#8b5cf6', bottom: -100, right: -100 }} />
      <div className="bg-blob" style={{ width: 300, height: 300, background: '#06b6d4', top: '40%', left: '50%' }} />

      {/* Main layout */}
      <div style={{ position: 'relative', zIndex: 1, maxWidth: 1300, margin: '0 auto', padding: '2rem 1.5rem' }}>

        {/* ── Header ── */}
        <header style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
            <div style={{
              width: 42, height: 42, borderRadius: '0.75rem',
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 20px rgba(99,102,241,0.5)'
            }}>
              <Swords size={22} color="white" />
            </div>
            <div>
              <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f4f4f5', lineHeight: 1.2 }}>
                AI Chess Reviewer
              </h1>
              <p style={{ fontSize: '0.75rem', color: '#71717a', fontWeight: 400 }}>
                Powered by Stockfish · Spring Boot · Kafka
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#52525b', fontSize: '0.78rem' }}>
              <Database size={13} />
              <span>{moves.length} moves indexed</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#52525b', fontSize: '0.78rem' }}>
              <Activity size={13} />
              <span>Live · 3s refresh</span>
            </div>
          </div>
        </header>

        {/* ── Two-column layout ── */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: '1.75rem',
          alignItems: 'start',
        }}
          className="responsive-grid"
        >

          {/* ══ LEFT COLUMN: Board ══ */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

            {/* Board card */}
            <div className="glass-card" style={{ padding: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <p className="section-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', margin: 0 }}>
                  <BarChart3 size={11} /> Live Position
                </p>
                <span style={{ fontSize: '0.65rem', color: '#71717a', fontFamily: 'monospace' }}>
                  FEN: {currentPosition.substring(0, 25)}...
                </span>
              </div>
              <div className="board-wrapper">
                <Chessboard
                  id="MainBoard"
                  position={currentPosition}
                  arePiecesDraggable={false}
                  animationDuration={300}
                  customDarkSquareStyle={{ backgroundColor: '#4c1d95' }}
                  customLightSquareStyle={{ backgroundColor: '#ede9fe' }}
                  areArrowsAllowed={false}
                  showBoardNotation={true}
                />
              </div>
            </div>

            {/* Status card */}
            <div className="glass-card" style={{ padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.75rem', color: '#52525b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Engine Status
              </span>
              <StatusIndicator status={status} />
            </div>

            {/* Debug/Error alert */}
            {debugError && (
              <div className="glass-card" style={{ padding: '1rem', border: '1px solid rgba(239, 68, 68, 0.4)', background: 'rgba(239, 68, 68, 0.05)', display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                <AlertCircle size={16} style={{ color: '#ef4444', flexShrink: 0, marginTop: '0.1rem' }} />
                <div>
                  <p style={{ fontSize: '0.78rem', fontWeight: 600, color: '#f87171', marginBottom: '0.25rem' }}>Board Sync Issue</p>
                  <p style={{ fontSize: '0.72rem', color: '#fca5a5', fontFamily: 'monospace' }}>{debugError}</p>
                </div>
              </div>
            )}
          </div>

          {/* ══ RIGHT COLUMN: Controls + Results ══ */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

            {/* Input card */}
            <div className="glass-card" style={{ padding: '1.5rem' }}>
              <p className="section-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Cpu size={11} /> PGN Input
              </p>
              <textarea
                className="pgn-textarea"
                rows={6}
                placeholder={`Paste your PGN here…\n\nExample:\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5`}
                value={pgnInput}
                onChange={e => setPgnInput(e.target.value)}
              />
              <div style={{ marginTop: '1rem' }}>
                <button
                  className="btn-primary"
                  onClick={handleSubmit}
                  disabled={isSubmitting || !pgnInput.trim()}
                >
                  {isSubmitting
                    ? <><Loader2 size={16} className="animate-spin" /> Sending to Kafka...</>
                    : <><Cpu size={16} /> Analyze Game with Stockfish</>
                  }
                </button>
              </div>
            </div>

            {/* Results card */}
            <div className="glass-card" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
                <p className="section-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: 0 }}>
                  <Activity size={11} /> Analysis Results
                </p>
                {moves.length > 0 && (
                  <span style={{
                    fontSize: '0.7rem', fontWeight: 600, color: '#4ade80',
                    background: 'rgba(74,222,128,0.1)', padding: '0.15rem 0.6rem',
                    borderRadius: '9999px', border: '1px solid rgba(74,222,128,0.2)'
                  }}>
                    {moves.length} moves
                  </span>
                )}
              </div>

              <div className="table-container">
                {moves.length === 0 ? (
                  <div className="empty-state">
                    <Swords size={32} strokeWidth={1.2} />
                    <p style={{ fontSize: '0.85rem', fontWeight: 500, color: '#52525b' }}>No analysis data yet</p>
                    <p style={{ fontSize: '0.75rem', color: '#3f3f46', textAlign: 'center', maxWidth: 220 }}>
                      Paste a PGN above and click Analyze to see Stockfish evaluations
                    </p>
                  </div>
                ) : (
                  <table className="moves-table">
                    <thead>
                      <tr>
                        <th style={{ width: 48 }}>#</th>
                        <th>Player</th>
                        <th>Move</th>
                        <th>Evaluation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {moves.map((move, idx) => (
                        <tr key={move.id ?? idx}>
                          <td style={{ color: '#52525b', fontWeight: 600 }}>{move.moveNumber}</td>
                          <td>
                            <span className={move.player === 'White' ? 'player-white' : 'player-black'}>
                              {move.player}
                            </span>
                          </td>
                          <td>
                            <span className="move-san">{move.moveSan}</span>
                          </td>
                          <td>
                            <EvalCell evaluation={move.evaluation} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Footer tip */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#3f3f46', fontSize: '0.73rem', paddingLeft: '0.25rem' }}>
              <ChevronRight size={12} />
              <span>Board auto-updates every 3 seconds. Run <code style={{ color: '#6366f1', fontFamily: 'monospace' }}>python main.py</code> in the ai-worker to start the engine.</span>
            </div>
          </div>
        </div>
      </div>

      {/* Responsive grid style */}
      <style>{`
        @media (max-width: 860px) {
          .responsive-grid {
            grid-template-columns: 1fr !important;
          }
        }
        .animate-spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
