# ♟️ AI Chess Reviewer

> **An event-driven, real-time chess game review platform.** Paste a PGN or pick a game from
> Chess.com or Lichess, and Stockfish reviews it move by move. Every rating (Brilliant, Great,
> Best, Mistake, Blunder…) streams live to the board, with plain-English explanations of what
> went wrong and what to play instead.

**🔗 Live demo:** _add your link here_  &nbsp;·&nbsp; [![CI](https://github.com/yahyaCodeX/chess-reviewer/actions/workflows/ci.yml/badge.svg)](https://github.com/yahyaCodeX/chess-reviewer/actions/workflows/ci.yml)

---

## 🎬 Demo

> 📌 Paste your GitHub-uploaded video or GIF URL below (see [how](#-adding-a-demo-video)) and delete this line.

https://github.com/user-attachments/assets/YOUR-VIDEO-URL-HERE

---

## ✨ Features

**Game review**
- ♟️ **Live review.** Ratings appear move by move over WebSocket as Stockfish finishes each position, with chess.com-style animations while the engine works.
- 🎯 **chess.com-style ratings.** Brilliant, Great, Best, Excellent, Good, Book, Inaccuracy, Mistake, Miss, Blunder and Forced, based on win-probability loss, MultiPV "only move" detection and sacrifice detection.
- 🧠 **"Why was this bad?"** For every error the coach explains it ("This allows Qxg2, and Black wins a pawn and gets a strong attack"), shows the best move with its engine line and your opponent's best reply, and can play the best move on the board.
- 🔁 **Retry mode.** Try to find the better move yourself on the board (drag, or tap-tap on phones).
- ⏭️ **Next mistake.** Jump straight to your next inaccuracy, mistake or blunder.
- 📖 **Opening names.** Book moves come from a local opening book of 3,800+ named lines (Lichess's chess-openings dataset).
- 📊 **Accuracy and estimated rating** per player, plus a clickable win-probability graph.

**Sharing and import**
- 🔗 **Shareable review links** (`/review/<id>`). Anyone can open a finished review.
- 📥 **Import from Chess.com** (search by username) or **Lichess** (paste a game link).
- 💾 **Download the annotated PGN**, with `!!`, `?`, `??` symbols, `[%eval]` tags and "Best was…" comments.
- 🔊 **Move sounds** (real CC0 recordings: move, capture, check, castle, promotion), and a **mobile-first layout**.

**Built for a public deployment**
- ♻️ **No double work.** The same game submitted twice returns the saved review instantly, without running Stockfish again.
- 🚦 **Rate limiting** per visitor (salted IP hash, no raw IPs stored) and a move-count cap.
- 🧾 **Queue position and ETA** ("You're #3 in line · about 2 min").
- 🛟 **Self-healing.** A watchdog re-queues games whose worker crashed or hung, and gives up cleanly after 3 tries.
- 😴 **Server-asleep mode.** The frontend explains when the backend is switched off instead of showing errors.

---

## 🏗️ Architecture

No service calls another directly. The gateway and the worker communicate only through **Apache Kafka**.

```
 Browser (React)
   │  REST: submit PGN, game status      ▲  STOMP over WebSocket: live moves
   ▼                                     │
┌──────────────────────────────────────────────┐        ┌──────────────┐
│   API gateway — FastAPI (Python)              │◄──────►│ PostgreSQL   │
│   • validates PGN, de-duplicates, rate limits │        │ games, moves │
│   • queue position / ETA, share links         │        └──────────────┘
│   • watchdog re-queues stalled games          │
└───────┬───────────────────────────▲──────────┘
        │ games-to-analyze          │ analyzed-moves
        ▼                           │
┌──────────────────────────────────────────────┐
│                 Apache Kafka                  │
└───────┬───────────────────────────▲──────────┘
        ▼                           │
┌──────────────────────────────────────────────┐
│   AI worker — Python + Stockfish               │
│   • local opening book → book moves + names    │
│   • Stockfish MultiPV 2 per position           │
│   • N games in parallel; pauses Kafka when     │
│     full so waiting games stay in the queue    │
└──────────────────────────────────────────────┘
```

**Why Kafka?** Stockfish needs a minute or more per game. The gateway answers instantly and puts
the game on a queue. Workers pull games at their own pace, a burst of submissions just waits in
line, and more workers can be added without changing the gateway. Messages are keyed by `gameId`,
so a game's moves always arrive in order.

**Why PostgreSQL?** Every analysed move is stored, so reviews survive refreshes and restarts,
shared links open instantly, and repeated games are never analysed twice.

### Data flow
1. The browser posts the PGN to `POST /api/analysis/submit`. The gateway validates it, returns the
   existing `gameId` if the same game was already reviewed, otherwise stores a `games` row and
   publishes `{gameId, pgn}` to **`games-to-analyze`**.
2. The worker evaluates every position with Stockfish (MultiPV 2) and publishes one message per
   move to **`analyzed-moves`**: eval, best move, the engine's line, the second-best eval, and the
   opening name.
3. The gateway stores each move (ignoring duplicates from retries), advances the game's status,
   and pushes it to subscribed browsers over STOMP (`/topic/moves/{gameId}`).
4. The browser classifies and explains each move as it arrives.

---

## 🛠️ Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 8, `react-chessboard`, `chess.js`, Recharts, `@stomp/stompjs` |
| API gateway | Python 3.12, FastAPI, SQLAlchemy, `python-chess`, `confluent-kafka` |
| AI worker | Python, `python-chess`, Stockfish (UCI), `confluent-kafka` |
| Messaging | Apache Kafka (KRaft) |
| Database | PostgreSQL 16 |
| Delivery | Docker Compose, Caddy (automatic HTTPS), GitHub Actions CI |

> The first version of the gateway was written in **Spring Boot (Java 17)**. It's kept in
> [`archive/spring-boot-gateway`](archive/spring-boot-gateway) for reference.

---

## 🚀 Run it locally

**Needs:** Docker Desktop, Python 3.12+, Node 20+, and Stockfish in `ai-worker/engine/`
(`stockfish.exe` on Windows, `stockfish-linux` on Linux, via Git LFS or
[stockfishchess.org](https://stockfishchess.org/download/)).

### One command (Windows)
```powershell
.\start-dev.ps1 -Local
```
This starts PostgreSQL and Kafka in Docker, then opens three windows (API, worker, website) and
your browser at **http://localhost:5173**. Run `.\start-dev.ps1` without `-Local` to use cloud
Kafka/Postgres from `FastApi-Backend/.env` instead.

### Manually
```bash
docker compose up -d                                   # PostgreSQL :5432 + Kafka :9092

# API gateway
cd FastApi-Backend
python -m venv .venv && . .venv/bin/activate           # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
DATABASE_URL=postgresql+psycopg2://chess_user:password123@localhost:5432/chess_data \
KAFKA_URL=localhost:9092 KAFKA_SECURITY_PROTOCOL=PLAINTEXT \
uvicorn main:app --port 8080

# AI worker (new terminal)
cd ai-worker && pip install -r requirements.txt
KAFKA_URL=localhost:9092 KAFKA_SECURITY_PROTOCOL=PLAINTEXT python main.py

# Frontend (new terminal)
cd frontend && npm install && npm run dev               # proxies /api and /ws to :8080
```

### Tests
```bash
cd frontend && npm test                                  # classification, explanations, PGN export
cd FastApi-Backend && pip install -r requirements-dev.txt && pytest -q   # dedupe, rate limit, queue, watchdog
cd ai-worker && pip install -r requirements-dev.txt && pytest -q         # opening book, engine output
```
All three run on every push via GitHub Actions.

---

## ⚙️ Configuration

Gateway and worker settings come from environment variables (see
[`FastApi-Backend/.env.example`](FastApi-Backend/.env.example)):

| Variable | Default | What it does |
|---|---|---|
| `DATABASE_URL` | local Postgres | SQLAlchemy URL |
| `KAFKA_URL`, `KAFKA_SECURITY_PROTOCOL` | `localhost:9092`, `PLAINTEXT` | Kafka (`SSL` + certs in `certs/` for managed Kafka) |
| `CORS_ORIGINS` | `*` | Allowed frontend origins, e.g. your Vercel URL |
| `ENGINE_DEPTH` | 18 | Stockfish depth (lower = faster) |
| `MAX_PARALLEL_GAMES` | 2 | Games analysed at once (worker) and queue maths (gateway) |
| `RATE_LIMIT_GAMES` / `RATE_LIMIT_WINDOW_MIN` | 5 / 10 | New games per visitor per window |
| `MAX_PLIES` | 300 | Longest game accepted (half-moves) |
| `STALL_SECONDS`, `MAX_ATTEMPTS` | 240, 3 | Watchdog: retry after this much silence, give up after N tries |
| `ADMIN_TOKEN` | unset | Enables `DELETE /api/analysis/clear` with `X-Admin-Token` |

Frontend: `VITE_API_URL` (and optionally `VITE_WS_URL`) point the site at a backend on another
domain. Not needed when both are served from the same origin.

---

## ☁️ Deployment

Step-by-step guide: **[DEPLOY.md](DEPLOY.md)**.

- **Backend (one Azure VM):** [`docker-compose.prod.yml`](docker-compose.prod.yml) runs Caddy
  (automatic HTTPS), the gateway, the worker, PostgreSQL and Kafka, with memory limits sized for
  a 4 GB B2s VM. Settings live in `deploy/.env` (template: [`deploy/.env.example`](deploy/.env.example)).
- **Website (Vercel):** root directory `frontend`, env `VITE_API_URL=https://<api-domain>`.
  `vercel.json` routes `/review/*` share links.
- Stopping the VM when it isn't needed is fine. Everything restarts automatically, and the
  website shows a friendly "server is asleep" message meanwhile.

---

## 📁 Project structure

```
chess-reviewer/
├── frontend/                 # React app
│   └── src/
│       ├── components/       # board, coach panel, move list, summary, game browser…
│       ├── hooks/            # live analysis stream, server health, game status
│       └── lib/              # classification, explanations, PGN export, sounds, share links
├── FastApi-Backend/          # API gateway: REST + STOMP WebSocket + Kafka + watchdog
│   ├── main.py  games.py  kafka_manager.py  models.py  websocket_manager.py
│   └── tests/
├── ai-worker/                # Stockfish worker
│   ├── main.py  opening_book.py
│   ├── openings/             # Lichess chess-openings TSVs (CC0)
│   └── tests/
├── archive/spring-boot-gateway/   # original Java gateway (reference only)
├── docker-compose.yaml       # local Postgres + Kafka
├── docker-compose.prod.yml   # production stack (Caddy + gateway + worker)
└── start-dev.ps1             # one-command local start (Windows)
```

---

## 🎬 Adding a demo video

1. On GitHub, open **Issues → New issue** and drag your `.mp4`/`.gif` into the text box.
2. Copy the `https://github.com/user-attachments/assets/…` URL it creates (no need to submit the issue).
3. Paste it into the **Demo** section above. GitHub renders it as an inline player.

To make a GIF: `ffmpeg -i demo.mp4 -vf "fps=12,scale=800:-1" -loop 0 demo.gif` (keep it under 10 MB).

---

## 📝 License

MIT. Opening data: [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) (CC0).

<div align="center"><sub>Built by <strong>Muhammad Yahya Siddiqui</strong></sub></div>
