import { describe, expect, it } from 'vitest'
import opera from './fixtures/opera.json'
import trap from './fixtures/trap.json'
import {
  buildTimeline,
  classifyPly,
  estimateRating,
  formatLine,
  plyOf,
  summarize,
} from '../review.js'
import { explainMove } from '../explain.js'
import { buildAnnotatedPgn, pgnFilename } from '../pgnExport.js'

/** Rebuild a game + analysis map from saved worker output. */
function load(rows) {
  const pgn = rows.map((m, i) => (i % 2 === 0 ? `${m.moveNumber}. ` : '') + m.moveSan).join(' ')
  const timeline = buildTimeline(pgn)
  const analysis = {}
  for (const m of rows) analysis[plyOf(m)] = m
  const classes = timeline.plies.map((_, i) => classifyPly(i, analysis, timeline.plies))
  return { plies: timeline.plies, analysis, classes }
}

const bySan = (game, san, color) => game.plies.findIndex(p => p.san === san && (!color || p.color === color))

describe('move classification (real Stockfish output)', () => {
  const g = load(opera)

  it('marks the opening as book', () => {
    expect(g.classes.slice(0, 7).every(c => c === 'book')).toBe(true)
  })

  it("finds Morphy's brilliant sacrifices", () => {
    for (const san of ['Nxb5', 'Rxd7', 'Qb8+']) expect(g.classes[bySan(g, san, 'w')]).toBe('brilliant')
  })

  it('labels the only legal reply as forced and mate as best', () => {
    expect(g.classes[bySan(g, 'Nxb8', 'b')]).toBe('forced')
    expect(g.classes[bySan(g, 'Rd8#', 'w')]).toBe('best')
  })

  it('computes accuracy', () => {
    const s = summarize(g.plies, g.analysis, g.classes)
    expect(s.w.accuracy).toBeGreaterThan(95)
    expect(s.b.accuracy).toBeLessThan(s.w.accuracy)
  })

  it('rates the trap game errors', () => {
    const t = load(trap)
    expect(t.classes[bySan(t, 'Nxe5', 'w')]).toBe('mistake')
    expect(t.classes[bySan(t, 'Nxf7', 'w')]).toBe('blunder')
    expect(t.classes[bySan(t, 'Qxg2', 'b')]).toBe('great')
    expect(t.classes[bySan(t, 'Be2', 'w')]).toBe('blunder')
  })
})

describe('explanations', () => {
  const t = load(trap)
  const explain = san => {
    const i = bySan(t, san, 'w')
    return explainMove(i, t.plies, t.analysis, t.classes[i])
  }

  it('names the mate a blunder allows', () => {
    const e = explain('Be2')
    expect(e.why).toBe('This allows checkmate in one: Nf3#.')
    expect(e.bestSan).toBe('Qe2')
  })

  it("names the opponent's winning reply", () => {
    const e = explain('Nxf7')
    expect(e.why).toMatch(/^This allows Qxg2, and Black wins a pawn/)
    expect(e.bestSan).toBe('O-O')
    expect(e.replyLine).toMatch(/^5… Qxg2/)
  })

  it('returns nothing for good moves', () => {
    const i = bySan(t, 'e4', 'w')
    expect(explainMove(i, t.plies, t.analysis, t.classes[i])).toBeNull()
  })

  it('describes the evaluation from the right side for Black', () => {
    const g = load(opera)
    const i = g.classes.findIndex((c, k) => c === 'inaccuracy' && g.plies[k].color === 'b')
    const e = explainMove(i, g.plies, g.analysis, g.classes[i])
    expect(e.why).toMatch(/in White's favour/)
  })
})

describe('formatLine', () => {
  const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
  it('numbers moves', () => {
    expect(formatLine(start, 'e2e4 e7e5 g1f3')).toBe('1. e4 e5 2. Nf3')
  })
  it('starts a Black line with an ellipsis', () => {
    const afterE4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
    expect(formatLine(afterE4, 'e7e5 g1f3')).toBe('1… e5 2. Nf3')
  })
  it('stops at an illegal move', () => {
    expect(formatLine(start, 'e2e4 e2e4')).toBe('1. e4')
  })
})

describe('estimateRating', () => {
  it('maps accuracy to a rounded rating', () => {
    expect(estimateRating(80)).toBe(1500)
    expect(estimateRating(90)).toBe(2200)
    expect(estimateRating(100)).toBe(3000)
    expect(estimateRating(null)).toBeNull()
  })
  it('is monotonic', () => {
    let last = 0
    for (let a = 0; a <= 100; a += 5) {
      const r = estimateRating(a)
      expect(r).toBeGreaterThanOrEqual(last)
      last = r
    }
  })
})

describe('annotated PGN export', () => {
  const t = load(trap)
  const pgn = buildAnnotatedPgn(t.plies, t.analysis, t.classes, { White: 'A', Black: 'B', Result: '0-1' })

  it('adds move-quality symbols and best-move comments', () => {
    expect(pgn).toContain('Nxf7??')
    expect(pgn).toContain('Best was O-O')
    expect(pgn).toContain('[%eval')
    expect(pgn).toMatch(/0-1\n$/)
  })

  it('round-trips through a PGN parser', () => {
    const again = buildTimeline(pgn)
    expect(again.ok).toBe(true)
    expect(again.plies.map(p => p.san)).toEqual(t.plies.map(p => p.san))
  })

  it('builds a safe filename', () => {
    expect(pgnFilename({ White: 'Paul Morphy', Black: 'Duke/Count', Date: '1858.11.02' })).toBe('Paul_Morphy-vs-Duke_Count-1858-review.pgn')
  })
})
