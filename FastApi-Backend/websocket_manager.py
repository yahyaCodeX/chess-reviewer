"""
websocket_manager.py
--------------------
Manages active WebSocket connections, grouped by gameId so that
moves for one game never bleed into another client's session.

Each registration remembers the STOMP subscription id the client chose,
because @stomp/stompjs routes incoming MESSAGE frames to the right
callback using the `subscription` header — frames without it are dropped.
"""

import asyncio
import itertools
import logging
from collections import defaultdict
from typing import Dict, List, Optional

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """
    Registry of active WebSocket subscriptions.

    Layout of _connections:
        { "game-uuid-1": { ws_client_A: "sub-0", ws_client_B: "sub-3" }, ... }

    The `loop` attribute is populated by main.py on startup so the
    Kafka consumer thread can schedule coroutines on it.
    """

    def __init__(self):
        self._connections: Dict[str, Dict[WebSocket, str]] = defaultdict(dict)
        self._lock = asyncio.Lock()
        self._message_ids = itertools.count(1)
        self.loop: Optional[asyncio.AbstractEventLoop] = None

    # ------------------------------------------------------------------
    # Lifecycle helpers
    # ------------------------------------------------------------------

    async def connect(self, game_id: str, websocket: WebSocket, subscription_id: str = "sub-0") -> None:
        """Register an (already accepted) WebSocket for a game's topic."""
        async with self._lock:
            self._connections[game_id][websocket] = subscription_id
        logger.info("🔗 WS subscribed  game_id=%s  total=%d", game_id, self._count())

    async def disconnect(self, game_id: str, websocket: WebSocket) -> None:
        """Remove a WebSocket from the registry (called on close / error)."""
        async with self._lock:
            sockets = self._connections.get(game_id)
            if sockets is not None:
                sockets.pop(websocket, None)
                if not sockets:
                    self._connections.pop(game_id, None)
        logger.info("🔌 WS unsubscribed  game_id=%s  remaining=%d", game_id, self._count())

    # ------------------------------------------------------------------
    # Broadcast
    # ------------------------------------------------------------------

    async def broadcast(self, game_id: str, message: str) -> None:
        """
        Send a STOMP MESSAGE frame to every client watching a specific gameId.
        Dead connections are silently removed.
        """
        async with self._lock:
            targets = list(self._connections.get(game_id, {}).items())

        dead: List[WebSocket] = []
        for ws, sub_id in targets:
            frame = (
                "MESSAGE\n"
                f"destination:/topic/moves/{game_id}\n"
                f"subscription:{sub_id}\n"
                f"message-id:{next(self._message_ids)}\n"
                "content-type:application/json\n"
                "\n"
                f"{message}\x00"
            )
            try:
                await ws.send_text(frame)
            except Exception as exc:
                logger.warning("WS send failed (game=%s): %s", game_id, exc)
                dead.append(ws)

        for ws in dead:
            await self.disconnect(game_id, ws)

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _count(self) -> int:
        return sum(len(v) for v in self._connections.values())

    def active_games(self) -> List[str]:
        """Return a list of gameIds that currently have live connections."""
        return list(self._connections.keys())


# Singleton — imported directly into main.py and kafka_manager.py
manager = ConnectionManager()
