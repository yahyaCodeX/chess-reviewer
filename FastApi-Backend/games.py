"""
games.py
--------
Game bookkeeping for the public deployment:

  • PGN validation + a fingerprint so the same game is never analysed twice
  • per-visitor rate limiting
  • queue position / ETA for the "you're #3 in line" message
  • a watchdog that re-queues games whose worker died or hung
"""

import hashlib
import io
import json
import logging
import os
import uuid
from datetime import timedelta
from typing import Optional

import chess
import chess.pgn
from sqlalchemy import func
from sqlalchemy.orm import Session

from models import AnalyzedMove, Game, utcnow

logger = logging.getLogger(__name__)

# ── Tunables (env) ──────────────────────────────────────────────────────────
MAX_PLIES = int(os.getenv("MAX_PLIES", "300"))                    # 150 full moves
RATE_LIMIT_GAMES = int(os.getenv("RATE_LIMIT_GAMES", "5"))        # new games per window per visitor
RATE_LIMIT_WINDOW = timedelta(minutes=int(os.getenv("RATE_LIMIT_WINDOW_MIN", "10")))
# Same variable the worker reads, so one .env keeps both in sync
WORKER_SLOTS = max(1, int(os.getenv("MAX_PARALLEL_GAMES", "2")))
STALL_SECONDS = int(os.getenv("STALL_SECONDS", "240"))            # no progress this long ⇒ retry
MAX_ATTEMPTS = int(os.getenv("MAX_ATTEMPTS", "3"))
DEFAULT_SECONDS_PER_PLY = 1.2
_SALT = os.getenv("RATE_LIMIT_SALT", "chess-reviewer")

UNFINISHED = ("queued", "analyzing")


class PgnError(ValueError):
    """The submitted text isn't a playable game."""


def parse_pgn(pgn: str) -> tuple[str, int]:
    """
    Validate a PGN and return (fingerprint, ply_count).

    The fingerprint covers the start position and the moves only, so the
    same game pasted with different headers, comments or clocks matches.
    """
    try:
        game = chess.pgn.read_game(io.StringIO(pgn))
    except Exception as exc:  # python-chess is lenient, but be safe
        raise PgnError("Couldn't read that PGN.") from exc
    if game is None:
        raise PgnError("Couldn't find a game in that PGN.")
    if game.errors:
        raise PgnError(f"The PGN has an illegal or unreadable move: {game.errors[0]}")

    moves = [m.uci() for m in game.mainline_moves()]
    if not moves:
        raise PgnError("That game has no moves.")
    if len(moves) > MAX_PLIES:
        raise PgnError(f"That game is too long ({len(moves)} half-moves; the limit is {MAX_PLIES}).")

    start_fen = game.board().fen()
    fingerprint = hashlib.sha256(f"{start_fen}|{' '.join(moves)}".encode()).hexdigest()
    return fingerprint, len(moves)


def client_hash(ip: Optional[str]) -> Optional[str]:
    """Salted hash so raw visitor IPs are never stored."""
    if not ip:
        return None
    return hashlib.sha256(f"{_SALT}|{ip}".encode()).hexdigest()


def find_duplicate(db: Session, fingerprint: str) -> Optional[Game]:
    """An earlier submission of the same game that finished or is still running."""
    return (
        db.query(Game)
        .filter(Game.pgnHash == fingerprint, Game.status != "failed")
        .order_by(Game.createdAt.desc())
        .first()
    )


def seconds_until_allowed(db: Session, client: Optional[str]) -> int:
    """0 if the visitor may submit a new game, else seconds to wait."""
    if not client or RATE_LIMIT_GAMES <= 0:
        return 0
    since = utcnow() - RATE_LIMIT_WINDOW
    recent = (
        db.query(Game.createdAt)
        .filter(Game.clientHash == client, Game.createdAt > since)
        .order_by(Game.createdAt.asc())
        .all()
    )
    if len(recent) < RATE_LIMIT_GAMES:
        return 0
    oldest = recent[len(recent) - RATE_LIMIT_GAMES][0]
    return max(1, int((oldest + RATE_LIMIT_WINDOW - utcnow()).total_seconds()) + 1)


def create_game(db: Session, pgn: str, fingerprint: str, plies: int, client: Optional[str]) -> Game:
    game = Game(
        id=str(uuid.uuid4()), pgnHash=fingerprint, pgn=pgn, totalPlies=plies,
        status="queued", attempts=1, clientHash=client,
    )
    db.add(game)
    db.commit()
    return game


def enqueue(producer, topic: str, game: Game) -> None:
    """Put a game on the worker's Kafka topic."""
    payload = json.dumps({"gameId": game.id, "pgn": game.pgn})
    producer.produce(topic, value=payload.encode("utf-8"), key=game.id.encode("utf-8"))
    producer.poll(0)


# ── Queue position / ETA ────────────────────────────────────────────────────
def _seconds_per_ply(db: Session) -> float:
    recent = (
        db.query(Game.startedAt, Game.finishedAt, Game.totalPlies)
        .filter(Game.status == "done", Game.startedAt.isnot(None), Game.finishedAt.isnot(None))
        .order_by(Game.finishedAt.desc())
        .limit(20)
        .all()
    )
    rates = [
        (f - s).total_seconds() / plies
        for s, f, plies in recent
        if plies and (f - s).total_seconds() > 0
    ]
    return sum(rates) / len(rates) if rates else DEFAULT_SECONDS_PER_PLY


def _analyzed_count(db: Session, game_id: str) -> int:
    return db.query(func.count(AnalyzedMove.id)).filter(AnalyzedMove.gameId == game_id).scalar() or 0


def status_of(db: Session, game: Game) -> dict:
    analyzed = min(_analyzed_count(db, game.id), game.totalPlies)
    position, eta = 0, None
    if game.status in UNFINISHED:
        ahead = (
            db.query(Game)
            .filter(Game.status.in_(UNFINISHED), Game.createdAt < game.createdAt)
            .all()
        )
        position = max(0, len(ahead) - WORKER_SLOTS + 1)
        per_ply = _seconds_per_ply(db)
        ahead_remaining = sum(max(0, g.totalPlies - _analyzed_count(db, g.id)) for g in ahead)
        wait = ahead_remaining / WORKER_SLOTS if position else 0
        eta = int((wait + (game.totalPlies - analyzed)) * per_ply)
    return {
        "gameId": game.id,
        "status": game.status,
        "pgn": game.pgn,
        "totalPlies": game.totalPlies,
        "analyzed": analyzed,
        "queuePosition": position,
        "etaSeconds": eta,
        "attempts": game.attempts,
    }


# ── Storing worker results ──────────────────────────────────────────────────
def store_move(db: Session, data: dict) -> bool:
    """
    Persist one analysed ply and advance the game's status.
    Returns False for duplicates (a retried game re-sends earlier plies).
    """
    game_id = data.get("gameId", "")
    exists = (
        db.query(AnalyzedMove.id)
        .filter(
            AnalyzedMove.gameId == game_id,
            AnalyzedMove.moveNumber == data.get("moveNumber", 0),
            AnalyzedMove.player == data.get("player", ""),
        )
        .first()
    )
    if exists:
        _touch(db, game_id)
        db.commit()
        return False

    db.add(AnalyzedMove(
        gameId=game_id,
        moveNumber=data.get("moveNumber", 0),
        player=data.get("player", ""),
        moveSan=data.get("moveSan", ""),
        evaluation=data.get("evaluation", ""),
        bestMove=data.get("bestMove"),
        altEvaluation=data.get("altEvaluation"),
        opening=(data.get("opening") or None) and data["opening"][:150],
        bestLine=(data.get("bestLine") or None) and data["bestLine"][:100],
    ))
    db.flush()
    _touch(db, game_id)
    db.commit()
    return True


def _touch(db: Session, game_id: str) -> None:
    game = db.get(Game, game_id)
    if not game or game.status in ("done",):
        return
    now = utcnow()
    game.updatedAt = now
    game.startedAt = game.startedAt or now
    game.status = "analyzing"
    if _analyzed_count(db, game_id) >= game.totalPlies:
        game.status = "done"
        game.finishedAt = now


# ── Watchdog ────────────────────────────────────────────────────────────────
def requeue_stalled(db: Session, producer_factory, topic: str) -> int:
    """
    Retry games at the front of the queue that made no progress for
    STALL_SECONDS (worker crashed, restarted, or hung). Gives up after
    MAX_ATTEMPTS. Returns how many games were touched.
    """
    front = (
        db.query(Game)
        .filter(Game.status.in_(UNFINISHED))
        .order_by(Game.createdAt.asc())
        .limit(WORKER_SLOTS)
        .all()
    )
    if not front:
        return 0
    now = utcnow()
    last_free_slot = db.query(func.max(Game.finishedAt)).scalar()
    touched = 0
    for game in front:
        idle_since = game.updatedAt
        if game.status == "queued" and last_free_slot and last_free_slot > idle_since:
            idle_since = last_free_slot  # it only reached the front when a slot freed up
        if (now - idle_since).total_seconds() < STALL_SECONDS:
            continue
        touched += 1
        if game.attempts >= MAX_ATTEMPTS:
            game.status = "failed"
            game.finishedAt = now
            logger.warning("💀 Game %s failed after %d attempts", game.id, game.attempts)
            continue
        try:
            enqueue(producer_factory(), topic, game)
        except Exception as exc:
            logger.error("Watchdog could not re-queue %s: %s", game.id, exc)
            continue
        game.attempts += 1
        game.updatedAt = now
        logger.warning("🔁 Re-queued stalled game %s (attempt %d)", game.id, game.attempts)
    db.commit()
    return touched
