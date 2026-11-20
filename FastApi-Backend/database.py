"""
database.py
-----------
SQLAlchemy engine, session factory, and base declarative class.
All other modules import from here — never from each other — to
avoid circular imports.
"""

import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# Load .env before reading any env vars
load_dotenv()

# ---------------------------------------------------------------------------
# Connection URL
# ---------------------------------------------------------------------------
# Production  → set DATABASE_URL in your Render / Railway / Fly.io env vars.
# Local dev   → spin up the postgres service from docker-compose.yaml and
#               the fallback below will connect automatically.
DATABASE_URL: str = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg2://chess_user:password123@localhost:5432/chess_data",
)

# ---------------------------------------------------------------------------
# Engine & Session
# ---------------------------------------------------------------------------
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,   # heartbeat — reconnects if the DB dropped the conn
    pool_size=5,
    max_overflow=10,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# ---------------------------------------------------------------------------
# Declarative base shared by all ORM models
# ---------------------------------------------------------------------------
Base = declarative_base()


# ---------------------------------------------------------------------------
# Dependency helper — used with FastAPI's Depends()
# ---------------------------------------------------------------------------
def get_db():
    """Yield a database session and guarantee it is closed afterwards."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
