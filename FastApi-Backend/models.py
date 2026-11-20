"""
models.py
---------
SQLAlchemy ORM models and Pydantic response schemas.
"""

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Column, DateTime, Integer, String, Text
from pydantic import BaseModel

from database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)  # naive UTC, portable across DBs


# ---------------------------------------------------------------------------
# ORM Models
# ---------------------------------------------------------------------------
class AnalyzedMove(Base):
    """
    Stores one analysed half-move (ply) from a chess game.

    Columns mirror the payload produced by the AI worker:
        gameId      — UUID that ties a set of moves to one PGN submission
        moveNumber  — full-move number (1, 2, 3 …)
        player      — "White" or "Black"
        moveSan     — Standard Algebraic Notation  e.g. "Nf3", "O-O"
        evaluation  — Stockfish score string        e.g. "+0.34", "Mate in 3 for White"
    """

    __tablename__ = "analyzed_moves"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    gameId = Column(String, index=True, nullable=False)
    moveNumber = Column(Integer, nullable=False)
    player = Column(String(10), nullable=False)          # "White" | "Black"
    moveSan = Column(String(20), nullable=False)
    evaluation = Column(String(50), nullable=False)
    bestMove = Column(String(10), nullable=True)          # engine's best move (UCI) before this ply
    altEvaluation = Column(String(50), nullable=True)     # eval of the 2nd-best move before this ply
    opening = Column(String(150), nullable=True)          # opening name; non-null ⇒ book move
    bestLine = Column(String(100), nullable=True)         # engine's main line before this ply (UCI)


class Game(Base):
    """
    One submitted game. Drives de-duplication, rate limiting, the queue
    position shown to users, share links and the stuck-game watchdog.

    status: queued → analyzing → done   (or failed after MAX_ATTEMPTS)
    """

    __tablename__ = "games"

    id = Column(String(36), primary_key=True)             # the public gameId
    pgnHash = Column(String(64), index=True, nullable=False)
    pgn = Column(Text, nullable=False)
    totalPlies = Column(Integer, nullable=False)
    status = Column(String(12), index=True, nullable=False, default="queued")
    attempts = Column(Integer, nullable=False, default=1)
    clientHash = Column(String(64), index=True, nullable=True)  # salted hash of the submitter's IP
    createdAt = Column(DateTime, index=True, nullable=False, default=utcnow)
    updatedAt = Column(DateTime, nullable=False, default=utcnow)   # last submit/retry/move
    startedAt = Column(DateTime, nullable=True)                    # first analysed move
    finishedAt = Column(DateTime, nullable=True)


# ---------------------------------------------------------------------------
# Pydantic Schemas  (used for request validation & response serialisation)
# ---------------------------------------------------------------------------
class AnalyzedMoveSchema(BaseModel):
    """Response schema returned by GET /api/analysis/moves."""

    id: int
    gameId: str
    moveNumber: int
    player: str
    moveSan: str
    evaluation: str
    bestMove: Optional[str] = None
    altEvaluation: Optional[str] = None
    opening: Optional[str] = None
    bestLine: Optional[str] = None

    model_config = {"from_attributes": True}  # replaces orm_mode in Pydantic v2


class GameStatusSchema(BaseModel):
    """Response of GET /api/analysis/games/{gameId}."""

    gameId: str
    status: str               # queued | analyzing | done | failed
    pgn: str
    totalPlies: int
    analyzed: int
    queuePosition: int        # 0 = being analysed now; N = N games ahead in line
    etaSeconds: Optional[int] = None
    attempts: int


class SubmitResponse(BaseModel):
    """Response returned by POST /api/analysis/submit."""

    gameId: str
    message: str
