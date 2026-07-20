from __future__ import annotations

import hashlib
import json
import logging
import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any, Protocol

from confluent_kafka import Consumer, KafkaError, KafkaException, Message, Producer
from pydantic import ValidationError
from sqlalchemy.exc import DBAPIError, ProgrammingError

from vatove_worker.database import DatabaseSchemaError, Repository, SyncRunNotFoundError
from vatove_worker.intervals import IntervalsError
from vatove_worker.processor import SyncProcessor
from vatove_worker.schemas import IngestionEventV1

logger = logging.getLogger(__name__)

_DATABASE_ERROR_HINTS = {
    "42703": "database schema is missing a required column; run database migrations",
    "42P01": "database schema is missing a required table; run database migrations",
    "42704": "database schema is missing a required object; run database migrations",
}


def safe_error_summary(error: BaseException) -> str:
    """Return an operator-facing error without serializing unsafe exception context.

    SQLAlchemy database errors retain the statement and its bound parameters. Stringifying one can
    therefore expose private activity metadata in logs, the sync status, or the DLQ. Only exception
    class names, a validated SQLSTATE, and a static hint are used for database failures.
    """

    if isinstance(error, DBAPIError):
        original = error.orig
        sqlstate_value = getattr(original, "sqlstate", None)
        sqlstate = (
            sqlstate_value.upper()
            if isinstance(sqlstate_value, str)
            and len(sqlstate_value) == 5
            and sqlstate_value.isalnum()
            else None
        )
        identifiers = [type(error).__name__, type(original).__name__]
        if sqlstate is not None:
            identifiers.append(f"SQLSTATE {sqlstate}")
        hint = _DATABASE_ERROR_HINTS.get(sqlstate)
        if hint is None and isinstance(error, ProgrammingError):
            hint = "database rejected a statement; verify that all migrations are applied"
        if hint is None:
            hint = "database operation failed"
        return f"{' / '.join(identifiers)}: {hint}"

    if isinstance(error, (DatabaseSchemaError, IntervalsError, SyncRunNotFoundError)):
        controlled_message = " ".join(str(error).split())[:900]
        if controlled_message:
            return f"{type(error).__name__}: {controlled_message}"

    return type(error).__name__


def _is_retryable(error: BaseException) -> bool:
    return not isinstance(error, (DatabaseSchemaError, ProgrammingError))


class ConsumerLike(Protocol):
    def poll(self, timeout: float) -> Message | None: ...

    def commit(self, message: Message, asynchronous: bool = False) -> Any: ...

    def close(self) -> None: ...


class ProducerLike(Protocol):
    def produce(
        self,
        topic: str,
        *,
        key: str | None,
        value: bytes,
        on_delivery: Callable[[Any, Any], None],
    ) -> None: ...

    def poll(self, timeout: float) -> int: ...

    def flush(self, timeout: float | None = None) -> int: ...


def build_consumer(*, brokers: list[str], group: str, topic: str) -> Consumer:
    consumer = Consumer(
        {
            "bootstrap.servers": ",".join(brokers),
            "group.id": group,
            "enable.auto.commit": False,
            "enable.auto.offset.store": False,
            "auto.offset.reset": "earliest",
            "max.poll.interval.ms": 3_600_000,
            "session.timeout.ms": 45_000,
        }
    )
    consumer.subscribe([topic])
    return consumer


def build_producer(*, brokers: list[str]) -> Producer:
    return Producer(
        {
            "bootstrap.servers": ",".join(brokers),
            "enable.idempotence": True,
            "acks": "all",
        }
    )


class IngestionWorker:
    def __init__(
        self,
        *,
        consumer: ConsumerLike,
        producer: ProducerLike,
        processor: SyncProcessor,
        repository: Repository,
        dlq_topic: str,
        poll_timeout_seconds: float,
        max_delivery_attempts: int,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._consumer = consumer
        self._producer = producer
        self._processor = processor
        self._repository = repository
        self._dlq_topic = dlq_topic
        self._poll_timeout_seconds = poll_timeout_seconds
        self._max_delivery_attempts = max_delivery_attempts
        self._sleep = sleep

    def run_forever(self, should_stop: Callable[[], bool]) -> None:
        try:
            while not should_stop():
                message = self._consumer.poll(self._poll_timeout_seconds)
                if message is None:
                    continue
                if message.error():
                    if message.error().code() == KafkaError._PARTITION_EOF:
                        continue
                    raise KafkaException(message.error())
                self.handle_message(message)
        finally:
            self._consumer.close()

    def handle_message(self, message: Message) -> None:
        raw = message.value() or b""
        try:
            decoded = json.loads(raw)
            event = IngestionEventV1.model_validate(decoded)
        except (json.JSONDecodeError, UnicodeDecodeError, ValidationError, TypeError) as error:
            reason = f"invalid ingestion event: {type(error).__name__}"
            audit = {
                "topic": message.topic(),
                "partition": message.partition(),
                "offset": message.offset(),
                "rawSha256": hashlib.sha256(raw).hexdigest(),
            }
            self._repository.record_failure(event=None, error=reason, payload=audit)
            self._publish_dlq(message, event=None, error=reason, attempts=1)
            self._consumer.commit(message=message, asynchronous=False)
            return

        last_error: Exception | None = None
        attempts_made = 0
        for attempt in range(1, self._max_delivery_attempts + 1):
            attempts_made = attempt
            try:
                self._processor.process(event)
            except Exception as error:  # noqa: BLE001 - message boundary must capture for retry/DLQ
                last_error = error
                error_summary = safe_error_summary(error)
                retryable = _is_retryable(error)
                logger.warning(
                    "Sync event %s attempt %d/%d failed: %s%s",
                    event.event_id,
                    attempt,
                    self._max_delivery_attempts,
                    error_summary,
                    " (not retrying)" if not retryable else "",
                )
                if retryable and attempt < self._max_delivery_attempts:
                    self._sleep(min(float(2 ** (attempt - 1)), 30.0))
                    continue
                break
            else:
                self._consumer.commit(message=message, asynchronous=False)
                return

        assert last_error is not None
        error_text = safe_error_summary(last_error)
        self._repository.fail_sync(event.sync_run_id, error_text)
        self._repository.record_failure(event=event, error=error_text)
        self._publish_dlq(
            message,
            event=event,
            error=error_text,
            attempts=attempts_made,
        )
        self._consumer.commit(message=message, asynchronous=False)

    def _publish_dlq(
        self,
        message: Message,
        *,
        event: IngestionEventV1 | None,
        error: str,
        attempts: int,
    ) -> None:
        delivery_errors: list[Any] = []

        def delivered(delivery_error: Any, _: Any) -> None:
            if delivery_error is not None:
                delivery_errors.append(delivery_error)

        payload = {
            "schemaVersion": 1,
            "failedAt": datetime.now(UTC).isoformat(),
            "sourceTopic": message.topic(),
            "sourcePartition": message.partition(),
            "sourceOffset": message.offset(),
            "attempts": attempts,
            "error": " ".join(error.split())[:1000],
            "event": event.model_dump(by_alias=True, mode="json") if event else None,
            "rawSha256": hashlib.sha256(message.value() or b"").hexdigest(),
        }
        key = str(event.event_id) if event else None
        serialized = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self._producer.produce(
            self._dlq_topic,
            key=key,
            value=serialized,
            on_delivery=delivered,
        )
        self._producer.poll(0)
        remaining = self._producer.flush(10.0)
        if remaining or delivery_errors:
            raise KafkaException(
                f"could not deliver event to DLQ (remaining={remaining}, errors={delivery_errors})"
            )
