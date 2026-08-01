"""
SQLite-backed durable queue and watermark store for ChangeDetection sync.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Iterable, Optional

import aiosqlite


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_last_changed(value: float) -> str:
    # Keep a stable event-key representation for idempotency.
    text = f"{value:.6f}".rstrip("0").rstrip(".")
    return text or "0"


@dataclass
class EnqueueResult:
    event_key: str
    queued: bool
    deduplicated: bool


class SyncDetectionStore:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._initialized = False

    async def initialize(self) -> None:
        if self._initialized:
            return

        os.makedirs(os.path.dirname(self.db_path) or ".", exist_ok=True)
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                """
                CREATE TABLE IF NOT EXISTS cd_events (
                    id INTEGER PRIMARY KEY,
                    event_key TEXT UNIQUE NOT NULL,
                    watch_uuid TEXT NOT NULL,
                    last_changed REAL NOT NULL,
                    received_at TEXT NOT NULL,
                    payload_json TEXT,
                    status TEXT NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0,
                    next_attempt_at TEXT,
                    error TEXT,
                    processed_at TEXT
                )
                """
            )
            await db.execute(
                """
                CREATE TABLE IF NOT EXISTS cd_watch_state (
                    watch_uuid TEXT PRIMARY KEY,
                    last_processed_changed REAL NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL
                )
                """
            )
            await db.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_cd_events_status_next_attempt
                ON cd_events(status, next_attempt_at)
                """
            )
            await db.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_cd_events_watch_uuid
                ON cd_events(watch_uuid)
                """
            )
            await db.commit()

        self._initialized = True

    @staticmethod
    def make_event_key(watch_uuid: str, last_changed: float) -> str:
        return f"{watch_uuid}:{_normalize_last_changed(last_changed)}"

    async def enqueue_event(
        self,
        watch_uuid: str,
        last_changed: float,
        payload: Optional[Dict[str, Any]] = None,
    ) -> EnqueueResult:
        await self.initialize()

        event_key = self.make_event_key(watch_uuid, last_changed)
        payload_json = json.dumps(payload or {}, default=str)
        now_iso = _utc_now_iso()

        try:
            async with aiosqlite.connect(self.db_path) as db:
                await db.execute(
                    """
                    INSERT INTO cd_events (
                        event_key,
                        watch_uuid,
                        last_changed,
                        received_at,
                        payload_json,
                        status,
                        attempts,
                        next_attempt_at
                    ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?)
                    """,
                    (
                        event_key,
                        watch_uuid,
                        last_changed,
                        now_iso,
                        payload_json,
                        now_iso,
                    ),
                )
                await db.commit()
            return EnqueueResult(
                event_key=event_key,
                queued=True,
                deduplicated=False,
            )
        except aiosqlite.IntegrityError:
            return EnqueueResult(
                event_key=event_key,
                queued=False,
                deduplicated=True,
            )

    async def reset_processing_events(self) -> int:
        await self.initialize()
        async with aiosqlite.connect(self.db_path) as db:
            cursor = await db.execute(
                """
                UPDATE cd_events
                SET status = 'pending', next_attempt_at = ?, error = COALESCE(error, 'worker restart')
                WHERE status = 'processing'
                """,
                (_utc_now_iso(),),
            )
            await db.commit()
            return int(cursor.rowcount or 0)

    async def claim_next_event(
        self,
        excluded_watch_uuids: Optional[Iterable[str]] = None,
    ) -> Optional[Dict[str, Any]]:
        await self.initialize()
        excluded = [uuid for uuid in (excluded_watch_uuids or []) if uuid]
        now_iso = _utc_now_iso()

        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("BEGIN IMMEDIATE")

            query = """
                SELECT id, event_key, watch_uuid, last_changed, attempts
                FROM cd_events
                WHERE status = 'pending'
                  AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
                """
            params: list[Any] = [now_iso]

            if excluded:
                placeholders = ",".join(["?"] * len(excluded))
                query += f" AND watch_uuid NOT IN ({placeholders})"
                params.extend(excluded)

            query += " ORDER BY last_changed ASC, id ASC LIMIT 1"

            cursor = await db.execute(query, params)
            row = await cursor.fetchone()
            if not row:
                await db.rollback()
                return None

            event_id = int(row[0])
            update_cursor = await db.execute(
                """
                UPDATE cd_events
                SET status = 'processing', error = NULL
                WHERE id = ? AND status = 'pending'
                """,
                (event_id,),
            )
            if int(update_cursor.rowcount or 0) != 1:
                await db.rollback()
                return None

            await db.commit()

            return {
                "id": event_id,
                "event_key": row[1],
                "watch_uuid": row[2],
                "last_changed": float(row[3] or 0.0),
                "attempts": int(row[4] or 0),
            }

    async def mark_done(self, event_id: int) -> None:
        await self.initialize()
        processed_at = _utc_now_iso()
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                """
                UPDATE cd_events
                SET status = 'done', processed_at = ?, next_attempt_at = NULL, error = NULL
                WHERE id = ?
                """,
                (processed_at, event_id),
            )
            await db.commit()

    async def mark_failed(
        self,
        event_id: int,
        error: str,
        max_retries: int,
        retry_base_seconds: int,
    ) -> Dict[str, Any]:
        await self.initialize()

        async with aiosqlite.connect(self.db_path) as db:
            cursor = await db.execute(
                "SELECT attempts FROM cd_events WHERE id = ?",
                (event_id,),
            )
            row = await cursor.fetchone()
            attempts = int((row or [0])[0]) + 1

            if attempts <= max_retries:
                backoff_seconds = max(1, retry_base_seconds) * (2 ** (attempts - 1))
                next_attempt_at = (
                    datetime.now(timezone.utc) + timedelta(seconds=backoff_seconds)
                ).isoformat()
                status = "pending"
            else:
                next_attempt_at = None
                status = "dead"

            await db.execute(
                """
                UPDATE cd_events
                SET status = ?,
                    attempts = ?,
                    next_attempt_at = ?,
                    error = ?
                WHERE id = ?
                """,
                (status, attempts, next_attempt_at, error[:2000], event_id),
            )
            await db.commit()

        return {
            "status": status,
            "attempts": attempts,
            "next_attempt_at": next_attempt_at,
        }

    async def get_watch_watermark(self, watch_uuid: str) -> float:
        await self.initialize()
        async with aiosqlite.connect(self.db_path) as db:
            cursor = await db.execute(
                """
                SELECT last_processed_changed
                FROM cd_watch_state
                WHERE watch_uuid = ?
                """,
                (watch_uuid,),
            )
            row = await cursor.fetchone()
            if not row:
                return 0.0
            return float(row[0] or 0.0)

    async def upsert_watch_watermark(
        self, watch_uuid: str, last_changed: float
    ) -> None:
        await self.initialize()
        updated_at = _utc_now_iso()
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                """
                INSERT INTO cd_watch_state (watch_uuid, last_processed_changed, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(watch_uuid)
                DO UPDATE SET
                    last_processed_changed = MAX(last_processed_changed, excluded.last_processed_changed),
                    updated_at = excluded.updated_at
                """,
                (watch_uuid, last_changed, updated_at),
            )
            await db.commit()

    async def get_event(self, event_key: str) -> Optional[Dict[str, Any]]:
        await self.initialize()
        async with aiosqlite.connect(self.db_path) as db:
            cursor = await db.execute(
                """
                SELECT id, event_key, watch_uuid, last_changed, status, attempts, error
                FROM cd_events
                WHERE event_key = ?
                """,
                (event_key,),
            )
            row = await cursor.fetchone()
            if not row:
                return None

            return {
                "id": int(row[0]),
                "event_key": row[1],
                "watch_uuid": row[2],
                "last_changed": float(row[3] or 0.0),
                "status": row[4],
                "attempts": int(row[5] or 0),
                "error": row[6] or "",
            }

    async def get_status_counts(self) -> Dict[str, int]:
        await self.initialize()
        async with aiosqlite.connect(self.db_path) as db:
            cursor = await db.execute(
                """
                SELECT status, COUNT(*)
                FROM cd_events
                GROUP BY status
                """
            )
            rows = await cursor.fetchall()

        counts = {
            "pending": 0,
            "processing": 0,
            "done": 0,
            "failed": 0,
            "dead": 0,
        }
        for status, count in rows:
            counts[status] = int(count)
        return counts


_syncdetection_store: Optional[SyncDetectionStore] = None


def get_syncdetection_store(db_path: Optional[str] = None) -> SyncDetectionStore:
    global _syncdetection_store

    target_path = db_path or os.getenv("SYNCDETECTION_DB_PATH", "/tmp/syncdetection.db")
    if _syncdetection_store is None or _syncdetection_store.db_path != target_path:
        _syncdetection_store = SyncDetectionStore(target_path)
    return _syncdetection_store


async def init_syncdetection_store(db_path: Optional[str] = None) -> SyncDetectionStore:
    store = get_syncdetection_store(db_path=db_path)
    await store.initialize()
    return store
