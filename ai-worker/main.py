import chess.pgn
import chess.engine
import os
import sys
import psycopg2 # <-- New tool to talk to PostgreSQL!

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')


# Define the paths relative to this script
ENGINE_PATH = os.path.join("engine", "stockfish.exe")
PGN_PATH = "test_game.pgn"

# Database connection settings (matching your docker-compose.yml)
DB_PARAMS = {
    "dbname": "chess_data",
    "user": "chess_user",
    "password": "password123",
    "host": "localhost",
    "port": "5432"
}

def analyze_game():
    # 1. Check if the Stockfish engine is exactly where we expect it
    if not os.path.exists(ENGINE_PATH):
        print(f"Error: Could not find Stockfish at '{ENGINE_PATH}'")
        print("Please make sure 'stockfish.exe' is inside the 'engine' folder.")
        return

    print("🤖 Waking up Stockfish...")
    # Start the engine process in the background
    engine = chess.engine.SimpleEngine.popen_uci(ENGINE_PATH)

    print("🔌 Connecting to the database...")
    # Connect to PostgreSQL and create a "cursor" to execute SQL commands
    conn = psycopg2.connect(**DB_PARAMS)
    cursor = conn.cursor()

    # Create a table to store our moves if it doesn't exist already
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

    print(f"📂 Reading chess game from '{PGN_PATH}'...")
    
    # 2. Open and parse the PGN file
    with open(PGN_PATH) as pgn_file:
        game = chess.pgn.read_game(pgn_file)
        
        if game is None:
            print("Error: No game found in the PGN file.")
            engine.quit()
            return

        print(f"\n⚔️  Match: {game.headers.get('White', 'Unknown')} vs {game.headers.get('Black', 'Unknown')}")
        print("=" * 40)

        # Setup a virtual chessboard starting from the initial position
        board = game.board()

        # 3. Loop through every move played in the game
        for move_number, move in enumerate(game.mainline_moves(), start=1):
            
            # Determine whose turn it was to make this move
            player = "White" if board.turn == chess.WHITE else "Black"
            move_san = board.san(move) # Gets the standard algebraic notation (e.g., "Nf3")

            # Apply the move to our virtual board
            board.push(move)

            # 4. Ask Stockfish to evaluate this new position
            # We set a time limit of 0.1 seconds per move so the MVP runs quickly
            info = engine.analyse(board, chess.engine.Limit(time=0.1))

            # 5. Extract the evaluation score
            # score.white() ensures the score is always from White's perspective (+ means White is winning)
            score = info["score"].white()
            
            # Format the score nicely
            if score.is_mate():
                eval_str = f"Mate in {abs(score.mate())} for {'White' if score.mate() > 0 else 'Black'}"
            else:
                # Convert centipawns (100cp = 1 pawn) to standard decimal format
                eval_str = f"{score.score() / 100:+.2f}"

            # 6. Print the results for this specific move
            actual_move_num = (move_number + 1) // 2
            print(f"Move {actual_move_num} ({player}): {move_san}")
            print(f"Evaluation: {eval_str}")
            print("-" * 25)

            # NEW: Save this move directly into the database!
            cursor.execute("""
                INSERT INTO analyzed_move (move_number, player, move_san, evaluation)
                VALUES (%s, %s, %s, %s)
            """, (actual_move_num, player, move_san, eval_str))

    # Save all the inserted moves permanently
    conn.commit()

    # Close the database connection
    cursor.close()
    conn.close()
    print("💾 All moves saved to the database successfully!")

    # 7. ALWAYS quit the engine when done, or it will run forever in the background!
    print("💤 Analysis complete. Shutting down Stockfish.")
    engine.quit()

if __name__ == "__main__":
    analyze_game()