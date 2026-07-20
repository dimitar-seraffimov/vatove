from __future__ import annotations

import logging
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from geoalchemy2.elements import WKTElement
from sqlalchemy import create_engine, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from vatove_worker.models import Activity, IngestionFailure, SyncRun
from vatove_worker.schemas import IngestionEventV1, NormalizedActivity

logger = logging.getLogger(__name__)


class SyncRunNotFoundError(RuntimeError):
    pass


def create_database_engine(database_url: str) -> Engine:
    return create_engine(database_url, pool_pre_ping=True)


class Repository:
    def __init__(self, engine: Engine) -> None:
        self._session_factory = sessionmaker(engine, expire_on_commit=False)

    @contextmanager
    def _session(self) -> Iterator[Session]:
        with self._session_factory.begin() as session:
            yield session

    def start_sync(self, sync_run_id: UUID) -> bool:
        """Mark a sync running and reset attempt-local counts.

        Returns False when this exact run already completed, which makes redelivery a no-op.
        """

        with self._session() as session:
            sync_run = session.execute(
                select(SyncRun).where(SyncRun.id == sync_run_id).with_for_update()
            ).scalar_one_or_none()
            if sync_run is None:
                raise SyncRunNotFoundError(f"sync run {sync_run_id} does not exist")
            if sync_run.status == "completed":
                return False
            sync_run.status = "running"
            sync_run.discovered_count = 0
            sync_run.processed_count = 0
            sync_run.failed_count = 0
            sync_run.error = None
            sync_run.started_at = sync_run.started_at or datetime.now(UTC)
            sync_run.completed_at = None
            return True

    def set_discovered_count(self, sync_run_id: UUID, count: int) -> None:
        with self._session() as session:
            self._require_updated(
                session.execute(
                    update(SyncRun)
                    .where(SyncRun.id == sync_run_id)
                    .values(discovered_count=count)
                ).rowcount,
                sync_run_id,
            )

    def increment_processed(self, sync_run_id: UUID) -> None:
        with self._session() as session:
            self._require_updated(
                session.execute(
                    update(SyncRun)
                    .where(SyncRun.id == sync_run_id)
                    .values(processed_count=SyncRun.processed_count + 1)
                ).rowcount,
                sync_run_id,
            )

    def complete_sync(self, sync_run_id: UUID) -> None:
        with self._session() as session:
            self._require_updated(
                session.execute(
                    update(SyncRun)
                    .where(SyncRun.id == sync_run_id)
                    .values(
                        status="completed",
                        error=None,
                        completed_at=datetime.now(UTC),
                    )
                ).rowcount,
                sync_run_id,
            )

    def fail_sync(self, sync_run_id: UUID, error: str) -> None:
        with self._session() as session:
            result = session.execute(
                update(SyncRun)
                .where(SyncRun.id == sync_run_id)
                .values(
                    status="failed",
                    failed_count=func.greatest(SyncRun.failed_count, 1),
                    error=_sanitize_error(error),
                    completed_at=datetime.now(UTC),
                )
            )
            if not result.rowcount:
                logger.error("Cannot mark unknown sync run %s failed", sync_run_id)

    def upsert_activity(self, activity: NormalizedActivity) -> UUID:
        activity_id = uuid4()
        samples = [sample.model_dump(by_alias=True, mode="json") for sample in activity.samples]
        heart_rate_zones = [
            zone.model_dump(by_alias=True, mode="json") for zone in activity.heart_rate_zones
        ]
        route = _route_element(activity.route_coordinates)
        values = {
            "id": activity_id,
            "source": activity.source,
            "source_activity_id": activity.source_activity_id,
            "name": activity.name,
            "sport": activity.sport,
            "start_at": activity.start_at,
            "moving_time_seconds": activity.moving_time_seconds,
            "distance_meters": activity.distance_meters,
            "average_heart_rate_bpm": activity.average_heart_rate_bpm,
            "max_heart_rate_bpm": activity.max_heart_rate_bpm,
            "route": route,
            "samples": samples,
            "heart_rate_zones": heart_rate_zones,
            "raw_metadata": activity.raw_metadata,
            "source_updated_at": activity.source_updated_at,
            "updated_at": datetime.now(UTC),
        }
        statement = insert(Activity).values(**values)
        statement = statement.on_conflict_do_update(
            constraint="uq_activities_source_external",
            set_={
                key: value
                for key, value in values.items()
                if key not in {"id", "source", "source_activity_id"}
            },
        ).returning(Activity.id)
        with self._session() as session:
            return session.execute(statement).scalar_one()

    def record_failure(
        self,
        *,
        event: IngestionEventV1 | None,
        error: str,
        source_activity_id: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> None:
        safe_payload = (
            event.model_dump(by_alias=True, mode="json") if event is not None else payload or {}
        )
        failure = IngestionFailure(
            sync_run_id=event.sync_run_id if event is not None else None,
            event_id=event.event_id if event is not None else None,
            source_activity_id=source_activity_id,
            error=_sanitize_error(error),
            payload=safe_payload,
        )
        with self._session() as session:
            session.add(failure)

    @staticmethod
    def _require_updated(rowcount: int, sync_run_id: UUID) -> None:
        if not rowcount:
            raise SyncRunNotFoundError(f"sync run {sync_run_id} does not exist")


def _route_element(coordinates: list[tuple[float, float]]) -> WKTElement | None:
    if len(coordinates) < 2:
        return None
    point_text = ", ".join(f"{longitude:.7f} {latitude:.7f}" for longitude, latitude in coordinates)
    return WKTElement(f"LINESTRING({point_text})", srid=4326)


def _sanitize_error(error: str) -> str:
    # Third-party response bodies and API keys are never included in raised client errors. The
    # bound keeps status responses and the audit table useful without unbounded payload growth.
    return " ".join(error.split())[:1000]
