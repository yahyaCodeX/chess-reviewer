import { useCallback, useEffect, useState } from 'react'
import { API_URL } from './useAnalysisStream'

// Status codes a proxy returns when the app behind it is down / restarting
const DOWN_STATUSES = new Set([502, 503, 504])

export const SLEEPING_MESSAGE =
  'The analysis server is asleep right now (it is switched off when not in use to save costs). Please try again later.'

/** fetch() with a timeout. */
export async function fetchWithTimeout(url, options = {}, ms = 8000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...options, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** True when a failed request means "server unreachable" rather than "bad request". */
export function isServerDown(errOrResponse) {
  if (!errOrResponse) return false
  if (typeof errOrResponse.status === 'number' && 'ok' in errOrResponse) return DOWN_STATUSES.has(errOrResponse.status)
  return true // network error / timeout / CORS failure
}

/**
 * Pings /health on load and every 30 s while the server is unreachable.
 * Returns { health: 'checking' | 'online' | 'offline', recheck, markOffline }.
 */
export function useServerHealth() {
  const [health, setHealth] = useState('checking')

  const recheck = useCallback(async () => {
    try {
      const res = await fetchWithTimeout(`${API_URL}/health`, {}, 6000)
      // Require the gateway's own JSON: a static host answering with its
      // index.html (200) must not count as "online".
      const body = res.ok ? await res.json().catch(() => null) : null
      setHealth(body?.status === 'ok' ? 'online' : 'offline')
    } catch {
      setHealth('offline')
    }
  }, [])

  useEffect(() => {
    const first = setTimeout(recheck, 0)
    return () => clearTimeout(first)
  }, [recheck])

  useEffect(() => {
    if (health !== 'offline') return
    const t = setInterval(recheck, 30_000)
    return () => clearInterval(t)
  }, [health, recheck])

  const markOffline = useCallback(() => setHealth('offline'), [])
  const markOnline = useCallback(() => setHealth('online'), [])
  return { health, recheck, markOffline, markOnline }
}

/**
 * Polls a game's server-side status (queue position, ETA, failure) until it
 * is done. Returns null until the first answer, or for games the server
 * doesn't track (reviews made before game tracking existed).
 */
export function useGameStatus(gameId, done) {
  const [state, setState] = useState({ gameId: null, status: null })

  useEffect(() => {
    if (!gameId || done) return
    let cancelled = false
    let timer
    const tick = async () => {
      let next = 2500
      try {
        const res = await fetchWithTimeout(`${API_URL}/api/analysis/games/${encodeURIComponent(gameId)}`)
        if (cancelled) return
        if (res.status === 404) {
          setState({ gameId, status: null })
          return // untracked game — stop polling
        }
        if (res.ok) {
          const status = await res.json()
          if (cancelled) return
          setState({ gameId, status })
          if (status.status === 'done' || status.status === 'failed') return
          next = status.queuePosition > 0 ? 5000 : 4000
        }
      } catch {
        next = 6000 // network blip — back off a little
      }
      if (!cancelled) timer = setTimeout(tick, next)
    }
    tick()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [gameId, done])

  return state.gameId === gameId ? state.status : null
}

/** "about 2 min" / "less than a minute" */
export function formatEta(seconds) {
  if (seconds == null) return null
  if (seconds < 50) return 'less than a minute'
  const mins = Math.round(seconds / 60)
  return `about ${mins} min`
}
