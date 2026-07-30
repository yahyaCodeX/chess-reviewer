import { useState, useEffect, useCallback, useRef } from 'react'
import { Chessboard } from 'react-chessboard'
import { Chess } from 'chess.js'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from 'recharts'
import {
  Cpu,
  Activity,
  ChevronRight,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
  Database,
  AlertCircle,
  CheckCircle2,
  Clock,
  Swords,
  BarChart3,
  Loader2,
  Download,
  TrendingUp,
  Sparkles,
} from 'lucide-react'
import './index.css'

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseEval(evalString) {
  if (!evalString) return 0.0
  const str = String(evalString).trim()
  if (str.toLowerCase().includes('mate')) {
    if (str.toLowerCase().includes('white')) return 10.0
    if (str.toLowerCase().includes('black')) return -10.0
    if (str.startsWith('+')) return 10.0
    if (str.startsWith('-')) return -10.0
    return 10.0
  }
  const val = parseFloat(str)
  if (isNaN(val)) return 0.0
  return Math.min(10.0, Math.max(-10.0, val))
}

/**
 * Converts a pawn-unit evaluation to White's Win Probability (0–100).
 * Uses the Lichess formula: 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)
 */
function calculateWinProbability(evalString) {
  if (!evalString) return 50
  const str = String(evalString).trim()
  if (str.toLowerCase().includes('mate')) {
    // White mate: 100% win chance for White; Black mate: 0% win chance for White
    if (str.toLowerCase().includes('white')) return 100
    if (str.toLowerCase().includes('black')) return 0
    return str.startsWith('+') ? 100 : 0
  }
  const evalPawns = parseEval(evalString)
  const cp = evalPawns * 100
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1)
}

/**
 * Classifies a move using win-probability drop (Lichess standard).
 * winProbabilityDrop = how much the moving side's win chance FELL after their move.
 */
function classifyMove(currentMove, previousMove) {
  if (!currentMove) return { text: 'Good', badgeClass: 'badge-good' }

  const currWinChance = calculateWinProbability(currentMove.evaluation)
  const prevWinChance = previousMove
    ? calculateWinProbability(previousMove.evaluation)
    : 50

  const isWhite = (currentMove.player || '').toLowerCase() === 'white'

  // For White: a drop means currWinChance < prevWinChance → drop = prev - curr
  // For Black: White's win chance going UP means Black lost ground → drop = curr - prev
  const winProbabilityDrop = isWhite
    ? prevWinChance - currWinChance
    : currWinChance - prevWinChance

  if (winProbabilityDrop >= 20) {
    return { text: 'Blunder', badgeClass: 'badge-blunder' }
  }
  if (winProbabilityDrop >= 10) {
    return { text: 'Mistake', badgeClass: 'badge-mistake' }
  }
  if (winProbabilityDrop >= 5) {
    return { text: 'Inaccuracy', badgeClass: 'badge-inaccuracy' }
  }
  if (winProbabilityDrop < -5) {
    return { text: 'Great', badgeClass: 'badge-great' }
  }
  return { text: 'Good', badgeClass: 'badge-good' }
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

function CustomChartTooltip({ active, payload }) {
  if (active && payload && payload.length) {
    const data = payload[0].payload
    return (
      <div style={{
        background: '#18181b',
        border: '1px solid #3f3f46',
        borderRadius: '0.5rem',
        padding: '0.5rem 0.75rem',
        fontSize: '0.75rem',
        color: '#f4f4f5',
        boxShadow: '0 10px 25px rgba(0,0,0,0.5)'
      }}>
        <p style={{ fontWeight: 700, color: '#a5b4fc', marginBottom: '0.2rem' }}>
          Move {data.moveNumber}: {data.moveSan} ({data.player})
        </p>
        <p style={{ color: data.evaluation >= 0 ? '#4ade80' : '#f87171', fontWeight: 600 }}>
          Eval: {data.rawEval} ({data.evaluation > 0 ? `+${data.evaluation.toFixed(2)}` : data.evaluation.toFixed(2)})
        </p>
      </div>
    )
  }
  return null
}

// ─── Main App ────────────────────────────────────────────────────────────────

const STARTING_FEN = new Chess().fen()

export default function App() {
  const [pgnInput, setPgnInput] = useState('')
  const [chessComUsername, setChessComUsername] = useState('')
  const [isFetchingChessCom, setIsFetchingChessCom] = useState(false)
  const [moves, setMoves] = useState([])
  const [status, setStatus] = useState('Idle')
  const [currentPosition, setCurrentPosition] = useState(STARTING_FEN)
  const [currentMoveIndex, setCurrentMoveIndex] = useState(-1)
  const [squareStyles, setSquareStyles] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [debugError, setDebugError] = useState(null)

  const rowRefs = useRef([])
  // Tracks whether the user has manually clicked a nav button.
  // Prevents the 3-second poll from resetting their position back to the last move.
  const userHasNavigated = useRef(false)

  // ── Fetch Latest Game from Chess.com API ────────────────────────────────
  const fetchLatestChessComGame = async (username) => {
    const cleanUser = (username || chessComUsername)?.trim()
    if (!cleanUser) {
      setDebugError('Please enter a Chess.com username.')
      return
    }

    setIsFetchingChessCom(true)
    setDebugError(null)

    try {
      const archivesRes = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(cleanUser)}/games/archives`)
      if (!archivesRes.ok) {
        if (archivesRes.status === 404) {
          throw new Error(`Chess.com user "${cleanUser}" not found.`)
        }
        throw new Error(`Failed to fetch archives for user "${cleanUser}".`)
      }
      const archivesData = await archivesRes.json()

      if (!archivesData.archives || archivesData.archives.length === 0) {
        throw new Error(`No game archives found for user "${cleanUser}".`)
      }

      const latestArchiveUrl = archivesData.archives[archivesData.archives.length - 1]

      const gamesRes = await fetch(latestArchiveUrl)
      if (!gamesRes.ok) {
        throw new Error('Failed to fetch monthly game archive.')
      }
      const gamesData = await gamesRes.json()

      if (!gamesData.games || gamesData.games.length === 0) {
        throw new Error(`No games found in the latest archive for "${cleanUser}".`)
      }

      const latestGame = gamesData.games[gamesData.games.length - 1]
      if (!latestGame.pgn) {
        throw new Error('Latest game record does not contain a PGN string.')
      }

      setPgnInput(latestGame.pgn)
      setDebugError(null)
      setStatus(`Loaded latest game for ${cleanUser}!`)
    } catch (err) {
      console.error('Chess.com API Error:', err)
      setDebugError(err.message || 'Error fetching game from Chess.com')
    } finally {
      setIsFetchingChessCom(false)
    }
  }

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

  // Auto-initialize currentMoveIndex only on first load or after a clear.
  // If the user has already manually navigated, never override their position.
  useEffect(() => {
    if (moves.length === 0) {
      // Game cleared – fully reset
      setCurrentMoveIndex(-1)
      userHasNavigated.current = false
    } else if (!userHasNavigated.current && currentMoveIndex === -1) {
      // First time analysis results arrive and user hasn't navigated yet
      setCurrentMoveIndex(moves.length - 1)
    }
    // If userHasNavigated.current is true, we do NOTHING – respect the user's position
  }, [moves])

  // ── Synchronize Board & Square Highlighting with currentMoveIndex ───────
  useEffect(() => {
    if (!moves || moves.length === 0 || currentMoveIndex < 0) {
      setCurrentPosition(STARTING_FEN)
      setSquareStyles({})
      setDebugError(null)
      return
    }

    const newGame = new Chess()
    const sortedMoves = [...moves].sort((a, b) => (a.id || a.moveNumber || 0) - (b.id || b.moveNumber || 0))

    const maxIdx = Math.min(currentMoveIndex, sortedMoves.length - 1)
    let lastMoveVerbose = null
    let hasError = false

    for (let i = 0; i <= maxIdx; i++) {
      const moveObj = sortedMoves[i]
      const cleanMove = moveObj?.moveSan ? moveObj.moveSan.trim() : ''
      if (!cleanMove) continue

      try {
        const moveRes = newGame.move(cleanMove)
        if (i === maxIdx) {
          lastMoveVerbose = moveRes
        }
      } catch (err) {
        console.error(`Illegal or out-of-sequence move skipped: "${cleanMove}"`, err)
        setDebugError(`Invalid move encountered: "${cleanMove}" (${err.message})`)
        hasError = true
        break
      }
    }

    if (!hasError) {
      setDebugError(null)
    }

    setCurrentPosition(newGame.fen())

    // Board Square Highlighting
    if (lastMoveVerbose) {
      const curMove = sortedMoves[maxIdx]
      const prevMove = maxIdx > 0 ? sortedMoves[maxIdx - 1] : null
      const classification = classifyMove(curMove, prevMove)

      const highlightColors = {
        Blunder: 'rgba(239, 68, 68, 0.65)',
        Mistake: 'rgba(249, 115, 22, 0.65)',
        Inaccuracy: 'rgba(234, 179, 8, 0.65)',
        Great: 'rgba(6, 182, 212, 0.65)',
        Good: 'rgba(34, 197, 94, 0.55)',
      }

      const toColor = highlightColors[classification.text] || 'rgba(34, 197, 94, 0.55)'

      setSquareStyles({
        [lastMoveVerbose.from]: { backgroundColor: 'rgba(253, 224, 71, 0.45)' },
        [lastMoveVerbose.to]: { backgroundColor: toColor },
      })
    } else {
      setSquareStyles({})
    }
  }, [moves, currentMoveIndex])

  // ── Auto-scroll active row in moves table ──────────────────────────────
  useEffect(() => {
    if (currentMoveIndex >= 0 && rowRefs.current[currentMoveIndex]) {
      rowRefs.current[currentMoveIndex].scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      })
    }
  }, [currentMoveIndex])

  // ── Submit PGN to backend ──────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!pgnInput.trim()) return
    setIsSubmitting(true)
    setStatus('Analyzing Engine Data...')
    setDebugError(null)
    // Reset navigation state for the new game
    setCurrentMoveIndex(-1)
    userHasNavigated.current = false
    
    try {
      await fetch('/api/analysis/clear', { method: 'DELETE' })
      setMoves([])
      setCurrentPosition(STARTING_FEN)

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

  // ── Move Navigation Handlers ───────────────────────────────────────────
  const handleFirstMove = () => {
    userHasNavigated.current = true
    setCurrentMoveIndex(-1)
  }
  const handlePrevMove = () => {
    userHasNavigated.current = true
    setCurrentMoveIndex(prev => Math.max(-1, prev - 1))
  }
  const handleNextMove = () => {
    userHasNavigated.current = true
    setCurrentMoveIndex(prev => Math.min(moves.length - 1, prev + 1))
  }
  const handleLastMove = () => {
    userHasNavigated.current = true
    setCurrentMoveIndex(moves.length - 1)
  }

  // ── Active Move & Classification ──────────────────────────────────────
  const activeMove = currentMoveIndex >= 0 && moves[currentMoveIndex] ? moves[currentMoveIndex] : null
  const prevMoveObj = currentMoveIndex > 0 ? moves[currentMoveIndex - 1] : null
  const activeClassification = classifyMove(activeMove, prevMoveObj)

  // ── Chart Data & Gradient Offset ──────────────────────────────────────
  const chartData = moves.map((m, idx) => ({
    index: idx,
    moveNumber: m.moveNumber,
    moveSan: m.moveSan,
    evaluation: parseEval(m.evaluation),
    rawEval: m.evaluation || '0.0',
    player: m.player,
  }))

  const getGradientOffset = () => {
    if (chartData.length === 0) return 0.5
    const dataMax = Math.max(...chartData.map(i => i.evaluation))
    const dataMin = Math.min(...chartData.map(i => i.evaluation))

    if (dataMax <= 0) return 0
    if (dataMin >= 0) return 1

    return dataMax / (dataMax - dataMin)
  }

  const off = getGradientOffset()

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

          {/* ══ LEFT COLUMN: Board & Evaluation Chart ══ */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

            {/* Board card */}
            <div className="glass-card" style={{ padding: '1.25rem' }}>

              {/* ── Coach Banner (Replaces raw FEN string) ── */}
              <div style={{
                background: 'rgba(9, 9, 11, 0.6)',
                border: '1px solid rgba(63, 63, 70, 0.5)',
                borderRadius: '0.75rem',
                padding: '0.75rem 1rem',
                marginBottom: '1rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
              }}>
                <div style={{
                  width: 34, height: 34, borderRadius: '50%',
                  background: 'linear-gradient(135deg, #10b981, #059669)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 0 12px rgba(16,185,129,0.3)',
                  flexShrink: 0
                }}>
                  <Sparkles size={18} color="white" />
                </div>
                <div>
                  <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717a', fontWeight: 700, margin: 0 }}>
                    Coach Feedback
                  </p>
                  {currentMoveIndex < 0 || !activeMove ? (
                    <p style={{ fontSize: '0.85rem', fontWeight: 600, color: '#e4e4e7', margin: 0 }}>
                      Starting position. Use the controls or click moves to navigate!
                    </p>
                  ) : (
                    <p style={{ fontSize: '0.88rem', fontWeight: 600, color: '#e4e4e7', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <span>{activeMove.player}</span> played <span className="move-san">{activeMove.moveSan}</span>.
                      <span>This is a</span>
                      <span className={`move-badge ${activeClassification.badgeClass}`} style={{ fontSize: '0.72rem', padding: '0.2rem 0.6rem' }}>
                        {activeClassification.text}
                      </span>
                    </p>
                  )}
                </div>
              </div>

              {/* ── Chessboard Component with Square Highlighting ── */}
              <div className="board-wrapper">
                <Chessboard
                  key={currentPosition}
                  options={{
                    id: 'MainBoard',
                    position: currentPosition,
                    allowDragging: false,
                    animationDurationInMs: 300,
                    darkSquareStyle: { backgroundColor: '#4c1d95' },
                    lightSquareStyle: { backgroundColor: '#ede9fe' },
                    allowDrawingArrows: false,
                    showNotation: true,
                    squareStyles: squareStyles,
                  }}
                />
              </div>

              {/* ── Move Navigation Controls ── */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginTop: '1rem' }}>
                <button
                  type="button"
                  className="btn-nav"
                  onClick={handleFirstMove}
                  disabled={currentMoveIndex <= -1 || moves.length === 0}
                  title="Start of game"
                >
                  <ChevronsLeft size={16} />
                </button>
                <button
                  type="button"
                  className="btn-nav"
                  onClick={handlePrevMove}
                  disabled={currentMoveIndex <= -1 || moves.length === 0}
                  title="Previous move"
                >
                  <ChevronLeft size={16} />
                </button>
                <span style={{ fontSize: '0.8rem', color: '#a1a1aa', minWidth: '95px', textAlign: 'center', fontFamily: 'monospace', fontWeight: 600 }}>
                  {currentMoveIndex < 0 ? 'Start (0)' : `Move ${currentMoveIndex + 1} / ${moves.length}`}
                </span>
                <button
                  type="button"
                  className="btn-nav"
                  onClick={handleNextMove}
                  disabled={currentMoveIndex >= moves.length - 1 || moves.length === 0}
                  title="Next move"
                >
                  <ChevronRight size={16} />
                </button>
                <button
                  type="button"
                  className="btn-nav"
                  onClick={handleLastMove}
                  disabled={currentMoveIndex >= moves.length - 1 || moves.length === 0}
                  title="End of game"
                >
                  <ChevronsRight size={16} />
                </button>
              </div>
            </div>

            {/* Evaluation Chart Card */}
            <div className="glass-card" style={{ padding: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <p className="section-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', margin: 0 }}>
                  <TrendingUp size={11} /> Evaluation Chart
                </p>
                <span style={{ fontSize: '0.68rem', color: '#71717a' }}>
                  Click chart point to jump to move
                </span>
              </div>

              {moves.length === 0 ? (
                <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#52525b', fontSize: '0.8rem' }}>
                  No evaluation data available
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={150}>
                  <AreaChart
                    data={chartData}
                    margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    onClick={(e) => {
                      if (e && e.activeTooltipIndex !== undefined && e.activeTooltipIndex !== null) {
                        setCurrentMoveIndex(e.activeTooltipIndex)
                      }
                    }}
                  >
                    <defs>
                      <linearGradient id="splitColor" x1="0" y1="0" x2="0" y2="1">
                        <stop offset={off} stopColor="#4ade80" stopOpacity={0.35} />
                        <stop offset={off} stopColor="#ef4444" stopOpacity={0.35} />
                      </linearGradient>
                      <linearGradient id="splitStroke" x1="0" y1="0" x2="0" y2="1">
                        <stop offset={off} stopColor="#4ade80" stopOpacity={1} />
                        <stop offset={off} stopColor="#ef4444" stopOpacity={1} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="moveSan" stroke="#52525b" fontSize={10} tickLine={false} />
                    <YAxis domain={[-10, 10]} stroke="#52525b" fontSize={10} tickLine={false} />
                    <Tooltip content={<CustomChartTooltip />} />
                    <ReferenceLine y={0} stroke="#71717a" strokeDasharray="3 3" />
                    {currentMoveIndex >= 0 && moves[currentMoveIndex] && (
                      <ReferenceLine x={moves[currentMoveIndex].moveSan} stroke="#8b5cf6" strokeWidth={2} />
                    )}
                    <Area
                      type="monotone"
                      dataKey="evaluation"
                      stroke="url(#splitStroke)"
                      fill="url(#splitColor)"
                      strokeWidth={2}
                      activeDot={{
                        r: 6,
                        fill: '#8b5cf6',
                        stroke: '#ffffff',
                        strokeWidth: 2,
                      }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
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
              <p className="section-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.75rem' }}>
                <Cpu size={11} /> PGN Input
              </p>

              {/* Chess.com Integration Controls */}
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.875rem', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  className="username-input"
                  placeholder="Enter Chess.com Username..."
                  value={chessComUsername}
                  onChange={e => setChessComUsername(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') fetchLatestChessComGame(chessComUsername)
                  }}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => fetchLatestChessComGame(chessComUsername)}
                  disabled={isFetchingChessCom || !chessComUsername.trim()}
                >
                  {isFetchingChessCom ? (
                    <><Loader2 size={14} className="animate-spin" /> Fetching...</>
                  ) : (
                    <><Download size={14} /> Fetch Latest Game</>
                  )}
                </button>
              </div>

              <textarea
                className="pgn-textarea"
                rows={6}
                placeholder={`Paste your PGN here or fetch from Chess.com above…\n\nExample:\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5`}
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
                        <th style={{ width: 40 }}>#</th>
                        <th>Player</th>
                        <th>Move</th>
                        <th>Classification</th>
                      </tr>
                    </thead>
                    <tbody>
                      {moves.map((move, idx) => {
                        const prevMove = idx > 0 ? moves[idx - 1] : null
                        const classification = classifyMove(move, prevMove)
                        const isActive = idx === currentMoveIndex

                        return (
                          <tr
                            key={move.id ?? idx}
                            ref={el => rowRefs.current[idx] = el}
                            onClick={() => setCurrentMoveIndex(idx)}
                            className={isActive ? 'active-move-row' : ''}
                            style={{ cursor: 'pointer' }}
                          >
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
                              <span className={`move-badge ${classification.badgeClass}`}>
                                {classification.text}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Footer tip */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#3f3f46', fontSize: '0.73rem', paddingLeft: '0.25rem' }}>
              <ChevronRight size={12} />
              <span>Click any move or chart point to jump the board. Run <code style={{ color: '#6366f1', fontFamily: 'monospace' }}>python main.py</code> in ai-worker to start engine.</span>
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
