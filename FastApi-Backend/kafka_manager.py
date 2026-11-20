"""
kafka_manager.py
----------------
Everything Kafka-related lives here:
  • build_kafka_config()    — builds the correct confluent-kafka config dict
  • get_producer()          — thread-safe singleton Kafka producer
  • start_consumer_thread() — background thread that writes DB rows and
                              pushes WebSocket broadcasts

Authentication modes (auto-detected from env vars):
  ┌─────────────────────────────────────────────────────────────────┐
  │  KAFKA_SECURITY_PROTOCOL=SSL  (default when cert files exist)   │
  │    → mutual TLS  (ca.pem + service.cert + service.key)          │
  │    → matches Spring Boot's  security.protocol=SSL  config        │
  │                                                                  │
  │  KAFKA_SECURITY_PROTOCOL=PLAINTEXT  (local Docker Compose)      │
  │    → no certs, no credentials — just a bare TCP connection       │
  └─────────────────────────────────────────────────────────────────┘
"""

import json
import logging
import os
import threading
from typing import Optional

from confluent_kafka import Consumer, Producer, KafkaError
from dotenv import load_dotenv

# Load .env before reading any env vars
load_dotenv()

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Environment variables
# ---------------------------------------------------------------------------
KAFKA_URL: str = os.getenv(
    "KAFKA_URL",
    "localhost:9092",   # local Docker Compose fallback
)

# security.protocol — set to "SSL" for Aiven, leave blank for local Docker
KAFKA_SECURITY_PROTOCOL: str = os.getenv("KAFKA_SECURITY_PROTOCOL", "PLAINTEXT").upper()

# Paths to the three Aiven PEM files.
# Defaults point to the certs/ folder that lives next to this file.
_HERE = os.path.dirname(os.path.abspath(__file__))

KAFKA_CA_CERT: str = os.getenv(
    "KAFKA_CA_CERT",
    os.path.join(_HERE, "certs", "ca.pem"),
)
KAFKA_CLIENT_CERT: str = os.getenv(
    "KAFKA_CLIENT_CERT",
    os.path.join(_HERE, "certs", "service.cert"),
)
KAFKA_CLIENT_KEY: str = os.getenv(
    "KAFKA_CLIENT_KEY",
    os.path.join(_HERE, "certs", "service.key"),
)

TOPIC_SUBMIT = "games-to-analyze"
TOPIC_RESULTS = "analyzed-moves"


# ---------------------------------------------------------------------------
# Shared config builder
# ---------------------------------------------------------------------------
def build_kafka_config(extra: Optional[dict] = None) -> dict:
    """
    Return a confluent-kafka config dict that mirrors the Spring Boot setup:

    Aiven (SSL):
        security.protocol = SSL
        ssl.ca.location   = certs/ca.pem
        ssl.certificate.location = certs/service.cert
        ssl.key.location  = certs/service.key

    Local Docker (PLAINTEXT):
        security.protocol = PLAINTEXT   (no certs)
    """
    config: dict = {"bootstrap.servers": KAFKA_URL}

    if KAFKA_SECURITY_PROTOCOL == "SSL":
        config.update(
            {
                "security.protocol": "SSL",
                "ssl.ca.location": KAFKA_CA_CERT,
                "ssl.certificate.location": KAFKA_CLIENT_CERT,
                "ssl.key.location": KAFKA_CLIENT_KEY,
                # Disable hostname verification — Aiven certs use IP SANs
                "ssl.endpoint.identification.algorithm": "none",
            }
        )
        logger.debug(
            "Kafka SSL config → CA:%s  CERT:%s  KEY:%s",
            KAFKA_CA_CERT, KAFKA_CLIENT_CERT, KAFKA_CLIENT_KEY,
        )
    else:
        config["security.protocol"] = "PLAINTEXT"
        logger.debug("Kafka PLAINTEXT config (local Docker)")

    if extra:
        config.update(extra)

    return config


# ---------------------------------------------------------------------------
# Singleton producer
# ---------------------------------------------------------------------------
_producer: Optional[Producer] = None
_producer_lock = threading.Lock()


def get_producer() -> Producer:
    """Return a process-wide Kafka producer, creating it lazily (thread-safe)."""
    global _producer
    if _producer is None:
        with _producer_lock:
            if _producer is None:
                logger.info(
                    "🔌 Initialising Kafka producer → %s  [%s]",
                    KAFKA_URL,
                    KAFKA_SECURITY_PROTOCOL,
                )
                _producer = Producer(build_kafka_config())
                logger.info("✅ Kafka producer ready")
    return _producer


# ---------------------------------------------------------------------------
# Background consumer thread
# ---------------------------------------------------------------------------
def start_consumer_thread(connection_manager, SessionLocal) -> threading.Thread:
    """
    Spawn and return a daemon thread that:
      1. Reads JSON messages from the 'analyzed-moves' Kafka topic.
      2. Persists each move to PostgreSQL.
      3. Broadcasts the move to any WebSocket clients watching that gameId.

    Parameters
    ----------
    connection_manager : websocket_manager.ConnectionManager
        Injected to avoid a circular import between this module and
        websocket_manager.py.
    SessionLocal : sqlalchemy.orm.sessionmaker
        Injected to avoid importing database.py here directly.
    """

    def _run():
        # Import here so we don't create a circular dependency at module level
        from games import store_move

        cfg = build_kafka_config(
            {
                "group.id": "fastapi-gateway-group",
                "auto.offset.reset": "latest",
                "enable.auto.commit": True,
                # Heartbeat / session settings — important on free-tier brokers
                "session.timeout.ms": 30_000,
                "heartbeat.interval.ms": 10_000,
            }
        )

        consumer = Consumer(cfg)
        consumer.subscribe([TOPIC_RESULTS])
        logger.info(
            "🎧 Kafka consumer listening on topic '%s'  [%s]",
            TOPIC_RESULTS,
            KAFKA_SECURITY_PROTOCOL,
        )

        import asyncio

        try:
            while True:
                msg = consumer.poll(timeout=1.0)
                if msg is None:
                    continue
                if msg.error():
                    if msg.error().code() == KafkaError._PARTITION_EOF:
                        continue
                    logger.error("Kafka consumer error: %s", msg.error())
                    continue

                raw = msg.value().decode("utf-8")
                logger.info("📨 Message received: %s", raw[:120])

                try:
                    data: dict = json.loads(raw)
                except json.JSONDecodeError as exc:
                    logger.error("JSON decode error: %s — raw: %s", exc, raw)
                    continue

                # ── 1. Persist to PostgreSQL ──────────────────────────────
                db = SessionLocal()
                is_new = False
                try:
                    # Skips plies we already have (a retried game re-sends them)
                    # and moves the game along queued → analyzing → done.
                    is_new = store_move(db, data)
                    if is_new:
                        logger.info("💾 Saved move %s %s for game %s",
                                    data.get("moveNumber"), data.get("player"), data.get("gameId"))
                except Exception as exc:
                    db.rollback()
                    logger.error("DB write failed: %s", exc)
                finally:
                    db.close()

                # ── 2. Broadcast to WebSocket clients ─────────────────────
                game_id = data.get("gameId")
                if game_id and is_new:
                    # connection_manager.broadcast is a coroutine; schedule it
                    # safely from this sync thread via the stored event loop.
                    loop = connection_manager.loop
                    if loop and loop.is_running():
                        asyncio.run_coroutine_threadsafe(
                            connection_manager.broadcast(game_id, raw),
                            loop,
                        )

        except Exception as exc:
            logger.exception("Consumer thread crashed: %s", exc)
        finally:
            consumer.close()
            logger.info("Kafka consumer closed.")

    thread = threading.Thread(target=_run, daemon=True, name="kafka-consumer")
    thread.start()
    return thread
