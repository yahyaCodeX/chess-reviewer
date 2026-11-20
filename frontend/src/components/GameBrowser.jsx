import { useState } from 'react'
import { Calendar, Loader2, Search, Timer, X } from 'lucide-react'

const LOSS_RESULTS = new Set(['checkmated', 'timeout', 'resigned', 'abandoned', 'lose', 'bughousepartnerlose'])

const SOURCES = {
  chesscom: { label: 'Chess.com', placeholder: 'Chess.com username' },
  lichess: { label: 'Lichess', placeholder: 'Lichess game link or username' },
}

function chesscomTime(tc) {
  if (!tc) return '?'
  if (tc.includes('/')) return 'Daily'
  const [base, inc = '0'] = tc.split('+')
  const mins = parseInt(base, 10) / 60
  return `${mins >= 1 ? Math.round(mins) : mins.toFixed(1)}+${inc}`
}

function shortDate(ms) {
  if (!ms) return ''
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

async function fetchJson(url, options) {
  const res = await fetch(url, options)
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status })
  return res.json()
}

// ── Chess.com ───────────────────────────────────────────────────────────────
async function chesscomGames(user) {
  const { archives = [] } = await fetchJson(`https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/archives`)
  if (archives.length === 0) throw new Error(`No games found for "${user}".`)
  // Latest month first; pull the previous month too if this one is nearly empty
  let list = (await fetchJson(archives[archives.length - 1])).games ?? []
  if (list.length < 15 && archives.length > 1) {
    list = [...((await fetchJson(archives[archives.length - 2])).games ?? []), ...list]
  }
  return list
    .filter(g => g.pgn && (g.rules ?? 'chess') === 'chess')
    .reverse()
    .map(g => {
      const isBlack = (g.black?.username || '').toLowerCase() === user
      const mine = (isBlack ? g.black : g.white)?.result || ''
      const result = mine === 'win' ? 'win' : LOSS_RESULTS.has(mine) ? 'loss' : 'draw'
      return {
        key: g.url,
        pgn: g.pgn,
        white: { name: g.white?.username, rating: g.white?.rating },
        black: { name: g.black?.username, rating: g.black?.rating },
        result,
        time: chesscomTime(g.time_control),
        date: g.end_time ? g.end_time * 1000 : null,
        userColor: isBlack ? 'black' : 'white',
      }
    })
}

// ── Lichess ─────────────────────────────────────────────────────────────────
/** "https://lichess.org/AbCdEfGh/black" → { id, color } */
function lichessGameRef(text) {
  const t = text.trim()
  const url = t.match(/lichess\.org\/(?:embed\/(?:game\/)?)?([a-zA-Z0-9]{8})(?:[a-zA-Z0-9]{4})?(?:\/(white|black))?/)
  if (url) return { id: url[1], color: url[2] || 'white' }
  if (/^[a-zA-Z0-9]{8}$/.test(t) || /^[a-zA-Z0-9]{12}$/.test(t)) {
    // Bare IDs look like usernames too — only treat mixed-case/digit strings as IDs
    if (/\d/.test(t) && /[A-Z]/.test(t)) return { id: t.slice(0, 8), color: 'white' }
  }
  return null
}

async function lichessGame({ id, color }) {
  const res = await fetch(`https://lichess.org/game/export/${id}?clocks=false&evals=false`, {
    headers: { Accept: 'application/x-chess-pgn' },
  })
  if (res.status === 404) throw new Error('That Lichess game was not found.')
  if (!res.ok) throw new Error(`Lichess returned HTTP ${res.status}.`)
  const pgn = await res.text()
  if (/\[Variant "(?!Standard)/i.test(pgn)) throw new Error('Only standard chess games can be reviewed.')
  return { pgn, userColor: color, url: `https://lichess.org/${id}` }
}

async function lichessGames(user) {
  const res = await fetch(
    `https://lichess.org/api/games/user/${encodeURIComponent(user)}?max=30&pgnInJson=true&clocks=false&evals=false&perfType=ultraBullet,bullet,blitz,rapid,classical,correspondence`,
    { headers: { Accept: 'application/x-ndjson' } },
  )
  if (!res.ok) {
    // Lichess currently refuses anonymous game lists; tell users what does work
    const exists = await fetch(`https://lichess.org/api/user/${encodeURIComponent(user)}`).then(r => r.ok, () => false)
    if (!exists) throw new Error(`Lichess user "${user}" not found.`)
    throw new Error("Lichess doesn't let websites list a player's games right now. Open a game on Lichess and paste its link here instead.")
  }
  const text = await res.text()
  const games = text.split('\n').filter(Boolean).map(line => JSON.parse(line))
  return games
    .filter(g => g.pgn && g.variant === 'standard')
    .map(g => {
      const isBlack = (g.players?.black?.user?.name || '').toLowerCase() === user
      const mine = isBlack ? 'black' : 'white'
      const result = !g.winner ? 'draw' : g.winner === mine ? 'win' : 'loss'
      const clock = g.clock ? `${Math.round(g.clock.initial / 60) || (g.clock.initial / 60).toFixed(1)}+${g.clock.increment}` : 'Daily'
      return {
        key: g.id,
        pgn: g.pgn,
        white: { name: g.players?.white?.user?.name ?? 'Anonymous', rating: g.players?.white?.rating },
        black: { name: g.players?.black?.user?.name ?? 'Anonymous', rating: g.players?.black?.rating },
        result,
        time: clock,
        date: g.createdAt,
        userColor: mine,
        url: `https://lichess.org/${g.id}`,
      }
    })
}

const RESULT_LABEL = { win: ['Win', 'result-win'], loss: ['Loss', 'result-loss'], draw: ['Draw', 'result-draw'] }

/**
 * Pick a game from Chess.com (username search) or Lichess (game link,
 * or username when Lichess allows listing).
 * onPick(pgn, { userColor, url }) fires when a game is chosen.
 */
export default function GameBrowser({ onPick, selectedUrl }) {
  const [source, setSource] = useState('chesscom')
  const [query, setQuery] = useState('')
  const [games, setGames] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const text = query.trim()

  const search = async () => {
    if (!text) return
    setLoading(true)
    setError(null)
    setGames([])
    try {
      if (source === 'lichess') {
        const ref = lichessGameRef(text)
        if (ref) {
          const { pgn, userColor, url } = await lichessGame(ref)
          onPick(pgn, { userColor, url })
          return
        }
        const list = await lichessGames(text.toLowerCase())
        if (list.length === 0) throw new Error('No standard games found.')
        setGames(list)
      } else {
        const list = await chesscomGames(text.toLowerCase())
        if (list.length === 0) throw new Error('No standard chess games in the last months.')
        setGames(list)
      }
    } catch (err) {
      if (source === 'chesscom' && err.status === 404) setError(`Chess.com user "${text}" not found.`)
      else setError(err.message || `Could not reach ${SOURCES[source].label}.`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="game-browser-wrap">
      <div className="source-tabs" role="tablist" aria-label="Game source">
        {Object.entries(SOURCES).map(([key, s]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={source === key}
            className={`source-tab ${source === key ? 'active' : ''}`}
            onClick={() => {
              setSource(key)
              setGames([])
              setError(null)
            }}
          >
            {s.label}
          </button>
        ))}
      </div>
      <form
        className="search-row"
        onSubmit={e => {
          e.preventDefault()
          search()
        }}
      >
        <input
          className="input"
          type="text"
          inputMode="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder={SOURCES[source].placeholder}
          value={query}
          onChange={e => setQuery(e.target.value)}
          aria-label={SOURCES[source].placeholder}
        />
        <button type="submit" className="btn btn-secondary" disabled={loading || !text}>
          {loading ? <Loader2 size={15} className="spin" /> : <Search size={15} />}
          <span>{loading ? 'Searching' : source === 'lichess' && lichessGameRef(text) ? 'Load game' : 'Find games'}</span>
        </button>
      </form>

      {error && <p className="form-error">{error}</p>}

      {games.length > 0 && (
        <div className="games-panel">
          <div className="games-head">
            <span className="muted">{games.length} recent games</span>
            <button type="button" className="icon-btn" onClick={() => setGames([])} aria-label="Close game list">
              <X size={15} />
            </button>
          </div>
          <div className="games-list">
            {games.map(g => {
              const [label, cls] = RESULT_LABEL[g.result]
              return (
                <button
                  type="button"
                  key={g.key}
                  className={`game-item ${selectedUrl === (g.url ?? g.key) ? 'selected' : ''}`}
                  onClick={() => onPick(g.pgn, { userColor: g.userColor, url: g.url ?? g.key })}
                >
                  <span className="game-players">
                    <span className="gp"><span className="sw sw-w" />{g.white.name} <em>{g.white.rating}</em></span>
                    <span className="gp"><span className="sw sw-b" />{g.black.name} <em>{g.black.rating}</em></span>
                  </span>
                  <span className="game-side">
                    <span className={`result ${cls}`}>{label}</span>
                    <span className="game-meta">
                      <Timer size={11} /> {g.time}
                      <Calendar size={11} /> {shortDate(g.date)}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
