"""
Gateway tests — run with:  pytest -q   (from FastApi-Backend/)

Uses a throwaway SQLite database and a fake Kafka producer, so no
Postgres or Kafka is needed.
"""

import json
import os
import sys
import tempfile
from datetime import timedelta

_DB = os.path.join(tempfile.mkdtemp(), "test.db")
os.environ["DATABASE_URL"] = f"sqlite:///{_DB}"
os.environ["KAFKA_SECURITY_PROTOCOL"] = "PLAINTEXT"
os.environ["KAFKA_URL"] = "127.0.0.1:1"  # nothing listens; the consumer thread just idles
os.environ["MAX_PARALLEL_GAMES"] = "2"
os.environ.pop("ADMIN_TOKEN", None)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import games  # noqa: E402
import main  # noqa: E402
from database import SessionLocal  # noqa: E402
from models import AnalyzedMove, Game, utcnow  # noqa: E402

SCHOLAR = "1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#"


class FakeProducer:
    def __init__(self):
        self.sent = []

    def produce(self, topic, value, key=None):
        self.sent.append((topic, json.loads(value)))

    def poll(self, _):
        return 0

    def flush(self, timeout=None):
        return 0


@pytest.fixture()
def client(monkeypatch):
    producer = FakeProducer()
    monkeypatch.setattr(main, "get_producer", lambda: producer)
    with TestClient(main.app) as c:
        db = SessionLocal()
        db.query(AnalyzedMove).delete()
        db.query(Game).delete()
        db.commit()
        db.close()
        c.producer = producer
        yield c


def submit(c, pgn):
    return c.post("/api/analysis/submit", content=pgn, headers={"Content-Type": "text/plain"})


def numbered(moves):
    """'e4 e5 Nf3' → '1. e4 e5 2. Nf3' (distinct legal games for rate-limit tests)."""
    out = []
    for i, m in enumerate(moves):
        out.append(f"{i // 2 + 1}. {m}" if i % 2 == 0 else m)
    return " ".join(out)


def test_submit_queues_game(client):
    r = submit(client, SCHOLAR)
    assert r.status_code == 200
    game_id = r.text
    assert client.producer.sent == [("games-to-analyze", {"gameId": game_id, "pgn": SCHOLAR})]
    status = client.get(f"/api/analysis/games/{game_id}").json()
    assert status["status"] == "queued" and status["totalPlies"] == 7 and status["queuePosition"] == 0


def test_duplicate_game_reuses_analysis(client):
    first = submit(client, SCHOLAR).text
    again = submit(client, '[White "Someone"]\n[Black "Else"]\n\n' + SCHOLAR + " { comment } 1-0")
    assert again.status_code == 200 and again.text == first
    assert again.headers.get("x-duplicate") == "true"
    assert len(client.producer.sent) == 1  # Stockfish runs once


@pytest.mark.parametrize("pgn, fragment", [
    ("hello world", "no moves"),
    ("1. e4 e5 2. Ke3 Ke6 3. Qxh8", "illegal"),
])
def test_rejects_bad_pgn(client, pgn, fragment):
    r = submit(client, pgn)
    assert r.status_code == 400
    assert fragment in r.json()["detail"].lower()


def test_rejects_overlong_game(client, monkeypatch):
    monkeypatch.setattr(games, "MAX_PLIES", 4)
    r = submit(client, SCHOLAR)
    assert r.status_code == 400 and "too long" in r.json()["detail"]


def test_rate_limit(client, monkeypatch):
    monkeypatch.setattr(games, "RATE_LIMIT_GAMES", 3)
    openings = [["e4"], ["d4"], ["c4"], ["Nf3"]]
    codes = [submit(client, numbered(m)).status_code for m in openings]
    assert codes == [200, 200, 200, 429]
    # A duplicate of an existing game is still allowed (it costs nothing)
    assert submit(client, numbered(["e4"])).status_code == 200


def test_queue_position(client):
    ids = [submit(client, numbered(m)).text for m in (["e4"], ["d4"], ["c4"], ["g3"])]
    positions = [client.get(f"/api/analysis/games/{i}").json()["queuePosition"] for i in ids]
    assert positions == [0, 0, 1, 2]  # two worker slots


def _move(game_id, n, player, san):
    return {"gameId": game_id, "moveNumber": n, "player": player, "moveSan": san,
            "evaluation": "+0.30", "bestMove": "e2e4", "bestLine": "e2e4 e7e5"}


def test_moves_advance_status_and_ignore_duplicates(client):
    game_id = submit(client, "1. e4 e5").text
    db = SessionLocal()
    try:
        assert games.store_move(db, _move(game_id, 1, "White", "e4")) is True
        assert db.get(Game, game_id).status == "analyzing"
        assert games.store_move(db, _move(game_id, 1, "White", "e4")) is False  # retry re-send
        assert games.store_move(db, _move(game_id, 1, "Black", "e5")) is True
        db.expire_all()
        assert db.get(Game, game_id).status == "done"
    finally:
        db.close()
    moves = client.get(f"/api/analysis/moves?gameId={game_id}").json()
    assert [m["moveSan"] for m in moves] == ["e4", "e5"]
    assert moves[0]["bestLine"] == "e2e4 e7e5"


def test_watchdog_requeues_then_fails(client):
    game_id = submit(client, SCHOLAR).text
    db = SessionLocal()
    try:
        def age():
            g = db.get(Game, game_id)
            g.updatedAt = utcnow() - timedelta(seconds=games.STALL_SECONDS + 5)
            db.commit()

        age()
        assert games.requeue_stalled(db, main.get_producer, "games-to-analyze") == 1
        assert db.get(Game, game_id).attempts == 2
        assert len(client.producer.sent) == 2
        # Fresh activity → left alone
        assert games.requeue_stalled(db, main.get_producer, "games-to-analyze") == 0

        for _ in range(games.MAX_ATTEMPTS):
            age()
            games.requeue_stalled(db, main.get_producer, "games-to-analyze")
        assert db.get(Game, game_id).status == "failed"
    finally:
        db.close()
    # A failed game can be submitted again as a fresh job
    assert submit(client, SCHOLAR).text != game_id


def test_unknown_game_404(client):
    assert client.get("/api/analysis/games/nope").status_code == 404


def test_clear_requires_admin_token(client):
    assert client.delete("/api/analysis/clear").status_code == 403
