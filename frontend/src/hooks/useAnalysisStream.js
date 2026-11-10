import { useCallback, useEffect, useState } from 'react'
import { Client } from '@stomp/stompjs'
import { plyOf } from '../lib/review'

// Defaults to the page's own origin: in dev Vite proxies /api and /ws to :8080,
// in production Caddy does the same — so no CORS and no ws:// on https pages.
export const API_URL = (import.meta.env.VITE_API_URL || window.location.origin).replace(/\/$/, '')
export const WS_URL = import.meta.env.VITE_WS_URL || `${API_URL.replace(/^http/, 'ws')}/ws`

const STALL_AFTER_MS = 45_000

/**
 * Streams engine results for one game.
 *
 * WebSocket (STOMP) is the primary channel; HTTP polling runs as a slower
 * safety net and speeds up whenever the socket is down. Moves are keyed by
 * ply, so duplicates from the two channels collapse naturally.
 *
 * @returns {{ analysis: Record<number, object>, count: number, done: boolean,
 *             transport: 'idle'|'connecting'|'live'|'polling', stalled: boolean }}
 */
export function useAnalysisStream(gameId, totalPlies) {
  // State is tagged with its gameId so switching games never shows stale moves
  const [state, setState] = useState({ gameId: null, moves: {}, updatedAt: 0 })
  const [transport, setTransport] = useState('idle')
  const [stalled, setStalled] = useState(false)

  const moves = state.gameId === gameId ? state.moves : {}
  const count = Object.keys(moves).length
  const done = Boolean(gameId) && totalPlies > 0 && count >= totalPlies

  const merge = useCallback(list => {
    setState(prev => {
      const base = prev.gameId === gameId ? prev.moves : {}
      let next = null
      for (const m of list) {
        if (!m || (m.gameId && m.gameId !== gameId)) continue
        const ply = plyOf(m)
        if (Number.isNaN(ply) || ply < 0) continue
        const existing = base[ply]
        if (existing && (existing.bestMove || !m.bestMove)) continue
        next ??= { ...base }
        next[ply] = m
      }
      if (!next) return prev.gameId === gameId ? prev : { gameId, moves: base, updatedAt: Date.now() }
      return { gameId, moves: next, updatedAt: Date.now() }
    })
  }, [gameId])

  // ── STOMP WebSocket ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!gameId || done) {
      setTransport('idle')
      return
    }
    setTransport('connecting')
    const client = new Client({
      brokerURL: WS_URL,
      reconnectDelay: 4000,
      onConnect: () => {
        setTransport('live')
        client.subscribe(`/topic/moves/${gameId}`, message => {
          try {
            merge([JSON.parse(message.body)])
          } catch (err) {
            console.error('Bad WebSocket payload', err)
          }
        })
      },
      onWebSocketClose: () => setTransport('polling'),
      onStompError: frame => console.error('STOMP error:', frame.headers?.message, frame.body),
    })
    client.activate()
    return () => {
      client.deactivate()
    }
  }, [gameId, done, merge])

  // ── HTTP polling fallback ────────────────────────────────────────────────
  useEffect(() => {
    if (!gameId || done) return
    let cancelled = false
    const tick = async () => {
      try {
        const res = await fetch(`${API_URL}/api/analysis/moves?gameId=${encodeURIComponent(gameId)}`)
        if (!res.ok || cancelled) return
        const data = await res.json()
        if (!cancelled && Array.isArray(data)) merge(data.filter(m => m.gameId === gameId))
      } catch {
        // network blip — the next tick retries
      }
    }
    const interval = setInterval(tick, transport === 'live' ? 8000 : 2500)
    const first = setTimeout(tick, 1200)
    return () => {
      cancelled = true
      clearInterval(interval)
      clearTimeout(first)
    }
  }, [gameId, done, merge, transport])

  // ── Stall detection (engine offline / queue backed up) ───────────────────
  useEffect(() => {
    setStalled(false)
    if (!gameId || done) return
    const timer = setTimeout(() => setStalled(true), STALL_AFTER_MS)
    return () => clearTimeout(timer)
  }, [gameId, done, state.updatedAt])

  return { analysis: moves, count, done, transport: gameId ? transport : 'idle', stalled }
}
