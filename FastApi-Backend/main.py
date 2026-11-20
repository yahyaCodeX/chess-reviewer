"""
main.py
-------
FastAPI application — entry point for the Chess Reviewer gateway.

Responsibilities
----------------
• Expose REST endpoints  (/api/analysis/submit, /api/analysis/moves,
                          /api/analysis/clear)
• Serve the STOMP-over-WebSocket endpoint  (/ws)  ← used by @stomp/stompjs
• On startup: create DB tables, capture the event loop, start the
  Kafka consumer background thread
• On shutdown: flush the Kafka producer

Run locally
-----------
    uvicorn main:app --reload --port 8080

Deploy to Render / Railway
--------------------------
    Start command:  uvicorn main:app --host 0.0.0.0 --port $PORT

Frontend WebSocket notes
------------------------
The React frontend uses @stomp/stompjs which speaks the STOMP 1.2 protocol
over a raw WebSocket.  STOMP wraps messages in frames like:

    CONNECT\n\n\x00
    SUBSCRIBE\ndestination:/topic/moves/<gameId>\n\n\x00
    MESSAGE\ndestination:/topic/moves/<gameId>\n\nbody\x00

This server handles the STOMP handshake manually so no extra dependency
(like stompserver or a full message broker) is needed.
"""

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import List, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

MAX_PGN_BYTES = 64 * 1024  # a long game with clock comments is ~15 KB

# ── Local modules ───────────────────────────────────────────────────────────
from database import Base, SessionLocal, engine, get_db
from kafka_manager import (
    TOPIC_SUBMIT,
    get_producer,
    start_consumer_thread,
)
from games import (
    PgnError,
    client_hash,
    create_game,
    enqueue,
    find_duplicate,
    parse_pgn,
    requeue_stalled,
    seconds_until_allowed,
    status_of,
)
from models import AnalyzedMove, AnalyzedMoveSchema, Game, GameStatusSchema

WATCHDOG_INTERVAL = 30  # seconds
from websocket_manager import manager as ws_manager

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lifespan  (replaces deprecated @app.on_event)
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Startup / shutdown logic executed once by Uvicorn.

    Startup:
      1. Create all SQLAlchemy tables (idempotent — skips existing ones).
      2. Store the running event loop on the WebSocket manager so the
         Kafka consumer thread can schedule coroutines on it.
      3. Launch the Kafka consumer background daemon thread.

    Shutdown:
      4. Flush and close the Kafka producer cleanly.
    """
    # ── Startup ─────────────────────────────────────────────────────────────
    logger.info("🚀 Chess Reviewer FastAPI gateway starting up …")

    # 1. Create DB tables, then add columns introduced after the table was first
    #    created (create_all never alters existing tables).
    Base.metadata.create_all(bind=engine)
    try:
        with engine.begin() as conn:
            for column, sql_type in (("bestMove", "VARCHAR(10)"), ("altEvaluation", "VARCHAR(50)"),
                                     ("opening", "VARCHAR(150)"), ("bestLine", "VARCHAR(100)")):
                conn.execute(text(f'ALTER TABLE analyzed_moves ADD COLUMN IF NOT EXISTS "{column}" {sql_type}'))
    except Exception as exc:
        logger.warning("Schema migration skipped: %s", exc)
    logger.info("✅ Database tables ensured")

    # 2. Capture the event loop for the Kafka thread
    ws_manager.loop = asyncio.get_running_loop()

    # 3. Start the consumer thread (daemon — dies when the main process exits)
    start_consumer_thread(connection_manager=ws_manager, SessionLocal=SessionLocal)
    logger.info("✅ Kafka consumer thread started")

    # 4. Watchdog: re-queue games whose worker crashed or hung
    watchdog = asyncio.create_task(_watchdog_loop())

    yield  # ← application runs while we are here

    watchdog.cancel()

    # ── Shutdown ─────────────────────────────────────────────────────────────
    logger.info("🛑 Shutting down — flushing Kafka producer …")
    try:
        get_producer().flush(timeout=10)
        logger.info("✅ Kafka producer flushed")
    except Exception as exc:
        logger.warning("Producer flush warning: %s", exc)


def _watchdog_once() -> int:
    db = SessionLocal()
    try:
        return requeue_stalled(db, get_producer, TOPIC_SUBMIT)
    finally:
        db.close()


async def _watchdog_loop():
    while True:
        await asyncio.sleep(WATCHDOG_INTERVAL)
        try:
            await asyncio.to_thread(_watchdog_once)
        except Exception as exc:
            logger.warning("Watchdog run failed: %s", exc)


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(
    title="Chess Reviewer API",
    description="Gateway between the React frontend, PostgreSQL, Kafka, and the Stockfish AI worker.",
    version="2.0.0",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# CORS Middleware
# ---------------------------------------------------------------------------
# Lock down in production with a comma-separated list, e.g.
#   CORS_ORIGINS=https://chess.example.com,http://localhost:5173
# and optionally a regex for Vercel preview deployments, e.g.
#   CORS_ORIGIN_REGEX=https://chess-reviewer(-[a-z0-9-]+)?\.vercel\.app
_cors_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]
_cors_regex = os.getenv("CORS_ORIGIN_REGEX") or None
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_origin_regex=_cors_regex,
    allow_credentials="*" not in _cors_origins,  # browsers reject credentials + wildcard
    allow_methods=["*"],
    allow_headers=["*"],
)


# ===========================================================================
# REST Endpoints
# ===========================================================================


@app.post(
    "/api/analysis/submit",
    response_class=PlainTextResponse,
    summary="Submit a PGN for analysis",
    tags=["Analysis"],
)
async def submit_pgn(request: Request, db: Session = Depends(get_db)):
    """
    Accept raw PGN text (Content-Type: text/plain) and return a plain
    `gameId` string the frontend subscribes to.

    • The same game (same moves) submitted again returns the existing
      gameId instantly — no second Stockfish run.
    • New games are rate limited per visitor (RATE_LIMIT_GAMES per window).
    • Invalid or over-long games are rejected with 400.
    """
    body = await request.body()
    if len(body) > MAX_PGN_BYTES:
        raise HTTPException(status_code=413, detail="PGN is too large.")
    pgn = body.decode("utf-8", errors="replace").strip()
    if not pgn:
        raise HTTPException(status_code=400, detail="PGN text must not be empty.")

    try:
        fingerprint, plies = parse_pgn(pgn)
    except PgnError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    existing = find_duplicate(db, fingerprint)
    if existing:
        logger.info("♻️  Duplicate game → reusing %s (%s)", existing.id, existing.status)
        return PlainTextResponse(existing.id, headers={"X-Duplicate": "true"})

    client = client_hash(request.client.host if request.client else None)
    wait = seconds_until_allowed(db, client)
    if wait:
        return JSONResponse(
            status_code=429,
            content={"detail": f"You've reviewed a lot of games recently. Please try again in {max(1, round(wait / 60))} min."},
            headers={"Retry-After": str(wait)},
        )

    game = create_game(db, pgn, fingerprint, plies, client)
    try:
        enqueue(get_producer(), TOPIC_SUBMIT, game)
    except Exception as exc:
        logger.error("Kafka produce failed: %s", exc)
        db.delete(game)
        db.commit()
        raise HTTPException(status_code=503, detail="The analysis queue is unavailable right now.")

    logger.info("📤 Submitted game %s (%d plies) to '%s'", game.id, plies, TOPIC_SUBMIT)
    return game.id


@app.get(
    "/api/analysis/games/{game_id}",
    response_model=GameStatusSchema,
    summary="Status, queue position and PGN of a submitted game",
    tags=["Analysis"],
)
def game_status(game_id: str, db: Session = Depends(get_db)):
    """Used for the queue message and to open shared review links."""
    game = db.get(Game, game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found.")
    return status_of(db, game)


@app.get(
    "/api/analysis/moves",
    response_model=List[AnalyzedMoveSchema],
    summary="Retrieve all analysed moves",
    tags=["Analysis"],
)
def get_moves(gameId: Optional[str] = None, db: Session = Depends(get_db)):
    """
    Return the analysed moves for one game (`?gameId=<uuid>`), ordered by
    insertion. Without `gameId`, returns the most recent 500 rows.
    """
    query = db.query(AnalyzedMove)
    if gameId:
        return query.filter(AnalyzedMove.gameId == gameId).order_by(AnalyzedMove.id).all()
    return list(reversed(query.order_by(AnalyzedMove.id.desc()).limit(500).all()))


@app.delete(
    "/api/analysis/clear",
    summary="Clear all analysed moves",
    tags=["Analysis"],
)
def clear_moves(x_admin_token: Optional[str] = Header(default=None), db: Session = Depends(get_db)):
    """
    Delete **all** analysed moves and games.

    Disabled unless ADMIN_TOKEN is set; callers must send it in the
    `X-Admin-Token` header.
    """
    admin_token = os.getenv("ADMIN_TOKEN")
    if not admin_token or x_admin_token != admin_token:
        raise HTTPException(status_code=403, detail="Forbidden")
    deleted = db.query(AnalyzedMove).delete()
    db.query(Game).delete()
    db.commit()
    logger.info("🗑  Cleared %d moves from the database", deleted)
    return {"message": f"Cleared {deleted} move(s) from the database."}


# ===========================================================================
# STOMP-over-WebSocket Endpoint  (/ws)
# ===========================================================================
# The React frontend uses @stomp/stompjs which speaks the STOMP 1.2 protocol
# over a plain WebSocket connection to ws://localhost:8080/ws.
#
# STOMP wire format (simplified):
#   CLIENT → CONNECT\naccept-version:1.2\n\n\x00
#   SERVER → CONNECTED\nversion:1.2\n\n\x00
#   CLIENT → SUBSCRIBE\ndestination:/topic/moves/<gameId>\nid:sub-0\n\n\x00
#   SERVER → MESSAGE\ndestination:/topic/moves/<gameId>\n\n<json>\x00
#
# We handle this framing manually — no extra broker dependency needed.
# ===========================================================================

NULL = "\x00"  # STOMP frame terminator


def _build_stomp_frame(command: str, headers: dict, body: str = "") -> str:
    """Build a raw STOMP 1.2 frame string."""
    header_str = "".join(f"{k}:{v}\n" for k, v in headers.items())
    return f"{command}\n{header_str}\n{body}{NULL}"


def _parse_stomp_frame(raw: str) -> tuple[str, dict, str]:
    """
    Parse a raw STOMP frame into (command, headers, body).
    Returns ('', {}, '') on parse failure.
    """
    try:
        frame = raw.rstrip(NULL)
        lines = frame.split("\n")
        command = lines[0].strip()
        headers: dict = {}
        body_lines = []
        in_body = False
        for line in lines[1:]:
            if in_body:
                body_lines.append(line)
            elif line == "":
                in_body = True
            else:
                if ":" in line:
                    k, _, v = line.partition(":")
                    headers[k.strip()] = v.strip()
        return command, headers, "\n".join(body_lines)
    except Exception:
        return "", {}, ""


@app.websocket("/ws")
async def stomp_websocket_endpoint(websocket: WebSocket):
    """
    Single STOMP-over-WebSocket endpoint.

    The frontend (@stomp/stompjs) connects here and subscribes to:
        /topic/moves/<gameId>

    The Kafka consumer calls ws_manager.broadcast(game_id, json_str)
    which builds a STOMP MESSAGE frame and sends it to every subscriber
    of that topic.

    Raw native WebSocket connections (e.g. curl / test scripts) are also
    supported — they receive the plain JSON string without STOMP framing.
    """
    await websocket.accept()
    # STOMP subscription id → gameId, for this particular connection
    subscribed_games: dict[str, str] = {}
    is_stomp = False  # becomes True after we see a STOMP CONNECT frame

    try:
        while True:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=30)
            except asyncio.TimeoutError:
                # Send a STOMP heartbeat / NOOP to keep the connection alive
                if is_stomp:
                    await websocket.send_text("\n")  # STOMP heartbeat
                continue

            # ── Detect & handle STOMP frames ──────────────────────────────
            if raw.startswith("CONNECT") or raw.startswith("STOMP"):
                is_stomp = True
                command, headers, _ = _parse_stomp_frame(raw)
                connected_frame = _build_stomp_frame(
                    "CONNECTED",
                    {"version": "1.2", "heart-beat": "0,0"},
                )
                await websocket.send_text(connected_frame)
                logger.info("🤝 STOMP CONNECT from client")

            elif raw.startswith("SUBSCRIBE"):
                _, headers, _ = _parse_stomp_frame(raw)
                destination = headers.get("destination", "")
                # destination is like  /topic/moves/<gameId>
                sub_id = headers.get("id", "sub-0")
                if destination.startswith("/topic/moves/"):
                    game_id = destination.split("/topic/moves/")[-1]
                    subscribed_games[sub_id] = game_id
                    await ws_manager.connect(game_id, websocket, sub_id)
                    logger.info("📡 STOMP SUBSCRIBE game_id=%s sub=%s", game_id, sub_id)

            elif raw.startswith("UNSUBSCRIBE"):
                _, headers, _ = _parse_stomp_frame(raw)
                game_id = subscribed_games.pop(headers.get("id", ""), None)
                if game_id:
                    await ws_manager.disconnect(game_id, websocket)

            elif raw.startswith("DISCONNECT"):
                receipt = _parse_stomp_frame(raw)[1].get("receipt", "")
                if receipt:
                    await websocket.send_text(
                        _build_stomp_frame("RECEIPT", {"receipt-id": receipt})
                    )
                break

            elif raw.strip() == "":  # heartbeat NOOP
                pass

            else:
                logger.debug("Unhandled STOMP frame: %s", raw[:60])

    except WebSocketDisconnect:
        logger.info("WS client disconnected")
    except Exception as exc:
        logger.warning("WS error: %s", exc)
    finally:
        for game_id in set(subscribed_games.values()):
            await ws_manager.disconnect(game_id, websocket)
        logger.info("♻️  STOMP session cleaned up  games=%s", list(subscribed_games.values()))


# ===========================================================================
# Health check
# ===========================================================================


@app.get("/health", tags=["Meta"])
def health():
    """Quick liveness probe for Render / Railway / Docker health checks."""
    return {
        "status": "ok",
        "service": "chess-reviewer-gateway",
        "active_ws_games": ws_manager.active_games(),
    }
