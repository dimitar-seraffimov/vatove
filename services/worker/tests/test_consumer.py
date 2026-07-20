from __future__ import annotations

import json
import logging
from typing import Any
from uuid import UUID

from sqlalchemy.exc import ProgrammingError

from vatove_worker.consumer import IngestionWorker, safe_error_summary
from vatove_worker.database import DatabaseSchemaError
from vatove_worker.intervals import IntervalsPayloadError


class FakeMessage:
    def __init__(self, value: bytes) -> None:
        self._value = value

    def value(self) -> bytes:
        return self._value

    def topic(self) -> str:
        return "incoming_activities.v1"

    def partition(self) -> int:
        return 1

    def offset(self) -> int:
        return 42

    def error(self) -> None:
        return None


class FakeConsumer:
    def __init__(self) -> None:
        self.commits: list[FakeMessage] = []

    def commit(self, message: FakeMessage, asynchronous: bool = False) -> None:
        assert asynchronous is False
        self.commits.append(message)


class FakeProducer:
    def __init__(self) -> None:
        self.records: list[tuple[str, str | None, bytes]] = []

    def produce(
        self,
        topic: str,
        *,
        key: str | None,
        value: bytes,
        on_delivery: Any,
    ) -> None:
        self.records.append((topic, key, value))
        on_delivery(None, object())

    def poll(self, _: float) -> int:
        return 0

    def flush(self, _: float | None = None) -> int:
        return 0


class FakeRepository:
    def __init__(self) -> None:
        self.failed_syncs: list[tuple[UUID, str]] = []
        self.failures: list[dict[str, Any]] = []

    def fail_sync(self, sync_run_id: UUID, error: str) -> None:
        self.failed_syncs.append((sync_run_id, error))

    def record_failure(self, **values: Any) -> None:
        self.failures.append(values)


class FakeProcessor:
    def __init__(self, failure: Exception | None = None) -> None:
        self.failure = failure
        self.calls = 0

    def process(self, _: Any) -> None:
        self.calls += 1
        if self.failure:
            raise self.failure


class FakeUndefinedColumnError(Exception):
    sqlstate = "42703"


def secret_bearing_programming_error() -> ProgrammingError:
    return ProgrammingError(
        'INSERT INTO activities (raw_metadata) VALUES (%(private_payload)s)',
        {"private_payload": "PRIVATE_ACTIVITY_PAYLOAD"},
        FakeUndefinedColumnError("PRIVATE_DATABASE_DETAIL"),
    )


def event_bytes() -> bytes:
    return json.dumps(
        {
            "schemaVersion": 1,
            "eventId": "0f94b064-8273-4a7f-8282-0f169f89d77b",
            "type": "activity.sync.requested",
            "source": "intervals",
            "syncRunId": "ed70ab4a-f81f-446e-9b90-4e9943cfbded",
            "requestedAt": "2026-07-20T10:00:00Z",
            "range": {"oldest": "2026-07-01", "newest": "2026-07-20"},
        }
    ).encode()


def make_worker(processor: FakeProcessor, attempts: int = 3) -> tuple[Any, ...]:
    consumer = FakeConsumer()
    producer = FakeProducer()
    repository = FakeRepository()
    sleeps: list[float] = []
    worker = IngestionWorker(
        consumer=consumer,  # type: ignore[arg-type]
        producer=producer,  # type: ignore[arg-type]
        processor=processor,  # type: ignore[arg-type]
        repository=repository,  # type: ignore[arg-type]
        dlq_topic="incoming_activities.dlq.v1",
        poll_timeout_seconds=1,
        max_delivery_attempts=attempts,
        sleep=sleeps.append,
    )
    return worker, consumer, producer, repository, sleeps


def test_offset_commits_only_after_success() -> None:
    processor = FakeProcessor()
    worker, consumer, producer, repository, _ = make_worker(processor)
    message = FakeMessage(event_bytes())
    worker.handle_message(message)  # type: ignore[arg-type]
    assert processor.calls == 1
    assert consumer.commits == [message]
    assert producer.records == []
    assert repository.failures == []


def test_exhausted_processing_is_recorded_then_sent_to_dlq() -> None:
    processor = FakeProcessor(RuntimeError("upstream unavailable"))
    worker, consumer, producer, repository, sleeps = make_worker(processor, attempts=3)
    message = FakeMessage(event_bytes())
    worker.handle_message(message)  # type: ignore[arg-type]

    assert processor.calls == 3
    assert sleeps == [1.0, 2.0]
    assert len(repository.failed_syncs) == 1
    assert len(repository.failures) == 1
    assert len(producer.records) == 1
    dlq = json.loads(producer.records[0][2])
    assert dlq["attempts"] == 3
    assert dlq["event"]["schemaVersion"] == 1
    assert consumer.commits == [message]


def test_invalid_event_dlq_contains_hash_not_raw_payload() -> None:
    processor = FakeProcessor()
    worker, consumer, producer, repository, _ = make_worker(processor)
    raw = b'{"INTERVALS_API_KEY":"must-not-leak"}'
    message = FakeMessage(raw)
    worker.handle_message(message)  # type: ignore[arg-type]

    dlq_bytes = producer.records[0][2]
    assert b"must-not-leak" not in dlq_bytes
    dlq = json.loads(dlq_bytes)
    assert dlq["event"] is None
    assert len(dlq["rawSha256"]) == 64
    assert repository.failures[0]["payload"]["rawSha256"] == dlq["rawSha256"]
    assert consumer.commits == [message]


def test_database_error_summary_is_actionable_without_statement_or_parameters() -> None:
    summary = safe_error_summary(secret_bearing_programming_error())

    assert "ProgrammingError" in summary
    assert "FakeUndefinedColumnError" in summary
    assert "SQLSTATE 42703" in summary
    assert "run database migrations" in summary
    assert "INSERT INTO" not in summary
    assert "PRIVATE_ACTIVITY_PAYLOAD" not in summary
    assert "PRIVATE_DATABASE_DETAIL" not in summary


def test_programming_error_is_not_retried_and_uses_safe_summary_everywhere(
    caplog: Any,
) -> None:
    processor = FakeProcessor(secret_bearing_programming_error())
    worker, consumer, producer, repository, sleeps = make_worker(processor, attempts=4)
    message = FakeMessage(event_bytes())

    with caplog.at_level(logging.WARNING, logger="vatove_worker.consumer"):
        worker.handle_message(message)  # type: ignore[arg-type]

    assert processor.calls == 1
    assert sleeps == []
    assert consumer.commits == [message]
    assert len(repository.failed_syncs) == 1
    assert len(repository.failures) == 1
    assert len(producer.records) == 1

    stored_error = repository.failed_syncs[0][1]
    failure_error = repository.failures[0]["error"]
    dlq = json.loads(producer.records[0][2])
    assert stored_error == failure_error == dlq["error"]
    assert dlq["attempts"] == 1
    assert "SQLSTATE 42703" in stored_error
    assert "run database migrations" in stored_error
    assert "not retrying" in caplog.text
    for unsafe_value in (
        "INSERT INTO",
        "PRIVATE_ACTIVITY_PAYLOAD",
        "PRIVATE_DATABASE_DETAIL",
    ):
        assert unsafe_value not in stored_error
        assert unsafe_value not in caplog.text
        assert unsafe_value.encode() not in producer.records[0][2]


def test_database_schema_error_is_not_retried() -> None:
    processor = FakeProcessor(DatabaseSchemaError("Run the migrate service."))
    worker, consumer, producer, repository, sleeps = make_worker(processor, attempts=4)
    message = FakeMessage(event_bytes())

    worker.handle_message(message)  # type: ignore[arg-type]

    assert processor.calls == 1
    assert sleeps == []
    assert consumer.commits == [message]
    assert repository.failed_syncs[0][1] == (
        "DatabaseSchemaError: Run the migrate service."
    )
    assert json.loads(producer.records[0][2])["error"] == repository.failed_syncs[0][1]


def test_safe_error_summary_retains_only_allowlisted_messages() -> None:
    assert safe_error_summary(IntervalsPayloadError("invalid activity detail for i123")) == (
        "IntervalsPayloadError: invalid activity detail for i123"
    )
    assert safe_error_summary(RuntimeError("INTERVALS_API_KEY=must-not-leak")) == "RuntimeError"
