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
from kafka import KafkaConsumer, KafkaProducer

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# Detect the Operating System automatically!
if sys.platform == "win32":
    ENGINE_PATH = os.path.join("engine", "stockfish.exe") # Use this on your laptop
else:
    ENGINE_PATH = os.path.join("engine", "stockfish-linux") # Use this on Render
    os.chmod(ENGINE_PATH, 0o755) # Give Linux permission to execute the file

# Lichess Masters Opening Explorer — free, no API key required
LICHESS_EXPLORER_URL = "https://explorer.lichess.ovh/masters"
# Check book moves for the first N plies (30 plies = 15 full moves)
BOOK_PLY_LIMIT = 30

KAFKA_URL = os.getenv("KAFKA_URL", "localhost:9092")
KAFKA_SECURITY_PROTOCOL = os.getenv("KAFKA_SECURITY_PROTOCOL", "PLAINTEXT")

kafka_connection_args = {
    "bootstrap_servers": [KAFKA_URL],
    "security_protocol": KAFKA_SECURITY_PROTOCOL
}

if KAFKA_SECURITY_PROTOCOL == "SSL":
    kafka_connection_args.update({
        "ssl_cafile": "../api/src/main/resources/certs/ca.pem",
        "ssl_certfile": "../api/src/main/resources/certs/service.cert",
        "ssl_keyfile": "../api/src/main/resources/certs/service.key"
    })

# Setup robust session for Lichess API to prevent connection drops/timeouts
lichess_session = requests.Session()
retries = Retry(total=3, backoff_factor=0.5, status_forcelist=[429, 500, 502, 503, 504])
lichess_session.mount('https://', HTTPAdapter(max_retries=retries))
lichess_session.headers.update({'User-Agent': 'PortfolioChessApp/1.0 (yahya@example.com)'})

def is_book_move(fen: str, move_uci: str) -> bool:
    """
    Queries the Lichess Masters Opening Explorer for the given FEN.
    Returns True if 'move_uci' is among the moves played by masters in this position.
    Falls back to False on any network/parse error so analysis always continues.
    """
    try:
        resp = lichess_session.get(
            LICHESS_EXPLORER_URL,
            params={"fen": fen},
            timeout=10  # Increased timeout for Lichess API
        )
        # Small delay to respect Lichess free tier rate limits
        time.sleep(0.1)
        if resp.status_code != 200:
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
    producer = KafkaProducer(
        **kafka_connection_args,
        value_serializer=lambda v: json.dumps(v).encode('utf-8')
    )
    print("✅ Kafka Producer ready!")
    return producer

def analyze_pgn_string(pgn_string, game_id, producer):
    """Takes raw PGN text, runs Stockfish, and publishes moves to Kafka."""
    print(f"\n📂 [Game {game_id}] Reading game from Kafka message...")

    try:
        engine = chess.engine.SimpleEngine.popen_uci(ENGINE_PATH)
    except Exception as e:
        print(f"❌ Error starting Stockfish engine: {e}")
        return

    try:
        # chess.pgn.read_game expects a file-like object, not raw text
        pgn_file = io.StringIO(pgn_string)
        game = chess.pgn.read_game(pgn_file)

        if game is None:
            print("❌ Error: No valid game found in the message.")
            return

        print(f"⚔️  Match: {game.headers.get('White', 'Unknown')} vs {game.headers.get('Black', 'Unknown')}")
        print("=" * 40)

        board = game.board()

        for move_number, move in enumerate(game.mainline_moves(), start=1):
            player = "White" if board.turn == chess.WHITE else "Black"
            move_san = board.san(move)
            move_uci = move.uci()      # e.g. "e2e4" — needed for the Lichess API
            fen_before = board.fen()   # FEN *before* the move is played

            # ── Book Move Detection (first BOOK_PLY_LIMIT plies only) ──────────
            if move_number <= BOOK_PLY_LIMIT and is_book_move(fen_before, move_uci):
                board.push(move)
                eval_str = "BOOK"
                actual_move_num = (move_number + 1) // 2
                print(f"Move {actual_move_num} ({player}): {move_san} | Eval: 📖 BOOK (skipping Stockfish)")
            else:
                # ── Stockfish Evaluation ────────────────────────────────────────
                board.push(move)

                # Depth 18 — Grandmaster-level accuracy & consistency
                info = engine.analyse(board, chess.engine.Limit(depth=18))
                score = info["score"].white()

                if score.is_mate():
                    # Positive mate() = White mates; negative = Black mates
                    side = "White" if score.mate() > 0 else "Black"
                    eval_str = f"Mate in {abs(score.mate())} for {side}"
                else:
                    eval_str = f"{score.score() / 100:+.2f}"

                actual_move_num = (move_number + 1) // 2
                print(f"Move {actual_move_num} ({player}): {move_san} | Eval: {eval_str}")

            # Construct JSON payload for backend / STOMP WebSocket
            payload = {
                "gameId": game_id,
                "moveNumber": actual_move_num,
                "player": player,
                "moveSan": move_san,
                "evaluation": eval_str
            }

            # Publish to Kafka topic 'analyzed-moves'
            producer.send('analyzed-moves', payload)

        producer.flush()
        print(f"📡 [Game {game_id}] Analysis complete and published to Kafka topic 'analyzed-moves'!")
        print("-" * 40)
    finally:
        engine.quit()

def start_worker():
    """Main loop: Listen to Kafka topic 'games-to-analyze' and publish to 'analyzed-moves'."""
    if not os.path.exists(ENGINE_PATH):
        print(f"❌ Error: Could not find Stockfish at '{ENGINE_PATH}'")
        return

    # 1. Setup Producer
    producer = setup_kafka_producer()

    # 2. Setup Kafka Consumer
    print("📬 Connecting to Kafka post office...")
    consumer = KafkaConsumer(
        'games-to-analyze',
        **kafka_connection_args,
        auto_offset_reset='latest',          # Only pick up NEW messages, ignore old backlog
        group_id='chess-worker-group',        # Kafka remembers progress for this group
        enable_auto_commit=True,
        value_deserializer=lambda x: x.decode('utf-8')
    )

    print("🎧 Worker is now listening for games. Waiting for Spring Boot to send something...")

    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        try:
            for message in consumer:
                raw_value = message.value
                print("\n🔔 BING! New message received from Spring Boot!")
                try:
                    parsed = json.loads(raw_value)
                    game_id = parsed["gameId"]
                    pgn_text = parsed["pgn"]
                    print(f"🆔 Game ID: {game_id}")
                except (json.JSONDecodeError, KeyError) as e:
                    print(f"❌ Error parsing message JSON: {e}")
                    continue
                
                executor.submit(analyze_pgn_string, pgn_text, game_id, producer)
                print("🎧 Submitted to thread pool. Waiting for the next game...")

        except KeyboardInterrupt:
            print("\n💤 Shutting down worker...")
        finally:
            producer.close()
            consumer.close()

if __name__ == "__main__":
    start_worker()