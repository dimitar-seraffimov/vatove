from __future__ import annotations

from functools import lru_cache

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration loaded exclusively from the environment."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    database_url: str = "postgresql+psycopg://vatove:vatove-local-only@postgis:5432/vatove"
    kafka_brokers: str = "kafka:9092"
    kafka_ingestion_topic: str = "incoming_activities.v1"
    kafka_dlq_topic: str = "incoming_activities.dlq.v1"
    kafka_consumer_group: str = "vatove-intervals-worker-v1"
    kafka_poll_timeout_seconds: float = Field(default=1.0, gt=0)
    kafka_max_delivery_attempts: int = Field(default=4, ge=1, le=20)

    intervals_api_base_url: str = "https://intervals.icu"
    intervals_api_key: SecretStr
    intervals_user_agent: str = "Mozilla/5.0 (compatible; vatove/0.1; +http://localhost)"
    intervals_requests_per_second: float = Field(default=8.0, gt=0, lt=10)
    intervals_timeout_seconds: float = Field(default=30.0, gt=0)
    intervals_max_retries: int = Field(default=4, ge=0, le=10)

    log_level: str = "INFO"

    @field_validator("intervals_api_base_url")
    @classmethod
    def strip_api_base_url(cls, value: str) -> str:
        return value.rstrip("/")

    @property
    def kafka_broker_list(self) -> list[str]:
        return [broker.strip() for broker in self.kafka_brokers.split(",") if broker.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
