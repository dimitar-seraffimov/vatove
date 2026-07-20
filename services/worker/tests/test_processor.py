from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID

from vatove_worker.intervals import FetchedActivity, parse_map_payload
from vatove_worker.processor import SyncProcessor, _merge_activity_analysis
from vatove_worker.schemas import (
    IngestionEventV1,
    IntervalsActivity,
    IntervalsSportSettings,
    IntervalsStream,
)


class RecordingRepository:
    def __init__(self, should_start: bool = True) -> None:
        self.should_start = should_start
        self.discovered: int | None = None
        self.activities: list[Any] = []
        self.processed = 0
        self.completed = False

    def start_sync(self, _: UUID) -> bool:
        return self.should_start

    def set_discovered_count(self, _: UUID, count: int) -> None:
        self.discovered = count

    def upsert_activity(self, activity: Any) -> UUID:
        self.activities.append(activity)
        return UUID("11111111-1111-1111-1111-111111111111")

    def increment_processed(self, _: UUID) -> None:
        self.processed += 1

    def complete_sync(self, _: UUID) -> None:
        self.completed = True


class FixtureSource:
    def __init__(self) -> None:
        self.sport_settings_calls = 0
        self.summary = IntervalsActivity(
            id="i1",
            name="Run",
            type="Run",
            start_at=datetime(2026, 7, 20, tzinfo=UTC),
            moving_time=60,
            distance=100,
            average_heartrate=140,
            max_heartrate=175,
            icu_hr_zone_times=[10, 20, 30],
        )

    def fetch_sport_settings(self) -> list[IntervalsSportSettings]:
        self.sport_settings_calls += 1
        return [
            IntervalsSportSettings(
                types=["Run"],
                hr_zones=[120, 150, 180],
                hr_zone_names=["Easy", "Steady", "Hard"],
            )
        ]

    def list_activities(self, oldest: date, newest: date) -> list[IntervalsActivity]:
        assert oldest <= newest
        return [self.summary]

    def fetch_activity(self, activity_id: str) -> FetchedActivity:
        assert activity_id == "i1"
        return FetchedActivity(
            self.summary,
            {
                "id": "i1",
                "name": "Run",
                "type": "Run",
                "start_date": "2026-07-20T00:00:00Z",
            },
            parse_map_payload(
                [
                    {"index": 0, "lat": 51.0, "lon": -0.1},
                    {"index": 1, "lat": 51.1, "lon": -0.2},
                ]
            ),
            [
                IntervalsStream(type="time", data=[0, 60]),
                IntervalsStream(type="distance", data=[0, 100]),
            ],
        )


def make_event() -> IngestionEventV1:
    return IngestionEventV1.model_validate(
        {
            "schemaVersion": 1,
            "eventId": "0f94b064-8273-4a7f-8282-0f169f89d77b",
            "type": "activity.sync.requested",
            "source": "intervals",
            "syncRunId": "ed70ab4a-f81f-446e-9b90-4e9943cfbded",
            "requestedAt": "2026-07-20T10:00:00Z",
            "range": {"oldest": "2026-07-01", "newest": "2026-07-20"},
        }
    )


def test_processor_updates_counts_and_completes() -> None:
    repository = RecordingRepository()
    source = FixtureSource()
    processor = SyncProcessor(repository, source)  # type: ignore[arg-type]
    processor.process(make_event())
    assert repository.discovered == 1
    assert repository.processed == 1
    assert repository.completed is True
    assert repository.activities[0].source_activity_id == "i1"
    assert repository.activities[0].average_heart_rate_bpm == 140
    assert repository.activities[0].max_heart_rate_bpm == 175
    assert [zone.label for zone in repository.activities[0].heart_rate_zones] == [
        "Easy",
        "Steady",
        "Hard",
    ]
    assert [zone.duration_seconds for zone in repository.activities[0].heart_rate_zones] == [
        10,
        20,
        30,
    ]
    assert source.sport_settings_calls == 1


def test_completed_redelivery_is_noop() -> None:
    repository = RecordingRepository(should_start=False)
    source = FixtureSource()
    processor = SyncProcessor(repository, source)  # type: ignore[arg-type]
    processor.process(make_event())
    assert repository.discovered is None
    assert repository.activities == []
    assert source.sport_settings_calls == 0


def test_missing_projected_analysis_preserves_activity_detail_values() -> None:
    source = FixtureSource()
    fetched = source.fetch_activity("i1")
    fetched = FetchedActivity(
        fetched.activity.model_copy(
            update={
                "average_heartrate": 141,
                "max_heartrate": 176,
                "icu_hr_zone_times": [11, 22, 33],
            }
        ),
        fetched.raw_activity,
        fetched.map_points,
        fetched.streams,
    )
    summary_without_analysis = source.summary.model_copy(
        update={
            "average_heartrate": None,
            "max_heartrate": None,
            "icu_hr_zone_times": None,
        }
    )

    merged = _merge_activity_analysis(fetched, summary_without_analysis)

    assert merged.activity.average_heartrate == 141
    assert merged.activity.max_heartrate == 176
    assert merged.activity.icu_hr_zone_times == [11, 22, 33]
