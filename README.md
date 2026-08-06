

# ♟️ AI Chess Reviewer

An intelligent, real-time chess analysis platform that evaluates your games move-by-move. Built with a modern microservices architecture, it leverages **Stockfish 16**, **Apache Kafka**, and **Spring Boot** to deliver blazing-fast insights, win probability charts, and move classifications (Blunder, Mistake, Brilliant, etc.).

---

## ✨ Features
- **Real-Time Analysis**: Stream moves via STOMP WebSockets for instant feedback as the AI processes your game.
- **Chess.com Integration**: Automatically fetch your recent games from Chess.com.
- **Move Classification**: Categorizes moves using Win Probability Drop (WPD) formulas to highlight Blunders, Inaccuracies, and Brilliant moves.
- **Lichess Opening Explorer**: Connects to the Lichess Masters database to recognize opening theory ("Book" moves) instantly without wasting engine resources.
- **Interactive UI**: A stunning, responsive UI built with React, Vite, and Recharts, featuring dynamic win-probability graphs and interactive chessboard scanning.

## 🏗️ Architecture
The application is split into three main components communicating via a message broker:
1. **Frontend (React / Vite)**: Connects to the backend via REST (for submitting games) and WebSockets (for receiving real-time move analysis).
2. **Backend API (Spring Boot)**: Exposes REST endpoints and WebSocket channels. Acts as a bridge, publishing raw games to Kafka and consuming analyzed moves back to stream to the frontend.
3. **AI Worker (Python)**: A high-performance worker that listens to Kafka, evaluates PGNs using **Stockfish**, and publishes the move-by-move evaluation back to Kafka.

## 🛠️ Tech Stack
- **Frontend**: React, Vite, TailwindCSS (for custom utility classes), Recharts, `chess.js`, `react-chessboard`, StompJS.
- **Backend API**: Java 17, Spring Boot, Spring WebSockets, Spring Kafka.
- **AI Worker**: Python 3, Stockfish 16, `python-kafka`, `chess` (python-chess).
- **Infrastructure**: Aiven for Apache Kafka, Aiven for PostgreSQL (managed cloud services).

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- Java 17+
- Python 3.9+
- Apache Kafka & PostgreSQL (Local or Cloud like Aiven)
- Stockfish executable (placed in `ai-worker/engine/`)

### 1. Environment Configuration
You need to set up the environment variables for local or cloud deployments.

**AI Worker (`ai-worker/.env` or system env vars):**
```bash
KAFKA_URL=your-kafka-broker-url:port
KAFKA_SECURITY_PROTOCOL=SSL (or PLAINTEXT for local)
```
*(Note: If using SSL, ensure `ca.pem`, `service.cert`, and `service.key` are placed in the `certs` folder).*

**Frontend (`frontend/.env`):**
```bash
VITE_API_URL=http://localhost:8080
VITE_WS_URL=ws://localhost:8080/ws
```

### 2. Running Locally
**Terminal 1: Spring Boot Backend**
```bash
cd api/chess-review-api
./mvnw spring-boot:run
```

**Terminal 2: AI Worker**
Ensure you have downloaded Stockfish (Windows `.exe` or Linux binary) into `ai-worker/engine/`.
```bash
cd ai-worker
pip install -r requirements.txt
python main.py
```

**Terminal 3: React Frontend**
```bash
cd frontend
npm install
npm run dev
```

---

## ☁️ Cloud Deployment (Render / Heroku)
The codebase is structured to be cloud-native:
1. The AI Worker automatically detects the OS. If it runs on Linux, it grants execution permissions to `stockfish-linux` and executes it.
2. The frontend uses `import.meta.env` to dynamically adjust REST and WebSocket endpoints depending on the environment.
3. The Spring Boot backend connects securely to managed Aiven Kafka and PostgreSQL instances via injected environment variables.

---

## 🤝 Contributing
Contributions are welcome! Feel free to open an issue or submit a pull request if you want to add new features like game exporting, advanced engine settings, or Twitch integration.

## 📝 License
This project is licensed under the MIT License.
