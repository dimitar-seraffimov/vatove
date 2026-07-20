from __future__ import annotations

import logging
import signal
import threading

from vatove_worker.config import get_settings
from vatove_worker.consumer import IngestionWorker, build_consumer, build_producer
from vatove_worker.database import (
    Repository,
    assert_schema_compatible,
    create_database_engine,
)
from vatove_worker.intervals import IntervalsClient
from vatove_worker.processor import SyncProcessor


def main() -> None:
    settings = get_settings()
    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    logger = logging.getLogger(__name__)

    engine = create_database_engine(settings.database_url)
    assert_schema_compatible(engine)

    repository = Repository(engine)
    intervals = IntervalsClient(
        base_url=settings.intervals_api_base_url,
        api_key=settings.intervals_api_key.get_secret_value(),
        athlete_id=settings.intervals_athlete_id,
        user_agent=settings.intervals_user_agent,
        requests_per_second=settings.intervals_requests_per_second,
        timeout_seconds=settings.intervals_timeout_seconds,
        max_retries=settings.intervals_max_retries,
    )
    consumer = build_consumer(
        brokers=settings.kafka_broker_list,
        group=settings.kafka_consumer_group,
        topic=settings.kafka_ingestion_topic,
    )
    producer = build_producer(brokers=settings.kafka_broker_list)
    processor = SyncProcessor(repository, intervals)
    stop = threading.Event()

    def request_stop(signum: int, _: object) -> None:
        logger.info("Received signal %d; stopping after the current message", signum)
        stop.set()

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)

    worker = IngestionWorker(
        consumer=consumer,
        producer=producer,
        processor=processor,
        repository=repository,
        dlq_topic=settings.kafka_dlq_topic,
        poll_timeout_seconds=settings.kafka_poll_timeout_seconds,
        max_delivery_attempts=settings.kafka_max_delivery_attempts,
    )
    try:
        worker.run_forever(stop.is_set)
    finally:
        intervals.close()
        engine.dispose()


if __name__ == "__main__":
    main()
