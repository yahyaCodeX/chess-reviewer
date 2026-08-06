

# ♟️ AI Chess Reviewer

> **An event-driven, real-time chess analysis platform** that processes your PGN games move-by-move using the Stockfish 16 engine, delivering instant evaluations, win-probability graphs, and opening theory detection — all streamed live to your browser.

---

## 🎬 Demo

> 📌 **Paste your GitHub-uploaded video URL below this line and delete this line**

https://github.com/user-attachments/assets/YOUR-VIDEO-URL-HERE

---

## 📑 Table of Contents

- [System Architecture](#-system-architecture)
- [Tech Stack](#-tech-stack)
- [Features](#-features)
- [Local Setup](#-local-setup)
- [Cloud & SSL Setup (Aiven)](#-cloud--ssl-setup-aiven)
- [Project Structure](#-project-structure)

---

## 🏗️ System Architecture

This application is built around an **event-driven microservices architecture**. No service talks directly to another — they all communicate through **Apache Kafka** as the central message bus.

```
User Browser
    │
    │  REST (submit PGN)          WebSocket / STOMP (stream results)
    ▼                                          ▲
┌─────────────────────────────────────────────┐
│          Spring Boot API  (Java 17)          │
│  • REST Controller  • WebSocket Broker       │
│  • Kafka Producer   • Kafka Consumer         │
└────────────┬────────────────────────────────┘
             │  Kafka Topic: games-to-analyze
             ▼
┌────────────────────────────────────────────────┐
│       Apache Kafka  (Aiven Cloud / Docker)      │
└────────────┬───────────────────────────────────┘
             │  Kafka Topic: analyzed-moves
             ▼
┌────────────────────────────────────────────────┐
│           Python AI Worker                      │
│  • Consumes PGN from Kafka                     │
│  • Queries Lichess Masters Opening Explorer    │
│  • Runs Stockfish 16 (depth 18) via UCI        │
│  • Publishes move evaluations back to Kafka    │
└────────────────────────────────────────────────┘
             │  Persistence
             ▼
┌─────────────────────┐
│   PostgreSQL (JPA)  │
└─────────────────────┘
```

### 🔄 End-to-End Data Flow

1. **User submits a PGN** via the React UI (REST `POST /api/games`).
2. **Spring Boot** persists the game to **PostgreSQL** and publishes a `{gameId, pgn}` JSON message to the **`games-to-analyze`** Kafka topic.
3. **The Python AI Worker** consumes the message. For the first 30 plies (15 full moves), it queries the **Lichess Masters Opening Explorer** to detect book moves. Beyond that, it runs **Stockfish 16 at depth 18** via the UCI protocol.
4. For every move, the worker publishes a structured JSON payload `{gameId, moveNumber, player, moveSan, evaluation}` to the **`analyzed-moves`** Kafka topic.
5. **Spring Boot** consumes `analyzed-moves` and immediately **pushes each move evaluation** to the connected React client over a **STOMP WebSocket** (`/topic/game/{gameId}`).
6. The **React frontend** renders evaluations in real-time — updating the win-probability graph and move classification (Blunder, Mistake, Good, Brilliant) as each result arrives.

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend** | React 19, Vite 8, TailwindCSS 4 | UI framework & build tool |
| **Chessboard** | `react-chessboard`, `chess.js` | Interactive board & PGN logic |
| **Charts** | Recharts | Real-time win-probability graph |
| **WebSocket Client** | `@stomp/stompjs`, `sockjs-client` | Receiving live move evaluations |
| **Backend API** | Java 17, Spring Boot 3.3 | REST API & WebSocket broker |
| **ORM** | Spring Data JPA, Hibernate | PostgreSQL persistence |
| **Event Streaming** | Apache Kafka (Aiven Cloud) | Decoupled async message bus |
| **AI Worker** | Python 3, `python-chess`, `confluent-kafka` | Engine orchestration |
| **Chess Engine** | Stockfish 16 (UCI) | Move evaluation at depth 18 |
| **Opening Book** | Lichess Masters Explorer API | Detects book moves (first 15 moves) |
| **Database** | PostgreSQL 15 | Game & move storage |
| **Containerisation** | Docker, Docker Compose | Local dev environment |
| **Cloud** | Aiven for Kafka & PostgreSQL | Managed production infrastructure |

---

## ✨ Features

- ♟️ **Real-Time Move Streaming** — evaluations appear in the browser move-by-move as Stockfish finishes, via STOMP WebSocket.
- 📖 **Opening Book Detection** — first 15 moves cross-referenced against the Lichess Masters database (no wasted engine time on known theory).
- 📊 **Win Probability Graph** — interactive Recharts graph animates in real-time as analysis completes.
- 🎯 **Move Classification** — moves are categorised as Brilliant, Good, Inaccuracy, Mistake, or Blunder based on evaluation delta (WPD formula).
- ♘ **Grandmaster-Level Analysis** — Stockfish 16 runs at depth 18 for consistent, high-accuracy evaluations.
- 🔁 **Concurrent Game Processing** — the Python worker uses a `ThreadPoolExecutor` to process multiple games in parallel.
- ☁️ **Cloud-Native** — OS auto-detection switches between Windows (`stockfish.exe`) and Linux (`stockfish-linux`) binaries automatically.
- 🔒 **Secure Kafka (SSL/mTLS)** — production uses Aiven's SSL certificates (`ca.pem`, `service.cert`, `service.key`) for encrypted broker connections.
- 🐳 **Docker Compose** — one command spins up PostgreSQL 15 + Kafka (KRaft, no Zookeeper) for local development.

---

## 🚀 Local Setup

### Prerequisites

| Tool | Version |
|---|---|
| Java (JDK) | 17+ |
| Node.js | 18+ |
| Python | 3.9+ |
| Docker & Docker Compose | Latest |
| Stockfish binary | 16 (place in `ai-worker/engine/`) |

> **Download Stockfish**: https://stockfishchess.org/download/
> Place the binary as:
> - Windows → `ai-worker/engine/stockfish.exe`
> - Linux/Mac → `ai-worker/engine/stockfish-linux`

---

### Step 1 — Start Infrastructure (Kafka + PostgreSQL)

```bash
# From the project root
docker-compose up -d
```

This starts:
- **PostgreSQL 15** on `localhost:5432` (db: `chess_data`, user: `chess_user`, pass: `password123`)
- **Apache Kafka** (KRaft mode — no Zookeeper) on `localhost:9092`

---

### Step 2 — Configure the Spring Boot Backend

Edit `api/chess-review-api/src/main/resources/application.properties`:

```properties
# Database
spring.datasource.url=jdbc:postgresql://localhost:5432/chess_data
spring.datasource.username=chess_user
spring.datasource.password=password123

# Kafka
spring.kafka.bootstrap-servers=localhost:9092
```

Then run:

```bash
cd api/chess-review-api
./mvnw spring-boot:run
```

The API will start on **http://localhost:8080**.

---

### Step 3 — Configure & Run the Python AI Worker

Create `ai-worker/.env`:

```env
KAFKA_URL=localhost:9092
KAFKA_SECURITY_PROTOCOL=PLAINTEXT
```

Install dependencies and start the worker:

```bash
cd ai-worker
pip install -r requirements.txt
python main.py
```

You should see:
```
📤 Connecting Kafka Producer...
✅ Kafka Producer ready!
🎧 Worker is now listening for games. Waiting for Spring Boot to send something...
```

---

### Step 4 — Run the React Frontend

Create `frontend/.env`:

```env
VITE_API_URL=http://localhost:8080
VITE_WS_URL=ws://localhost:8080/ws
```

```bash
cd frontend
npm install
npm run dev
```

The app will be available at **http://localhost:5173**.

---

## ☁️ Cloud & SSL Setup (Aiven)

For production with **Aiven for Apache Kafka**, replace local credentials with your Aiven service URI and SSL certificates.

### Aiven Kafka Credentials

Download your Aiven SSL certs and place them at:
```
api/chess-review-api/src/main/resources/certs/
├── ca.pem
├── service.cert
└── service.key
```

### Spring Boot `application.properties` (Aiven)

```properties
spring.kafka.bootstrap-servers=your-aiven-kafka-url:port
spring.kafka.properties.security.protocol=SSL
spring.kafka.properties.ssl.truststore.location=classpath:certs/ca.pem
spring.kafka.properties.ssl.keystore.location=classpath:certs/service.cert
spring.kafka.ssl.key-password=your-key-password
```

### Python Worker `.env` (Aiven)

```env
KAFKA_URL=your-aiven-kafka-url:port
KAFKA_SECURITY_PROTOCOL=SSL
```

> The worker automatically reads the SSL cert paths relative to the project root — ensure the `certs/` folder is in place before starting.

---

## 📁 Project Structure

```
chess-reviewer/
├── api/
│   └── chess-review-api/          # Spring Boot microservice (Java 17)
│       ├── src/main/java/com/chess/chessreviewapi/
│       │   ├── config/            # Kafka & WebSocket configuration
│       │   ├── controller/        # REST controllers
│       │   ├── model/             # JPA entities
│       │   ├── repository/        # Spring Data repositories
│       │   └── service/           # Business logic & Kafka producers/consumers
│       ├── Dockerfile
│       └── pom.xml
│
├── ai-worker/                     # Python AI microservice
│   ├── engine/
│   │   ├── stockfish.exe          # Windows binary (git-ignored)
│   │   └── stockfish-linux        # Linux binary (git-ignored)
│   ├── main.py                    # Kafka consumer + Stockfish orchestrator
│   ├── requirements.txt
│   └── .env                       # Local env vars (git-ignored)
│
├── frontend/                      # React + Vite application
│   ├── src/
│   │   ├── App.jsx                # Main application component
│   │   └── index.css              # Global styles
│   ├── package.json
│   └── vite.config.js
│
└── docker-compose.yaml            # Local Kafka (KRaft) + PostgreSQL
```

---

## 🎬 How to Add Your Demo Video to GitHub

Since this project isn't hosted live, adding a demo video to this README is the **single most impactful** thing you can do for your portfolio. Here's exactly how:

### Option A — GitHub Issue Upload (Easiest ✅ Recommended)

1. Go to your repository on GitHub.
2. Click **Issues** → **New Issue**.
3. In the text box, **drag and drop your `.mp4` or `.gif` file**. GitHub will upload it and give you a URL like:
   ```
   https://github.com/user-attachments/assets/xxxxxx.mp4
   ```
4. **Copy that URL** — you don't need to submit the issue.
5. Replace the placeholder in this README with:
   ```markdown
   https://github.com/user-attachments/assets/YOUR-VIDEO-URL-HERE
   ```
   GitHub natively renders `.mp4` links as an embedded video player in the README.

### Option B — Convert to GIF + Commit

If you want an inline animated preview (no click required):
1. Convert your video to GIF using **ezgif.com** or **ffmpeg**:
   ```bash
   ffmpeg -i demo.mp4 -vf "fps=15,scale=900:-1" -loop 0 demo.gif
   ```
2. Commit the `.gif` to the repo (e.g., `assets/demo.gif`).
3. Embed it in the README:
   ```markdown
   ![Chess Reviewer Demo](./assets/demo.gif)
   ```

> **💡 Pro Tip**: Keep GIFs under 10MB for GitHub rendering. Use `scale=800:-1` and `fps=12` if it's too large.

---

## 📝 License

This project is licensed under the **MIT License**.

---

<div align="center">
  <sub>Built with ♟️ and ☕ by a Full-Stack Engineer passionate about distributed systems.</sub>
</div>
