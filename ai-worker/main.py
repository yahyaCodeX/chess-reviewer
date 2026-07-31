import chess.pgn
import chess.engine
import os
import sys
import io
import json
from kafka import KafkaConsumer, KafkaProducer

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# Define the paths relative to this script
ENGINE_PATH = os.path.join("engine", "stockfish.exe")

def setup_kafka_producer():
    """Setup Kafka Producer to publish analyzed moves."""
    print("📤 Connecting Kafka Producer...")
    producer = KafkaProducer(
        bootstrap_servers=['localhost:9092'],
        value_serializer=lambda v: json.dumps(v).encode('utf-8')
    )
    print("✅ Kafka Producer ready!")
    return producer

def analyze_pgn_string(pgn_string, engine, producer):
    """Takes raw PGN text, runs Stockfish, and publishes moves to Kafka."""
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

        # Ask Stockfish to evaluate at fixed depth 18 (Grandmaster-level accuracy & consistency)
        info = engine.analyse(board, chess.engine.Limit(depth=18))
        score = info["score"].white()

        if score.is_mate():
            eval_str = f"Mate in {abs(score.mate())} for {'White' if score.mate() > 0 else 'Black'}"
        else:
            eval_str = f"{score.score() / 100:+.2f}"

        actual_move_num = (move_number + 1) // 2
        print(f"Move {actual_move_num} ({player}): {move_san} | Eval: {eval_str}")

        # Construct JSON payload for backend / STOMP WebSocket
        payload = {
            "moveNumber": actual_move_num,
            "player": player,
            "moveSan": move_san,
            "evaluation": eval_str
        }

        # Publish to Kafka topic 'analyzed-moves'
        producer.send('analyzed-moves', payload)

    producer.flush()
    print("📡 Analysis complete and published to Kafka topic 'analyzed-moves'!")
    print("-" * 40)

def start_worker():
    """Main loop: Listen to Kafka topic 'games-to-analyze' and publish to 'analyzed-moves'."""
    if not os.path.exists(ENGINE_PATH):
        print(f"❌ Error: Could not find Stockfish at '{ENGINE_PATH}'")
        return

    # 1. Setup Producer
    producer = setup_kafka_producer()

    # 2. Start Stockfish
    print("🤖 Waking up Stockfish...")
    engine = chess.engine.SimpleEngine.popen_uci(ENGINE_PATH)

    # 3. Setup Kafka Consumer
    print("📬 Connecting to Kafka post office...")
    consumer = KafkaConsumer(
        'games-to-analyze',
        bootstrap_servers=['localhost:9092'],
        auto_offset_reset='latest',          # Only pick up NEW messages, ignore old backlog
        group_id='chess-worker-group',        # Kafka remembers progress for this group
        enable_auto_commit=True,
        value_deserializer=lambda x: x.decode('utf-8')
    )

    print("🎧 Worker is now listening for games. Waiting for Spring Boot to send something...")

    try:
        for message in consumer:
            pgn_text = message.value
            print("\n🔔 BING! New message received from Spring Boot!")
            analyze_pgn_string(pgn_text, engine, producer)
            print("🎧 Waiting for the next game...")

    except KeyboardInterrupt:
        print("\n💤 Shutting down worker...")
    finally:
        engine.quit()
        producer.close()
        consumer.close()

if __name__ == "__main__":
    start_worker()