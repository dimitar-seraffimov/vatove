from __future__ import annotations

import logging
from typing import Protocol

from vatove_worker.database import Repository
from vatove_worker.intervals import FetchedActivity, IntervalsClient, IntervalsPayloadError
from vatove_worker.normalize import normalize_activity
from vatove_worker.schemas import IngestionEventV1, IntervalsActivity

logger = logging.getLogger(__name__)


class IntervalsSource(Protocol):
    def list_activities(self, oldest: object, newest: object) -> list[IntervalsActivity]: ...

    def fetch_activity(self, activity_id: str) -> FetchedActivity: ...


class SyncProcessor:
    def __init__(self, repository: Repository, intervals: IntervalsClient) -> None:
        self._repository = repository
        self._intervals = intervals

    def process(self, event: IngestionEventV1) -> None:
        if not self._repository.start_sync(event.sync_run_id):
            logger.info("Sync run %s already completed; acknowledging duplicate", event.sync_run_id)
            return

        activities = self._intervals.list_activities(event.range.oldest, event.range.newest)
        self._repository.set_discovered_count(event.sync_run_id, len(activities))
        logger.info("Sync run %s discovered %d activities", event.sync_run_id, len(activities))

        for summary in activities:
            fetched = self._intervals.fetch_activity(summary.id)
            if fetched.activity.id != summary.id:
                raise IntervalsPayloadError(
                    f"activity detail id {fetched.activity.id!r} does not match {summary.id!r}"
                )
            normalized = normalize_activity(fetched)
            self._repository.upsert_activity(normalized)
            self._repository.increment_processed(event.sync_run_id)

        self._repository.complete_sync(event.sync_run_id)
        logger.info("Sync run %s completed", event.sync_run_id)

