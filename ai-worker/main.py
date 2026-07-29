import chess.pgn
import chess.engine
import os
import sys
import psycopg2
import io
from kafka import KafkaConsumer

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# Define the paths relative to this script
ENGINE_PATH = os.path.join("engine", "stockfish.exe")

# Database connection settings
DB_PARAMS = {
    "dbname": "chess_data",
    "user": "chess_user",
    "password": "password123",
    "host": "localhost",
    "port": "5432"
}

def setup_database():
    """Connect to DB and ensure our table exists."""
    print("🔌 Connecting to the database...")
    conn = psycopg2.connect(**DB_PARAMS)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS analyzed_move (
            id SERIAL PRIMARY KEY,
            move_number INTEGER,
            player VARCHAR(10),
            move_san VARCHAR(10),
            evaluation VARCHAR(50)
        )
    """)
    conn.commit()
    print("✅ Database ready!")
    return conn, cursor

def analyze_pgn_string(pgn_string, engine, conn, cursor):
    """Takes raw PGN text, runs Stockfish, and saves to DB."""
    print("\n📂 Reading game from Kafka message...")

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
        board.push(move)

        # Ask Stockfish to evaluate
        info = engine.analyse(board, chess.engine.Limit(time=0.1))
        score = info["score"].white()

        if score.is_mate():
            eval_str = f"Mate in {abs(score.mate())} for {'White' if score.mate() > 0 else 'Black'}"
        else:
            eval_str = f"{score.score() / 100:+.2f}"

        actual_move_num = (move_number + 1) // 2
        print(f"Move {actual_move_num} ({player}): {move_san} | Eval: {eval_str}")

        # Save to database (correct table name: analyzed_move)
        cursor.execute("""
            INSERT INTO analyzed_move (move_number, player, move_san, evaluation)
            VALUES (%s, %s, %s, %s)
        """, (actual_move_num, player, move_san, eval_str))

    conn.commit()
    print("💾 Analysis complete and saved to database!")
    print("-" * 40)

def start_worker():
    """Main loop: Listen to Kafka and process games as they arrive."""
    if not os.path.exists(ENGINE_PATH):
        print(f"❌ Error: Could not find Stockfish at '{ENGINE_PATH}'")
        return

    # 1. Setup DB
    conn, cursor = setup_database()

    # 2. Start Stockfish
    print("🤖 Waking up Stockfish...")
    engine = chess.engine.SimpleEngine.popen_uci(ENGINE_PATH)

    # 3. Setup Kafka Consumer
    print("📬 Connecting to Kafka post office...")
    consumer = KafkaConsumer(
        'games-to-analyze',
        bootstrap_servers=['localhost:9092'],
        auto_offset_reset='earliest',
        enable_auto_commit=True,
        value_deserializer=lambda x: x.decode('utf-8')
    )

    print("🎧 Worker is now listening for games. Waiting for Spring Boot to send something...")

    try:
        for message in consumer:
            pgn_text = message.value
            print("\n🔔 BING! New message received from Spring Boot!")
            analyze_pgn_string(pgn_text, engine, conn, cursor)
            print("🎧 Waiting for the next game...")

    except KeyboardInterrupt:
        print("\n💤 Shutting down worker...")
    finally:
        engine.quit()
        cursor.close()
        conn.close()

if __name__ == "__main__":
    start_worker()