import { useState, useEffect, useCallback, useRef } from 'react'
import { Chessboard } from 'react-chessboard'
import { Chess } from 'chess.js'
import {
  ResponsiveContainer,
  LineChart,
  Line,
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
  Calendar,
  Timer,
  Search,
  X,
  BookOpen,
} from 'lucide-react'
import { Client } from '@stomp/stompjs'
import './index.css'

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseEval(evalString) {
  if (!evalString) return 0.0
  const str = String(evalString).trim()
  // Book moves sit at neutral 0 on the eval chart
  if (str === 'BOOK') return 0.0
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
 * Converts an evaluation string to White's Win Probability (0–100).
 *
 * Handles three cases in strict priority order:
 *   1. "BOOK"           → neutral 50 (opening theory, no engine eval)
 *   2. "Mate in N for White/Black" → 100 or 0
 *   3. Centipawn float (e.g. "+1.50") → Lichess logistic curve
 *
 * Formula: 50 + 50 × (2 / (1 + e^(-0.00368208 × cp)) − 1)
 */
function calculateWinProbability(evalString) {
  if (!evalString) return 50
  const str = String(evalString).trim()

  // 1. Book move — treat as dead equal
  if (str === 'BOOK') return 50

  // 2. Forced mate — parse "Mate in N for White" / "Mate in N for Black"
  const lower = str.toLowerCase()
  if (lower.includes('mate')) {
    if (lower.includes('white')) return 100
    if (lower.includes('black')) return 0
    // Legacy fallback: +/- sign prefix
    return str.startsWith('-') ? 0 : 100
  }

  // 3. Centipawn evaluation via Lichess logistic curve
  const evalPawns = parseFloat(str)
  if (isNaN(evalPawns)) return 50
  const cp = evalPawns * 100  // pawns → centipawns
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1)
}

/**
 * Classifies a move using Win Probability Drop (WPD) — Chess.com / Lichess standard.
 *
 * Priority overrides (checked before any WP math):
 *   ► Checkmate (#)  → BEST  (avoids false "Blunder" due to eval discontinuity)
 *   ► BOOK eval      → BOOK  (opening theory; no classification needed)
 *
 * WPD = how many percentage points the *moving side’s* win chance dropped:
 *   White moved: wpDrop = prevWP − currWP
 *   Black moved: wpDrop = currWP − prevWP  (White’s WP rising hurts Black)
 *
 * Thresholds:
 *   wpDrop ≥ 20  → BLUNDER
 *   wpDrop ≥ 10  → MISTAKE
 *   wpDrop ≥  5  → INACCURACY
 *   wpDrop ≤ -15 → BRILLIANT  (huge spike in moving side’s win chance)
 *   wpDrop ≤  -5 → GREAT
 *   else         → GOOD / BEST
 */
function classifyMove(currentMove, previousMove) {
  if (!currentMove) return { text: 'Good', label: 'Good', badgeClass: 'badge-good' }

  // ── Override 1: Checkmate — always BEST, never misclassify due to eval math ──
  if (currentMove.moveSan && currentMove.moveSan.includes('#')) {
    return { text: 'Best!', label: 'Best', badgeClass: 'badge-best' }
  }

  // ── Override 2: Opening book move ───────────────────────────────────
  if (currentMove.evaluation === 'BOOK') {
    return { text: 'Book', label: 'Book', badgeClass: 'badge-book' }
  }

  // ── Win Probability Drop calculation ───────────────────────────────
  const currWP = calculateWinProbability(currentMove.evaluation)
  const prevWP = previousMove
    ? calculateWinProbability(previousMove.evaluation)
    : 50  // Start of game baseline

  const isWhite = (currentMove.player || '').toLowerCase() === 'white'
  const wpDrop = isWhite ? prevWP - currWP : currWP - prevWP

  if (wpDrop >= 20) return { text: 'Blunder', label: 'Blunder', badgeClass: 'badge-blunder' }
  if (wpDrop >= 10) return { text: 'Mistake', label: 'Mistake', badgeClass: 'badge-mistake' }
  if (wpDrop >=  5) return { text: 'Inaccuracy', label: 'Inaccuracy', badgeClass: 'badge-inaccuracy' }
  if (wpDrop <= -15) return { text: 'Brilliant!!', label: 'Brilliant', badgeClass: 'badge-brilliant' }
  if (wpDrop <=  -5) return { text: 'Great!', label: 'Great', badgeClass: 'badge-great' }
  return { text: 'Good', label: 'Good', badgeClass: 'badge-good' }
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

// ── Analysis cycling phrases ─────────────────────────────────────────────
const ANALYSIS_PHRASES = [
  'Initializing Stockfish 16...',
  'Running High-Depth Analysis...',
  'Calculating Win Probabilities...',
  'Identifying Brilliant Moves...',
  'Checking Opening Theory...',
  'Evaluating Tactical Patterns...',
  'Scanning for Blunders & Mistakes...',
  'Building Evaluation Graph...',
]

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8080';
const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8080/ws';

export default function App() {
  const [pgnInput, setPgnInput] = useState('')
  const [chessComUsername, setChessComUsername] = useState('')
  const [isFetchingChessCom, setIsFetchingChessCom] = useState(false)
  const [chessComGames, setChessComGames] = useState([])
  const [selectedGameIndex, setSelectedGameIndex] = useState(-1)
  const [moves, setMoves] = useState([])
  const [status, setStatus] = useState('Idle')
  const [currentPosition, setCurrentPosition] = useState(STARTING_FEN)
  const [currentMoveIndex, setCurrentMoveIndex] = useState(-1)
  const [squareStyles, setSquareStyles] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [debugError, setDebugError] = useState(null)
  const [currentGameId, setCurrentGameId] = useState(null)
  const [totalMoves, setTotalMoves] = useState(0)
  const [phraseIdx, setPhraseIdx] = useState(0)

  const rowRefs = useRef([])
  const tableContainerRef = useRef(null)
  // Tracks whether the user has manually clicked a nav button.
  // Prevents the 3-second poll from resetting their position back to the last move.
  const userHasNavigated = useRef(false)

  // ── Fetch all games from Chess.com API (latest month) ──────────────────
  const fetchChessComGames = async (username) => {
    const cleanUser = (username || chessComUsername)?.trim()
    if (!cleanUser) {
      setDebugError('Please enter a Chess.com username.')
      return
    }

    setIsFetchingChessCom(true)
    setDebugError(null)
    setChessComGames([])
    setSelectedGameIndex(-1)

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

      // Store all games, most recent first
      const allGames = [...gamesData.games].reverse()
      setChessComGames(allGames)
      setDebugError(null)
      setStatus(`Found ${allGames.length} games for ${cleanUser}`)
    } catch (err) {
      console.error('Chess.com API Error:', err)
      setDebugError(err.message || 'Error fetching games from Chess.com')
    } finally {
      setIsFetchingChessCom(false)
    }
  }

  // ── Helper: classify game result relative to the searched user ──────────
  const getGameResult = (game) => {
    const user = chessComUsername.trim().toLowerCase()
    const whiteUser = (game.white?.username || '').toLowerCase()
    const blackUser = (game.black?.username || '').toLowerCase()
    const isWhite = whiteUser === user
    const playerSide = isWhite ? game.white : game.black
    const result = playerSide?.result || ''

    if (result === 'win') return { text: 'Win', className: 'result-win' }
    if (['checkmated', 'timeout', 'resigned', 'abandoned'].includes(result)) return { text: 'Loss', className: 'result-loss' }
    return { text: 'Draw', className: 'result-draw' }
  }

  // ── Helper: format game date ────────────────────────────────────────────
  const formatGameDate = (endTime) => {
    if (!endTime) return ''
    const d = new Date(endTime * 1000)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  // ── Helper: extract time control label ──────────────────────────────────
  const formatTimeControl = (tc) => {
    if (!tc) return '?'
    const parts = tc.split('+')
    const base = parseInt(parts[0], 10)
    const inc = parts[1] ? parseInt(parts[1], 10) : 0
    if (base >= 600) return `${Math.floor(base / 60)}+${inc}`
    return `${Math.floor(base / 60)}+${inc}`
  }

  // ── Select a game from the browser ─────────────────────────────────────
  const handleSelectGame = (idx) => {
    setSelectedGameIndex(idx)
    const game = chessComGames[idx]
    if (game?.pgn) {
      setPgnInput(game.pgn)
    }
  }

  // ── Close the game browser ─────────────────────────────────────────────
  const handleCloseGameBrowser = () => {
    setChessComGames([])
    setSelectedGameIndex(-1)
  }

  // ── Cycling analysis phrases while scanning ──────────────────────────────
  const isAnalyzing = currentGameId !== null && totalMoves > 0 && moves.length < totalMoves

  useEffect(() => {
    if (!isAnalyzing) return
    const interval = setInterval(() => {
      setPhraseIdx(prev => (prev + 1) % ANALYSIS_PHRASES.length)
    }, 1500)
    return () => clearInterval(interval)
  }, [isAnalyzing])

  // ── STOMP WebSocket: subscribe dynamically to the private game channel ─────
  useEffect(() => {
    if (!currentGameId) return

    const client = new Client({
      brokerURL: wsUrl,
      reconnectDelay: 5000,
      onConnect: () => {
        console.log(`✅ Subscribed to /topic/moves/${currentGameId}`)

        client.subscribe(`/topic/moves/${currentGameId}`, (message) => {
          try {
            const moveData = JSON.parse(message.body)
            console.log('⚡ Real-time move via WebSocket:', moveData)

            setMoves(prevMoves => {
              const updated = [...prevMoves, moveData]
              if (!userHasNavigated.current) {
                setCurrentMoveIndex(updated.length - 1)
              }
              return updated
            })

            setStatus('Analyzing Engine Data...')
          } catch (err) {
            console.error('Error parsing WebSocket move:', err)
          }
        })
      },
      onStompError: (frame) => {
        console.error('STOMP Error:', frame.headers?.['message'], frame.body)
      },
      onWebSocketError: (err) => {
        console.warn('WebSocket connection failed, HTTP polling is active as fallback.', err)
      }
    })

    client.activate()

    return () => {
      client.deactivate()
    }
  }, [currentGameId])

  // ── HTTP Polling Fallback (scoped to the active gameId) ────────────────
  const fetchMoves = useCallback(async () => {
    if (!currentGameId) return
    try {
      const res = await fetch(`${apiUrl}/api/analysis/moves`)
      if (!res.ok) return
      const data = await res.json()

      // Filter to only moves belonging to the current game session
      const gameMoves = data.filter(m => m.gameId === currentGameId)

      if (gameMoves.length > 0) {
        const sortedData = [...gameMoves].sort((a, b) => (a.id || 0) - (b.id || 0))
        setMoves(prev => {
          // Only update if polling found more moves than we have (avoid overwriting WS data)
          if (sortedData.length > prev.length) return sortedData
          return prev
        })
        setStatus('Analysis Complete')
      }
    } catch {
      // Silently ignore — WebSocket is the primary channel
    }
  }, [currentGameId])

  useEffect(() => {
    fetchMoves()
    const interval = setInterval(fetchMoves, 3000)
    return () => clearInterval(interval)
  }, [fetchMoves])

  // Detect analysis completion: when streamed moves reach the expected total
  useEffect(() => {
    if (totalMoves > 0 && moves.length >= totalMoves) {
      setStatus('Analysis Complete')
    }
  }, [moves.length, totalMoves])

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
        'Brilliant!!': 'rgba(27, 193, 161, 0.75)',
        'Great!':      'rgba(92, 139, 176, 0.75)',
        Blunder:       'rgba(202, 52, 49, 0.75)',
        Mistake:       'rgba(229, 143, 42, 0.75)',
        Inaccuracy:    'rgba(240, 193, 92, 0.75)',
        Good:          'rgba(129, 182, 76, 0.65)',
        Book:          'rgba(99, 102, 241, 0.65)',   // indigo for book moves
        'Best!':       'rgba(250, 204, 21, 0.75)',   // gold for checkmate
      }

      const toColor = highlightColors[classification.text] || 'rgba(129, 182, 76, 0.65)'

      setSquareStyles({
        [lastMoveVerbose.from]: { backgroundColor: 'rgba(253, 224, 71, 0.45)' },
        [lastMoveVerbose.to]: { backgroundColor: toColor },
      })
    } else {
      setSquareStyles({})
    }
  }, [moves, currentMoveIndex])

  // ── Auto-scroll active row in moves table WITHOUT jumping main page ──────
  useEffect(() => {
    if (currentMoveIndex >= 0 && rowRefs.current[currentMoveIndex] && tableContainerRef.current) {
      const container = tableContainerRef.current
      const row = rowRefs.current[currentMoveIndex]
      const rowTop = row.offsetTop
      const rowBottom = rowTop + row.offsetHeight
      const containerTop = container.scrollTop
      const containerBottom = containerTop + container.clientHeight

      if (rowTop < containerTop) {
        container.scrollTop = rowTop
      } else if (rowBottom > containerBottom) {
        container.scrollTop = rowBottom - container.clientHeight
      }
    }
  }, [currentMoveIndex])

  // ── Keyboard Arrow Keys Navigation (Left/Right Arrow) ───────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't trigger if user is typing inside input or textarea
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return

      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        userHasNavigated.current = true
        setCurrentMoveIndex(prev => Math.max(-1, prev - 1))
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        userHasNavigated.current = true
        setCurrentMoveIndex(prev => Math.min(moves.length - 1, prev + 1))
      } else if (e.key === 'Home') {
        e.preventDefault()
        userHasNavigated.current = true
        setCurrentMoveIndex(-1)
      } else if (e.key === 'End') {
        e.preventDefault()
        userHasNavigated.current = true
        setCurrentMoveIndex(moves.length - 1)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [moves.length])

  // ── Submit PGN to backend ──────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!pgnInput.trim()) return
    setIsSubmitting(true)
    setStatus('Analyzing Engine Data...')
    setDebugError(null)
    setPhraseIdx(0)
    // Immediately clear the board and moves for the new game
    setMoves([])
    setCurrentPosition(STARTING_FEN)
    setCurrentMoveIndex(-1)
    userHasNavigated.current = false

    // Pre-calculate total moves so we can show progress
    try {
      const tempGame = new Chess()
      tempGame.loadPgn(pgnInput)
      setTotalMoves(tempGame.history().length)
    } catch {
      setTotalMoves(0)
    }

    try {
      const res = await fetch(`${apiUrl}/api/analysis/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: pgnInput,
      })
      const gameId = await res.text()
      console.log(`🆔 New game session started: ${gameId}`)
      setCurrentGameId(gameId)
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#4ade80', fontSize: '0.78rem', fontWeight: 600 }}>
              <Activity size={13} />
              <span>STOMP WebSocket Live</span>
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
          <div className="left-column" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

            {/* Board card */}
            <div className="glass-card board-card" style={{ padding: '1.25rem' }}>

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
                      {isAnalyzing ? ANALYSIS_PHRASES[phraseIdx] : 'Starting position. Use the controls or click moves to navigate!'}
                    </p>
                  ) : (
                    <p style={{ fontSize: '0.88rem', fontWeight: 600, color: '#e4e4e7', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <span>{activeMove.player}</span> played <span className="move-san">{activeMove.moveSan}</span>.
                      {activeClassification.label === 'Book' ? (
                        <span className={`move-badge ${activeClassification.badgeClass}`} style={{ fontSize: '0.72rem', padding: '0.2rem 0.6rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                          <BookOpen size={11} /> {activeClassification.text}
                        </span>
                      ) : (
                        <>
                          <span>This is a</span>
                          <span className={`move-badge ${activeClassification.badgeClass}`} style={{ fontSize: '0.72rem', padding: '0.2rem 0.6rem' }}>
                            {activeClassification.text}
                          </span>
                        </>
                      )}
                    </p>
                  )}
                </div>
              </div>

              {/* ── Chessboard Component with Square Highlighting ── */}
              {/* Board + Scanner share a relative container */}
              <div style={{ position: 'relative' }}>
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
                {/* Scanner is a sibling — not clipped by board-wrapper overflow:hidden */}
                {isAnalyzing && (
                  <div className="board-scanner" />
                )}
              </div>

              {/* ── Analysis Progress Bar ── */}
              {isAnalyzing && totalMoves > 0 && (
                <div style={{ marginTop: '0.875rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                    <span style={{ fontSize: '0.7rem', color: '#a78bfa', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Loader2 size={11} className="animate-spin" />
                      {ANALYSIS_PHRASES[phraseIdx]}
                    </span>
                    <span style={{ fontSize: '0.7rem', color: '#52525b', fontFamily: 'monospace' }}>
                      {moves.length} / {totalMoves}
                    </span>
                  </div>
                  <div className="progress-track">
                    <div
                      className="progress-fill"
                      style={{ width: `${Math.min(100, (moves.length / totalMoves) * 100)}%` }}
                    />
                  </div>
                </div>
              )}

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
            <div className="glass-card chart-card" style={{ padding: '1.25rem' }}>
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
                  <LineChart
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
                    <Line
                      type="monotone"
                      dataKey="evaluation"
                      stroke="url(#splitStroke)"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{
                        r: 6,
                        fill: '#8b5cf6',
                        stroke: '#ffffff',
                        strokeWidth: 2,
                      }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Status card */}
            <div className="glass-card status-card" style={{ padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.75rem', color: '#52525b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Engine Status
              </span>
              <StatusIndicator status={status} />
            </div>

            {/* Debug/Error alert */}
            {debugError && (
              <div className="glass-card debug-card" style={{ padding: '1rem', border: '1px solid rgba(239, 68, 68, 0.4)', background: 'rgba(239, 68, 68, 0.05)', display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                <AlertCircle size={16} style={{ color: '#ef4444', flexShrink: 0, marginTop: '0.1rem' }} />
                <div>
                  <p style={{ fontSize: '0.78rem', fontWeight: 600, color: '#f87171', marginBottom: '0.25rem' }}>Board Sync Issue</p>
                  <p style={{ fontSize: '0.72rem', color: '#fca5a5', fontFamily: 'monospace' }}>{debugError}</p>
                </div>
              </div>
            )}
          </div>

          {/* ══ RIGHT COLUMN: Controls + Results ══ */}
          <div className="right-column" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

            {/* Input card */}
            <div className="glass-card controls-card" style={{ padding: '1.5rem' }}>
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
                    if (e.key === 'Enter') fetchChessComGames(chessComUsername)
                  }}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => fetchChessComGames(chessComUsername)}
                  disabled={isFetchingChessCom || !chessComUsername.trim()}
                >
                  {isFetchingChessCom ? (
                    <><Loader2 size={14} className="animate-spin" /> Fetching...</>
                  ) : (
                    <><Search size={14} /> Fetch Games</>
                  )}
                </button>
              </div>

              {/* ── Game Browser Panel ── */}
              {chessComGames.length > 0 && (
                <div style={{ marginBottom: '0.875rem' }}>
                  <div className="game-browser-header">
                    <p className="section-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', margin: 0 }}>
                      <Swords size={11} /> Select a Game to Review
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="game-count">{chessComGames.length} games</span>
                      <button
                        type="button"
                        onClick={handleCloseGameBrowser}
                        style={{
                          background: 'transparent', border: 'none', color: '#71717a',
                          cursor: 'pointer', padding: '0.2rem', display: 'flex',
                          alignItems: 'center', borderRadius: '0.35rem',
                          transition: 'color 0.15s'
                        }}
                        onMouseEnter={e => e.currentTarget.style.color = '#f87171'}
                        onMouseLeave={e => e.currentTarget.style.color = '#71717a'}
                        title="Close game browser"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="game-browser">
                    {chessComGames.map((game, idx) => {
                      const result = getGameResult(game)
                      const isSelected = idx === selectedGameIndex
                      return (
                        <div
                          key={game.url || idx}
                          className={`game-row ${isSelected ? 'selected' : ''}`}
                          onClick={() => handleSelectGame(idx)}
                        >
                          <div className="game-row-players">
                            <div className="player-line">
                              <span style={{ color: '#f4f4f5' }}>⬜</span>
                              <span>{game.white?.username || 'Unknown'}</span>
                              <span className="rating">({game.white?.rating || '?'})</span>
                            </div>
                            <div className="player-line">
                              <span style={{ color: '#71717a' }}>⬛</span>
                              <span>{game.black?.username || 'Unknown'}</span>
                              <span className="rating">({game.black?.rating || '?'})</span>
                            </div>
                          </div>
                          <div className="game-row-right">
                            <span className={`game-result ${result.className}`}>{result.text}</span>
                            <div className="game-meta">
                              <span className="game-meta-tag">
                                <Timer size={10} /> {formatTimeControl(game.time_control)}
                              </span>
                              <span className="game-meta-tag">
                                <Calendar size={10} /> {formatGameDate(game.end_time)}
                              </span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

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
            <div className="glass-card table-card" style={{ padding: '1.5rem' }}>
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

              <div className="table-container" ref={tableContainerRef}>
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
                              <span className={`move-badge ${classification.badgeClass}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                {classification.label === 'Book' && <BookOpen size={10} />}
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
            <div className="footer-tip" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#3f3f46', fontSize: '0.73rem', paddingLeft: '0.25rem' }}>
              <ChevronRight size={12} />
              <span>Click any move or chart point to jump the board. Run <code style={{ color: '#6366f1', fontFamily: 'monospace' }}>python main.py</code> in ai-worker to start engine.</span>
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <footer style={{
          marginTop: '3rem',
          paddingTop: '1.5rem',
          borderTop: '1px solid rgba(63, 63, 70, 0.5)',
          textAlign: 'center',
          position: 'relative',
          zIndex: 1
        }}>
          <p style={{ fontSize: '0.85rem', color: '#a1a1aa', fontWeight: 500, margin: '0 0 0.5rem 0' }}>
            Built by <span style={{ color: '#f4f4f5', fontWeight: 700 }}>Muhammad Yahya Siddiqui</span>
          </p>
          <p style={{ fontSize: '0.75rem', color: '#71717a', margin: '0 0 0.5rem 0' }}>
            Backend AI Engineer
          </p>
          <p style={{ fontSize: '0.7rem', color: '#52525b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Real-Time Microservices Chess Architecture
          </p>
        </footer>
      </div>

      {/* Responsive grid style */}
      <style>{`
        @media (max-width: 860px) {
          .responsive-grid {
            display: flex !important;
            flex-direction: column !important;
            gap: 1.25rem !important;
          }
          .left-column, .right-column {
            display: contents !important;
          }
          .controls-card { order: 1; }
          .board-card { order: 2; }
          .chart-card { order: 3; }
          .table-card { order: 4; }
          .status-card { order: 5; }
          .debug-card { order: 6; }
          .footer-tip { order: 7; }
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
