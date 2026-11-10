import chess.pgn
import chess.engine
import os
import sys
import io
import json
import requests
import time
import concurrent.futures
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from confluent_kafka import Consumer, Producer
from dotenv import load_dotenv

from opening_book import OpeningBook

load_dotenv()

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

HERE = os.path.dirname(os.path.abspath(__file__))

# Detect the Operating System automatically (override with STOCKFISH_PATH)
_default_engine = "stockfish.exe" if sys.platform == "win32" else "stockfish-linux"
ENGINE_PATH = os.getenv("STOCKFISH_PATH", os.path.join(HERE, "engine", _default_engine))
if sys.platform != "win32" and os.path.exists(ENGINE_PATH):
    try:
        os.chmod(ENGINE_PATH, 0o755)  # Give Linux permission to execute the file
    except PermissionError:
        pass  # Already executable inside a read-only container image

# Engine tuning — lower ENGINE_DEPTH on small cloud VMs to finish games faster
ENGINE_DEPTH = int(os.getenv("ENGINE_DEPTH", "18"))
ENGINE_THREADS = int(os.getenv("ENGINE_THREADS", "1"))
ENGINE_HASH_MB = int(os.getenv("ENGINE_HASH_MB", "64"))
MAX_PARALLEL_GAMES = int(os.getenv("MAX_PARALLEL_GAMES", "2"))
MAX_PLIES = int(os.getenv("MAX_PLIES", "400"))      # safety net; the gateway enforces its own limit
BEST_LINE_PLIES = 8                                 # how much of the engine's line to send

# Local opening book (primary). Lichess's explorer now requires a token
# (unauthenticated requests get 401), so it is only used when one is set.
OPENING_BOOK = OpeningBook(os.path.join(HERE, "openings"))
LICHESS_EXPLORER_URL = "https://explorer.lichess.ovh/masters"
LICHESS_TOKEN = os.getenv("LICHESS_TOKEN", "")
# Check book moves for the first N plies (30 plies = 15 full moves)
BOOK_PLY_LIMIT = 30

KAFKA_URL = os.getenv("KAFKA_URL", "localhost:9092")
KAFKA_SECURITY_PROTOCOL = os.getenv("KAFKA_SECURITY_PROTOCOL", "PLAINTEXT").upper()

kafka_connection_args = {
    "bootstrap.servers": KAFKA_URL,
    "security.protocol": KAFKA_SECURITY_PROTOCOL
}

if KAFKA_SECURITY_PROTOCOL == "SSL":
    _cert_dir = os.getenv(
        "KAFKA_CERT_DIR",
        os.path.join(HERE, "..", "FastApi-Backend", "certs"),
    )
    kafka_connection_args.update({
        "ssl.ca.location": os.getenv("KAFKA_CA_CERT", os.path.join(_cert_dir, "ca.pem")),
        "ssl.certificate.location": os.getenv("KAFKA_CLIENT_CERT", os.path.join(_cert_dir, "service.cert")),
        "ssl.key.location": os.getenv("KAFKA_CLIENT_KEY", os.path.join(_cert_dir, "service.key")),
        "ssl.endpoint.identification.algorithm": "none"
    })

# Setup robust session for Lichess API to prevent connection drops/timeouts
lichess_session = requests.Session()
retries = Retry(total=3, backoff_factor=0.5, status_forcelist=[429, 500, 502, 503, 504])
lichess_session.mount('https://', HTTPAdapter(max_retries=retries))
lichess_session.headers.update({'User-Agent': 'ChessReviewer/1.0'})
if LICHESS_TOKEN:
    lichess_session.headers.update({'Authorization': f'Bearer {LICHESS_TOKEN}'})


def is_book_move(fen: str, move_uci: str) -> bool:
    """
    Queries the Lichess Masters Opening Explorer for the given FEN.
    Returns True if 'move_uci' is among the moves played by masters in this position.
    Falls back to False on any network/parse error so analysis always continues.
    """
    try:
        resp = lichess_session.get(LICHESS_EXPLORER_URL, params={"fen": fen}, timeout=10)
        # Small delay to respect Lichess rate limits
        time.sleep(0.1)
        if resp.status_code != 200:
            print(f"⚠️  Lichess explorer returned HTTP {resp.status_code}")
            return False
        data = resp.json()
        master_moves = [m.get("uci", "") for m in data.get("moves", [])]
        return move_uci in master_moves
    except Exception as e:
        print(f"⚠️  Lichess API error (falling back to Stockfish): {e}")
        return False


def setup_kafka_producer():
    """Setup Kafka Producer to publish analyzed moves."""
    print("📤 Connecting Kafka Producer...")
    producer = Producer(kafka_connection_args)
    print("✅ Kafka Producer ready!")
    return producer


def format_score(board: chess.Board, info) -> str:
    """Turn a Stockfish score (White's POV) into the string the frontend parses."""
    if board.is_checkmate():
        # The side that just moved delivered mate. Stockfish reports Mate(0)
        # here, which carries no sign, so derive the winner from the board.
        winner = "Black" if board.turn == chess.WHITE else "White"
        return f"Mate in 0 for {winner}"
    if info is None:
        return "+0.00"  # stalemate / insufficient material etc.

    score = info["score"].white()
    if score.is_mate():
        # Positive mate() = White mates; negative = Black mates
        side = "White" if score.mate() > 0 else "Black"
        return f"Mate in {abs(score.mate())} for {side}"
    return f"{score.score() / 100:+.2f}"


def analyse_position(engine, board: chess.Board) -> dict:
    """
    Evaluate a position with the two best lines (MultiPV 2).

    Returns the eval string, the engine's best move, and the eval of the
    second-best move — used by the frontend to detect "only moves" (Great).
    """
    if board.is_game_over():
        return {"eval": format_score(board, None), "best": None, "alt": None, "line": None}
    infos = engine.analyse(board, chess.engine.Limit(depth=ENGINE_DEPTH), multipv=2)
    pv = infos[0].get("pv") or []
    return {
        "eval": format_score(board, infos[0]),
        "best": pv[0].uci() if pv else None,
        "alt": format_score(board, infos[1]) if len(infos) > 1 else None,
        # The engine's main line (UCI), so the UI can show "best: O-O Qxe4 Re1 …"
        "line": " ".join(m.uci() for m in pv[:BEST_LINE_PLIES]) or None,
    }


def analyze_pgn_string(pgn_string, game_id, producer):
    """Takes raw PGN text, runs Stockfish, and publishes moves to Kafka."""
    print(f"\n📂 [Game {game_id}] Reading game from Kafka message...")

    try:
        engine = chess.engine.SimpleEngine.popen_uci(ENGINE_PATH)
        engine.configure({"Threads": ENGINE_THREADS, "Hash": ENGINE_HASH_MB})
    except Exception as e:
        print(f"❌ Error starting Stockfish engine: {e}")
        return

    try:
        # chess.pgn.read_game expects a file-like object, not raw text
        game = chess.pgn.read_game(io.StringIO(pgn_string))

        if game is None:
            print("❌ Error: No valid game found in the message.")
            return

        plies = sum(1 for _ in game.mainline_moves())
        if plies == 0 or plies > MAX_PLIES:
            print(f"❌ [Game {game_id}] Skipped: {plies} plies (limit {MAX_PLIES}).")
            return

        print(f"⚔️  Match: {game.headers.get('White', 'Unknown')} vs {game.headers.get('Black', 'Unknown')}")
        print("=" * 40)

        board = game.board()
        # Analysis of the position *before* the current move: its best move and
        # second-best eval describe the choice the player was facing.
        before = analyse_position(engine, board)
        in_book = True
        opening_name = None

        for move_number, move in enumerate(game.mainline_moves(), start=1):
            player = "White" if board.turn == chess.WHITE else "Black"
            move_san = board.san(move)
            move_uci = move.uci()
            fen_before = board.fen()
            actual_move_num = (move_number + 1) // 2
            board.push(move)

            # ── Book detection: local opening book, then (optionally) Lichess ──
            opening = None
            if in_book:
                hit, name = OPENING_BOOK.lookup(board)
                if not hit and LICHESS_TOKEN and move_number <= BOOK_PLY_LIMIT:
                    hit = is_book_move(fen_before, move_uci)
                if hit:
                    opening_name = name or opening_name
                    opening = opening_name or "Opening theory"
                else:
                    in_book = False  # once out of book, never go back in

            # Every position is evaluated — book moves too — so the eval graph
            # and the first move out of book have a real baseline.
            after = analyse_position(engine, board)
            print(f"Move {actual_move_num} ({player}): {move_san} | Eval: {after['eval']}"
                  + (f" | 📖 {opening}" if opening else ""))

            payload = {
                "gameId": game_id,
                "moveNumber": actual_move_num,
                "player": player,
                "moveSan": move_san,
                "evaluation": after["eval"],
                "bestMove": before["best"],          # engine's choice in the position before
                "altEvaluation": before["alt"],      # eval of the second-best move there
                "bestLine": before["line"],          # engine's main line from there (UCI)
                "opening": opening,                  # non-null ⇒ book move
            }
            before = after

            producer.produce(
                'analyzed-moves',
                json.dumps(payload).encode('utf-8'),
                key=game_id.encode('utf-8'),  # keeps a game's moves in order on one partition
            )
            producer.poll(0)

        producer.flush()
        print(f"📡 [Game {game_id}] Analysis complete and published to 'analyzed-moves'!")
        print("-" * 40)
    except Exception as e:
        print(f"❌ [Game {game_id}] Analysis failed: {e}")
    finally:
        engine.quit()


def start_worker():
    """Main loop: Listen to Kafka topic 'games-to-analyze' and publish to 'analyzed-moves'."""
    if not os.path.exists(ENGINE_PATH):
        print(f"❌ Error: Could not find Stockfish at '{ENGINE_PATH}'")
        return

    producer = setup_kafka_producer()

    print("📬 Connecting to Kafka...")
    consumer_args = kafka_connection_args.copy()
    consumer_args.update({
        'group.id': 'chess-worker-group',
        'auto.offset.reset': 'latest',
        'enable.auto.commit': True
    })
    consumer = Consumer(consumer_args)
    consumer.subscribe(['games-to-analyze'])

    print(f"📖 Opening book loaded: {len(OPENING_BOOK)} positions")
    print(f"🎧 Worker listening (depth={ENGINE_DEPTH}, parallel games={MAX_PARALLEL_GAMES})...")

    # Only take a game off Kafka when a slot is free. Waiting games then stay
    # in Kafka (safe across restarts) instead of piling up in this process.
    # pause()/resume() keeps us polling, so the broker doesn't evict us
    # from the consumer group while long games are running.
    in_flight = set()
    paused = False
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_PARALLEL_GAMES) as executor:
        try:
            while True:
                in_flight = {f for f in in_flight if not f.done()}
                full = len(in_flight) >= MAX_PARALLEL_GAMES
                assignment = consumer.assignment()
                if full and not paused and assignment:
                    consumer.pause(assignment)
                    paused = True
                elif not full and paused:
                    consumer.resume(consumer.assignment())
                    paused = False

                message = consumer.poll(1.0)
                if message is None:
                    continue
                if message.error():
                    print(f"Consumer error: {message.error()}")
                    continue

                raw_value = message.value().decode('utf-8')
                print("\n🔔 New game received!")
                try:
                    parsed = json.loads(raw_value)
                    game_id = parsed["gameId"]
                    pgn_text = parsed["pgn"]
                    print(f"🆔 Game ID: {game_id}")
                except (json.JSONDecodeError, KeyError) as e:
                    print(f"❌ Error parsing message JSON: {e}")
                    continue

                in_flight.add(executor.submit(analyze_pgn_string, pgn_text, game_id, producer))

        except KeyboardInterrupt:
            print("\n💤 Shutting down worker...")
        finally:
            producer.flush(10)
            consumer.close()


if __name__ == "__main__":
    start_worker()
