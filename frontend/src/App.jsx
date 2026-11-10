import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import {
  AlertTriangle,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Cpu,
  Loader2,
  Moon,
  Radio,
  RefreshCw,
  Swords,
  TrendingUp,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react'
import ReviewBoard from './components/ReviewBoard'
import { BOARD_THEMES } from './lib/themes'
import { LiveProgressPill, WarmupOverlay } from './components/AnalysisOverlays'
import MoveList from './components/MoveList'
import CoachPanel from './components/CoachPanel'
import ReviewSummary from './components/ReviewSummary'
// Recharts is heavy — load the chart separately so the board appears sooner
const EvalChart = lazy(() => import('./components/EvalChart'))
import GameBrowser from './components/GameBrowser'
import { API_URL, useAnalysisStream } from './hooks/useAnalysisStream'
import {
  SLEEPING_MESSAGE,
  fetchWithTimeout,
  formatEta,
  isServerDown,
  useGameStatus,
  useServerHealth,
} from './hooks/useServer'
import {
  STARTING_FEN,
  buildTimeline,
  classifyPly,
  evalLabel,
  summarize,
  uciToSan,
  whiteWinProbability,
} from './lib/review'
import { ERROR_CLASSES, explainMove, fenAfter } from './lib/explain'
import { buildAnnotatedPgn, downloadText, pgnFilename } from './lib/pgnExport'
import { cueForClass, playSound, soundForSan } from './lib/sounds'
import { clearReviewFromUrl, reviewFromLocation, reviewUrl, shareLink, showReviewInUrl } from './lib/share'
import './index.css'

const SAMPLE_PGN = `[Event "Paris Opera"]
[Site "Paris FRA"]
[Date "1858.11.02"]
[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7
8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7
14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`

const NO_ARROW_CLASSES = new Set(['best', 'book', 'brilliant', 'great', 'forced'])
const UNSCORED = new Set(['book', 'forced'])

function loadPref(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}
function savePref(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // storage blocked (private mode) — preference just won't persist
  }
}

const TRANSPORT_LABEL = {
  idle: { text: 'Ready', cls: 'status-idle' },
  connecting: { text: 'Connecting', cls: 'status-wait' },
  polling: { text: 'Polling', cls: 'status-wait' },
  live: { text: 'Live', cls: 'status-live' },
}

/** Error text for a failed submit / load response. */
async function responseError(res) {
  let detail = ''
  try {
    detail = (await res.json())?.detail ?? ''
  } catch {
    // not JSON
  }
  if (res.status === 429) return detail || 'Too many reviews in a short time. Please wait a few minutes.'
  if (res.status === 400 || res.status === 413) return detail || "The server couldn't read that game."
  return `The server responded ${res.status}.`
}

export default function App() {
  const [pgnInput, setPgnInput] = useState('')
  const [picked, setPicked] = useState(null) // { url, userColor } from the game browser
  const [game, setGame] = useState(null) // { id, pgn, plies, headers, userColor }
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState(null)
  const [inputOpen, setInputOpen] = useState(true)
  const [viewIdx, setViewIdx] = useState(-1)
  const [following, setFollowing] = useState(true)
  const [previewIdx, setPreviewIdx] = useState(-1)
  // "Show best move": { idx, stage } — stage 'rewind' shows the position before, then 'best' plays it
  const [bestPreview, setBestPreview] = useState(null)
  // Retry mode: { idx, status: 'trying'|'wrong'|'solved'|'revealed', tries, attemptSan, attemptFen }
  const [retry, setRetry] = useState(null)
  const [orientation, setOrientation] = useState('white')
  const [theme, setTheme] = useState(() => {
    const saved = loadPref('board-theme', 'green')
    return BOARD_THEMES[saved] ? saved : 'green'
  })
  const [soundOn, setSoundOn] = useState(() => loadPref('sound', 'on') === 'on')
  const [shareState, setShareState] = useState(null)
  // Shared link (/review/<id>) waiting to be opened once the server answers
  const [sharedRef, setSharedRef] = useState(() => reviewFromLocation())

  const { health, recheck, markOffline, markOnline } = useServerHealth()

  const plies = useMemo(() => game?.plies ?? [], [game])
  const headers = game?.headers ?? {}
  const total = plies.length
  const { analysis, count, done, transport, stalled } = useAnalysisStream(game?.id ?? null, total)
  const gameStatus = useGameStatus(game?.id ?? null, done)
  const failed = !done && gameStatus?.status === 'failed'

  // Number of analyzed plies from the start with no gaps — classification of
  // ply i needs the evaluation of ply i-1.
  const frontier = useMemo(() => {
    let i = 0
    while (i < total && analysis[i]) i++
    return i
  }, [analysis, total])

  const classes = useMemo(
    () => plies.map((_, i) => (i < frontier ? classifyPly(i, analysis, plies) : null)),
    [plies, analysis, frontier],
  )

  const phase = !game ? 'idle' : done ? 'done' : count === 0 ? 'warmup' : 'live'

  // ── Warm-up: replay the game on the board while the engine boots ─────────
  useEffect(() => {
    if (phase !== 'warmup' || total === 0) return
    const t = setInterval(() => setPreviewIdx(v => (v + 1 >= total ? -1 : v + 1)), 450)
    return () => clearInterval(t)
  }, [phase, total])

  // ── Live follow: step the board one move at a time toward the frontier ───
  useEffect(() => {
    if (!following || phase === 'idle' || phase === 'warmup') return
    if (viewIdx >= frontier - 1) return
    const gap = frontier - 1 - viewIdx
    const t = setTimeout(() => setViewIdx(v => Math.min(v + 1, frontier - 1)), gap > 6 ? 90 : 300)
    return () => clearTimeout(t)
  }, [following, phase, viewIdx, frontier])

  const goTo = useCallback(
    i => {
      if (!game) return
      setFollowing(false)
      setRetry(null)
      setBestPreview(null)
      setViewIdx(Math.max(-1, Math.min(total - 1, i)))
    },
    [game, total],
  )

  const openGame = useCallback((id, pgn, timeline, userColor) => {
    setGame({ id, pgn, plies: timeline.plies, headers: timeline.headers, userColor })
    setViewIdx(-1)
    setPreviewIdx(-1)
    setFollowing(true)
    setRetry(null)
    setBestPreview(null)
    setOrientation(userColor ?? 'white')
    setInputOpen(false)
  }, [])

  // ── Submit ───────────────────────────────────────────────────────────────
  const startReview = async (text, userColor) => {
    const pgn = text.trim()
    if (!pgn) return
    const timeline = buildTimeline(pgn)
    if (!timeline.ok) {
      setFormError(`Couldn't read that PGN: ${timeline.error}`)
      return
    }
    setSubmitting(true)
    setFormError(null)
    try {
      const res = await fetchWithTimeout(
        `${API_URL}/api/analysis/submit`,
        { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: pgn },
        15000,
      )
      if (!res.ok) {
        if (isServerDown(res)) {
          markOffline()
          setFormError(SLEEPING_MESSAGE)
        } else {
          setFormError(await responseError(res))
        }
        return
      }
      markOnline()
      const id = (await res.text()).trim().replace(/^"|"$/g, '')
      openGame(id, pgn, timeline, userColor)
      showReviewInUrl(id, userColor)
      setSharedRef(null)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      markOffline()
      setFormError(SLEEPING_MESSAGE)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Open a shared review link (/review/<id>) ─────────────────────────────
  useEffect(() => {
    if (!sharedRef || health !== 'online' || game) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetchWithTimeout(`${API_URL}/api/analysis/games/${encodeURIComponent(sharedRef.id)}`)
        if (cancelled) return
        if (res.status === 404) {
          setFormError("That review link doesn't exist anymore. You can start a new review below.")
          clearReviewFromUrl()
          setSharedRef(null)
          return
        }
        if (!res.ok) throw new Error(String(res.status))
        const info = await res.json()
        const timeline = buildTimeline(info.pgn)
        if (cancelled) return
        if (!timeline.ok) throw new Error('bad pgn')
        openGame(sharedRef.id, info.pgn, timeline, sharedRef.side)
        setSharedRef(null)
      } catch {
        if (!cancelled) markOffline()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sharedRef, health, game, openGame, markOffline])

  // ── Derived view state ───────────────────────────────────────────────────
  const displayIdx = phase === 'warmup' ? previewIdx : viewIdx
  const ply = displayIdx >= 0 ? plies[displayIdx] : null
  const cls = phase !== 'warmup' && displayIdx >= 0 ? classes[displayIdx] : null
  const moveData = displayIdx >= 0 ? analysis[displayIdx] : null
  const explanation = useMemo(
    () => (cls && displayIdx >= 0 ? explainMove(displayIdx, plies, analysis, cls) : null),
    [cls, displayIdx, plies, analysis],
  )
  // Previews belong to one move; navigating away simply makes them inactive
  const preview = explanation && bestPreview?.idx === displayIdx ? bestPreview.stage : null
  const activeRetry = explanation && retry?.idx === displayIdx ? retry : null
  const bestFen = useMemo(
    () => (explanation ? fenAfter(ply.before, explanation.bestUci) : null),
    [explanation, ply],
  )
  const bestSquares = explanation ? { from: explanation.bestUci.slice(0, 2), to: explanation.bestUci.slice(2, 4), cls: 'best' } : null

  let fen = ply ? ply.after : STARTING_FEN
  let boardHighlight = ply ? { from: ply.from, to: ply.to, cls } : null
  let movable = null
  if (activeRetry) {
    if (activeRetry.status === 'solved' || activeRetry.status === 'revealed') {
      fen = bestFen ?? ply.before
      boardHighlight = bestSquares
    } else {
      fen = activeRetry.attemptFen ?? ply.before
      boardHighlight = activeRetry.attemptFen ? activeRetry.attemptSquares : null
      movable = activeRetry.attemptFen ? null : ply.color
    }
  } else if (preview === 'rewind') {
    fen = ply.before
    boardHighlight = null
  } else if (preview === 'best' && bestFen) {
    fen = bestFen
    boardHighlight = bestSquares
  }

  const bestSan = ply && moveData?.bestMove ? uciToSan(ply.before, moveData.bestMove) : null
  const arrows =
    !preview && !activeRetry && cls && moveData?.bestMove && moveData.bestMove !== ply.uci && !NO_ARROW_CLASSES.has(cls)
      ? [{ startSquare: moveData.bestMove.slice(0, 2), endSquare: moveData.bestMove.slice(2, 4), color: 'rgba(129, 182, 76, 0.9)' }]
      : []

  // Step 1 rewinds the board, step 2 plays the best move, so the piece visibly moves
  useEffect(() => {
    if (preview !== 'rewind') return
    const t = setTimeout(() => setBestPreview(p => (p?.stage === 'rewind' ? { ...p, stage: 'best' } : p)), 280)
    return () => clearTimeout(t)
  }, [preview])
  const toggleBest = useCallback(() => {
    setFollowing(false)
    setRetry(null)
    setBestPreview(preview ? null : { idx: displayIdx, stage: 'rewind' })
  }, [preview, displayIdx])

  // ── Retry mode ───────────────────────────────────────────────────────────
  const startRetry = useCallback(() => {
    if (!explanation) return
    setFollowing(false)
    setBestPreview(null)
    setRetry({ idx: displayIdx, status: 'trying', tries: 0, attemptSan: null, attemptFen: null })
  }, [explanation, displayIdx])
  const exitRetry = useCallback(() => setRetry(null), [])
  const revealRetry = useCallback(() => {
    setRetry(r => (r ? { ...r, status: 'revealed', attemptFen: null } : r))
  }, [])

  const tryMove = useCallback((from, to) => {
    if (!activeRetry || !explanation || activeRetry.attemptFen) return false
    const board = new Chess(ply.before)
    let move
    try {
      move = board.move({ from, to, promotion: 'q' })
    } catch {
      return false // illegal — the piece snaps back
    }
    const best = explanation.bestUci
    const isBest = best.slice(0, 2) === from && best.slice(2, 4) === to && (!best[4] || best[4] === (move.promotion ?? 'q'))
    if (isBest) {
      if (soundOn) playSound('correct')
      setRetry(r => ({ ...r, status: 'solved', attemptFen: null }))
      return true
    }
    if (soundOn) playSound('wrong')
    const idx = activeRetry.idx
    setRetry(r => ({
      ...r,
      status: 'wrong',
      tries: r.tries + 1,
      attemptSan: move.san,
      attemptFen: board.fen(),
      attemptSquares: { from, to, cls: 'mistake' },
    }))
    // Show the wrong move briefly, then put the position back
    setTimeout(() => setRetry(r => (r && r.idx === idx ? { ...r, attemptFen: null, attemptSquares: null } : r)), 700)
    return true
  }, [activeRetry, explanation, ply, soundOn])

  // ── Next mistake ─────────────────────────────────────────────────────────
  const mistakeIndices = useMemo(() => {
    const mine = game?.userColor ? game.userColor[0] : null
    const list = []
    for (let i = 0; i < frontier; i++) {
      if (ERROR_CLASSES.has(classes[i]) && (!mine || plies[i].color === mine)) list.push(i)
    }
    return list
  }, [classes, frontier, plies, game])
  const goToNextMistake = useCallback(() => {
    if (mistakeIndices.length === 0) return
    goTo(mistakeIndices.find(i => i > viewIdx) ?? mistakeIndices[0])
  }, [mistakeIndices, viewIdx, goTo])

  // ── Sounds ───────────────────────────────────────────────────────────────
  const lastSound = useRef({ idx: -1, at: 0 })
  useEffect(() => {
    const prev = lastSound.current
    lastSound.current = { idx: viewIdx, at: Date.now() }
    if (!soundOn || phase === 'warmup' || phase === 'idle' || viewIdx < 0) return
    // Any arrival on a new move (step, click, jump) — but not fast live catch-up
    if (viewIdx === prev.idx || Date.now() - prev.at < 150) return
    playSound(soundForSan(plies[viewIdx]?.san))
    // Then the review cue (brilliant chime, blunder thud…), like chess.com
    const cue = cueForClass(classes[viewIdx])
    if (cue) playSound(cue, 0.12)
  }, [viewIdx, soundOn, phase, plies, classes])
  useEffect(() => {
    if (soundOn && preview === 'best' && explanation) playSound(soundForSan(explanation.bestSan))
  }, [preview, soundOn, explanation])

  // ── Keyboard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = e => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return
      if (!game || e.ctrlKey || e.metaKey || e.altKey) return
      const actions = {
        ArrowLeft: () => goTo(viewIdx - 1),
        ArrowRight: () => goTo(viewIdx + 1),
        Home: () => goTo(-1),
        End: () => goTo(total - 1),
        f: () => setOrientation(o => (o === 'white' ? 'black' : 'white')),
        b: () => explanation && toggleBest(),
        r: () => explanation && startRetry(),
        n: () => goToNextMistake(),
        Escape: () => {
          setRetry(null)
          setBestPreview(null)
        },
      }
      const action = actions[e.key]
      if (action) {
        e.preventDefault()
        action()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [game, goTo, viewIdx, total, explanation, toggleBest, startRetry, goToNextMistake])

  // Eval bar follows the latest analyzed ply at or before the displayed one
  const evalIdx = phase === 'warmup' ? -1 : Math.min(displayIdx, frontier - 1)
  const evalMove = evalIdx >= 0 ? analysis[evalIdx] : null
  const evalMover = evalIdx >= 0 ? plies[evalIdx].color : 'w'
  const evalWp = evalMove ? whiteWinProbability(evalMove, evalMover) : 50
  const evalTextRaw = evalMove ? evalLabel(evalMove, evalMover) : '0.0'
  const evalText = evalTextRaw === 'Book' ? '=' : evalTextRaw

  const chartPoints = useMemo(
    () =>
      plies.slice(0, frontier).map((p, i) => ({
        index: i,
        wp: whiteWinProbability(analysis[i], p.color),
        cls: classes[i],
        label: `${p.moveNumber}${p.color === 'w' ? '.' : '…'} ${p.san}`,
        evalText: evalLabel(analysis[i], p.color),
      })),
    [plies, frontier, analysis, classes],
  )

  const summary = useMemo(() => summarize(plies, analysis, classes), [plies, analysis, classes])
  const scoredMoves = useMemo(() => {
    const n = { w: 0, b: 0 }
    classes.forEach((c, i) => {
      if (c && !UNSCORED.has(c)) n[plies[i].color]++
    })
    return n
  }, [classes, plies])
  // Deepest named opening reached (the worker repeats the name while in book)
  const openingName = useMemo(() => {
    let name = null
    for (let i = 0; i < frontier; i++) {
      const o = analysis[i]?.opening
      if (o && o !== 'Opening theory') name = o
    }
    return name
  }, [analysis, frontier])
  const progress = total ? Math.round((count / total) * 100) : 0
  const analyzingIdx = phase === 'live' ? frontier : -1
  const analyzingPly = analyzingIdx >= 0 ? plies[analyzingIdx] : null

  const share = async () => {
    if (!game) return
    const result = await shareLink(reviewUrl(game.id, game.userColor), `${headers.White || 'White'} vs ${headers.Black || 'Black'} — game review`)
    setShareState(result)
    setTimeout(() => setShareState(null), 2500)
  }
  const download = () => {
    downloadText(pgnFilename(headers), buildAnnotatedPgn(plies, analysis, classes, headers, summary))
  }

  const queuePosition = gameStatus?.queuePosition ?? 0
  const overlay = failed ? null : phase === 'warmup' ? (
    <WarmupOverlay total={total} queuePosition={queuePosition} eta={formatEta(gameStatus?.etaSeconds)} />
  ) : phase === 'live' ? (
    <LiveProgressPill
      done={count}
      total={total}
      currentLabel={analyzingPly ? `${analyzingPly.moveNumber}${analyzingPly.color === 'w' ? '.' : '…'} ${analyzingPly.san}` : ''}
    />
  ) : null

  const status = health === 'offline'
    ? { text: 'Offline', cls: 'status-off' }
    : TRANSPORT_LABEL[transport] ?? TRANSPORT_LABEL.idle
  const showStalled = stalled && !failed && queuePosition === 0 && health !== 'offline'

  return (
    <div className={`app ${game ? 'has-game' : 'no-game'}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><Swords size={20} /></span>
          <div>
            <h1>AI Chess Reviewer</h1>
            <p>Stockfish-powered game review</p>
          </div>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={() => {
              setSoundOn(on => {
                savePref('sound', on ? 'off' : 'on')
                return !on
              })
            }}
            aria-label={soundOn ? 'Mute move sounds' : 'Turn on move sounds'}
            title={soundOn ? 'Sound on' : 'Sound off'}
          >
            {soundOn ? <Volume2 size={17} /> : <VolumeX size={17} />}
          </button>
          <div className={`status-chip ${status.cls}`} title="Connection to the analysis server">
            <Radio size={13} />
            <span>{status.text}</span>
          </div>
        </div>
      </header>

      {health === 'offline' && (
        <div className="server-banner" role="status">
          <Moon size={18} />
          <p>
            <strong>The analysis server is asleep.</strong>{' '}
            <span>It's switched off when not in use to save costs, so new reviews and shared links won't load right now. Please check back later.</span>
          </p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={recheck}>
            <RefreshCw size={14} /> <span>Check again</span>
          </button>
        </div>
      )}

      <main className="layout">
        <section className="board-col">
          <ReviewBoard
            fen={fen}
            orientation={orientation}
            theme={theme}
            highlight={boardHighlight}
            badgeKey={activeRetry ? `${displayIdx}-retry-${activeRetry.status}` : preview === 'best' ? `${displayIdx}-best` : displayIdx}
            arrows={arrows}
            evalWp={evalWp}
            evalText={evalText}
            evalPending={phase === 'live' && displayIdx >= frontier}
            headers={headers}
            overlay={overlay}
            scanning={!failed && (phase === 'warmup' || phase === 'live')}
            movable={movable}
            onMove={tryMove}
          />

          <div className="board-toolbar">
            <div className="nav-group">
              <button type="button" className="nav-btn" onClick={() => goTo(-1)} disabled={!game || viewIdx < 0} aria-label="First move">
                <ChevronsLeft size={20} />
              </button>
              <button type="button" className="nav-btn" onClick={() => goTo(viewIdx - 1)} disabled={!game || viewIdx < 0} aria-label="Previous move">
                <ChevronLeft size={20} />
              </button>
              <button type="button" className="nav-btn" onClick={() => goTo(viewIdx + 1)} disabled={!game || viewIdx >= total - 1} aria-label="Next move">
                <ChevronRight size={20} />
              </button>
              <button type="button" className="nav-btn" onClick={() => goTo(total - 1)} disabled={!game || viewIdx >= total - 1} aria-label="Last move">
                <ChevronsRight size={20} />
              </button>
            </div>
            <span className="move-counter">{game ? `${Math.max(0, viewIdx + 1)} / ${total}` : '—'}</span>
            <div className="tool-group">
              {phase === 'live' && !following && (
                <button type="button" className="btn btn-follow" onClick={() => {
                    setViewIdx(v => Math.min(v, frontier - 1))
                    setRetry(null)
                    setBestPreview(null)
                    setFollowing(true)
                  }}>
                  <Zap size={14} /> <span>Follow live</span>
                </button>
              )}
              <button
                type="button"
                className="nav-btn mistake-btn"
                onClick={goToNextMistake}
                disabled={mistakeIndices.length === 0}
                aria-label="Next mistake"
                title={game?.userColor ? 'Jump to your next mistake (N)' : 'Jump to the next mistake (N)'}
              >
                <AlertTriangle size={17} />
              </button>
              <button
                type="button"
                className="nav-btn"
                onClick={() => setOrientation(o => (o === 'white' ? 'black' : 'white'))}
                aria-label="Flip board"
                title="Flip board (F)"
              >
                <ArrowUpDown size={18} />
              </button>
              <select
                className="theme-select"
                value={theme}
                onChange={e => {
                  setTheme(e.target.value)
                  savePref('board-theme', e.target.value)
                }}
                aria-label="Board theme"
              >
                {Object.entries(BOARD_THEMES).map(([key, t]) => (
                  <option key={key} value={key}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>

          {failed && (
            <div className="notice notice-error" role="alert">
              <span>The engine couldn't finish this game after several attempts.</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => startReview(game.pgn, game.userColor)}>
                <RefreshCw size={14} /> <span>Try again</span>
              </button>
            </div>
          )}
          {showStalled && (
            <div className="notice" role="alert">
              No new results for a while. The engine may be restarting; the game will be retried automatically.
            </div>
          )}

          <section className="card chart-card">
            <div className="card-head">
              <h2 className="card-title"><TrendingUp size={14} /> Evaluation</h2>
              <span className="muted small">Click to jump</span>
            </div>
            <Suspense fallback={<div className="chart-empty">Loading chart…</div>}>
              <EvalChart points={chartPoints} total={total} activeIndex={phase === 'warmup' ? -1 : viewIdx} onSelect={goTo} />
            </Suspense>
          </section>
        </section>

        <aside className="side-col">
          <section className={`card input-card ${inputOpen ? 'open' : 'closed'}`}>
            <button
              type="button"
              className="card-head card-toggle"
              onClick={() => setInputOpen(o => !o)}
              aria-expanded={inputOpen}
              disabled={!game}
            >
              <h2 className="card-title"><Cpu size={14} /> {game ? 'Review another game' : 'Load a game'}</h2>
              {game && <ChevronDown size={16} className="chev" />}
            </button>
            {inputOpen && (
              <div className="input-body">
                {sharedRef && health !== 'offline' && (
                  <p className="loading-line"><Loader2 size={14} className="spin" /> Opening shared review…</p>
                )}
                <GameBrowser
                  selectedUrl={picked?.url}
                  onPick={(pgn, meta) => {
                    setPgnInput(pgn)
                    setPicked(meta)
                    setFormError(null)
                  }}
                />
                <textarea
                  className="input pgn-input"
                  rows={5}
                  spellCheck={false}
                  placeholder={'…or paste a PGN here\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5'}
                  value={pgnInput}
                  onChange={e => {
                    setPgnInput(e.target.value)
                    setPicked(null)
                  }}
                  aria-label="PGN"
                />
                {formError && <p className="form-error">{formError}</p>}
                <div className="input-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => startReview(pgnInput, picked?.userColor)}
                    disabled={submitting || !pgnInput.trim()}
                  >
                    {submitting ? <Loader2 size={17} className="spin" /> : <Cpu size={17} />}
                    <span>{submitting ? 'Starting review…' : 'Start Game Review'}</span>
                  </button>
                  {!pgnInput.trim() && (
                    <button type="button" className="btn btn-ghost" onClick={() => setPgnInput(SAMPLE_PGN)}>
                      Try a sample game
                    </button>
                  )}
                </div>
              </div>
            )}
          </section>

          <CoachPanel
            ply={phase === 'warmup' ? null : ply}
            cls={cls}
            evalText={moveData ? evalLabel(moveData, ply?.color) : ''}
            bestSan={bestSan}
            explanation={phase === 'warmup' ? null : explanation}
            showingBest={!!preview}
            onToggleBest={toggleBest}
            retry={activeRetry}
            onStartRetry={startRetry}
            onRevealRetry={revealRetry}
            onExitRetry={exitRetry}
            opening={moveData?.opening}
            phase={phase}
          />

          {game && (
            <ReviewSummary
              summary={summary}
              headers={headers}
              done={done}
              progress={progress}
              opening={openingName}
              scoredMoves={scoredMoves}
              onShare={share}
              shareState={shareState}
              onDownload={download}
            />
          )}

          {game && (
            <section className="card moves-card">
              <div className="card-head">
                <h2 className="card-title">Moves</h2>
                <div className="moves-head-right">
                  {mistakeIndices.length > 0 && (
                    <button type="button" className="chip chip-btn" onClick={goToNextMistake} title="Jump to the next mistake (N)">
                      <AlertTriangle size={12} /> Next mistake
                    </button>
                  )}
                  <span className="muted small">{count} / {total} analyzed</span>
                </div>
              </div>
              <MoveList
                plies={plies}
                classes={classes}
                activeIndex={phase === 'warmup' ? -1 : viewIdx}
                analyzingIndex={analyzingIdx}
                onSelect={goTo}
              />
            </section>
          )}
        </aside>
      </main>

      <footer className="footer">
        <span>Built by <strong>Muhammad Yahya Siddiqui</strong></span>
        <span className="kbd-hint">← → step · N next mistake · R retry · B best move · F flip</span>
      </footer>
    </div>
  )
}
