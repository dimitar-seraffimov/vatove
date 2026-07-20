from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class IngestionRange(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    oldest: date
    newest: date

    @model_validator(mode="after")
    def validate_order(self) -> IngestionRange:
        if self.oldest > self.newest:
            raise ValueError("oldest must not be after newest")
        return self


class IngestionEventV1(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    schema_version: Literal[1] = Field(alias="schemaVersion")
    event_id: UUID = Field(alias="eventId")
    type: Literal["activity.sync.requested"]
    source: Literal["intervals"]
    sync_run_id: UUID = Field(alias="syncRunId")
    requested_at: datetime = Field(alias="requestedAt")
    range: IngestionRange

    @field_validator("requested_at")
    @classmethod
    def require_aware_requested_at(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("requestedAt must include a timezone")
        return value


class IntervalsActivity(BaseModel):
    """Validated subset of an Intervals activity response.

    Intervals adds fields frequently, so unknown fields are retained in the raw response but
    intentionally ignored by this boundary model.
    """

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    id: str
    name: str = "Untitled activity"
    sport: str = Field(alias="type", default="Unknown")
    start_at: datetime
    moving_time: int | None = None
    distance: float | None = None
    average_heartrate: float | None = None
    max_heartrate: float | None = None
    icu_hr_zone_times: list[Any] | None = None
    icu_hr_zones: list[Any] = Field(default_factory=list)
    source_updated_at: datetime | None = None

    @model_validator(mode="before")
    @classmethod
    def map_upstream_names(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        mapped = dict(value)
        mapped["id"] = str(mapped.get("id", ""))
        mapped["name"] = mapped.get("name") or "Untitled activity"
        mapped["start_at"] = (
            mapped.get("start_at")
            or mapped.get("start_date")
            or mapped.get("start_date_local")
        )
        mapped["source_updated_at"] = (
            mapped.get("updated") or mapped.get("icu_last_updated") or mapped.get("last_updated")
        )
        return mapped

    @field_validator("id")
    @classmethod
    def nonempty_id(cls, value: str) -> str:
        if not value:
            raise ValueError("activity id is required")
        return value

    @field_validator("average_heartrate", "max_heartrate", mode="before")
    @classmethod
    def tolerate_invalid_heart_rate_analysis(cls, value: Any) -> float | None:
        if value is None or isinstance(value, bool):
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    @field_validator("icu_hr_zone_times", mode="before")
    @classmethod
    def tolerate_invalid_zone_times(cls, value: Any) -> list[Any] | None:
        return value if isinstance(value, list) else None

    @field_validator("icu_hr_zones", mode="before")
    @classmethod
    def tolerate_invalid_zones(cls, value: Any) -> list[Any]:
        return value if isinstance(value, list) else []

    @field_validator("start_at", "source_updated_at")
    @classmethod
    def make_datetimes_aware(cls, value: datetime | None) -> datetime | None:
        # The API normally provides start_date in UTC. Some imports expose only the local,
        # timezone-free field; treating it as UTC is deterministic until athlete TZ is in scope.
        if value is not None and value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value


class IntervalsSportSettings(BaseModel):
    """Permissive subset of an Intervals sport-settings entry."""

    model_config = ConfigDict(extra="allow")

    types: list[Any] = Field(default_factory=list)
    hr_zones: list[Any] = Field(default_factory=list)
    hr_zone_names: list[Any] = Field(default_factory=list)
    other: bool = False

    @field_validator("types", "hr_zones", "hr_zone_names", mode="before")
    @classmethod
    def tolerate_invalid_arrays(cls, value: Any) -> list[Any]:
        return value if isinstance(value, list) else []


class IntervalsStream(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: str
    data: list[Any]
    data2: list[Any] | None = None


class MapPoint(BaseModel):
    source_index: int
    latitude: float
    longitude: float
    source_index_explicit: bool = Field(default=True, exclude=True)

    @field_validator("latitude")
    @classmethod
    def valid_latitude(cls, value: float) -> float:
        if not -90 <= value <= 90:
            raise ValueError("latitude outside [-90, 90]")
        return value

    @field_validator("longitude")
    @classmethod
    def valid_longitude(cls, value: float) -> float:
        if not -180 <= value <= 180:
            raise ValueError("longitude outside [-180, 180]")
        return value


class NormalizedSample(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    index: int
    source_index: int = Field(alias="sourceIndex")
    longitude: float
    latitude: float
    elapsed_seconds: float | None = Field(alias="elapsedSeconds")
    distance_meters: float | None = Field(alias="distanceMeters")
    elevation_meters: float | None = Field(alias="elevationMeters")
    speed_meters_per_second: float | None = Field(alias="speedMetersPerSecond")
    heart_rate_bpm: int | None = Field(alias="heartRateBpm")
    heart_rate_zone: int | None = Field(alias="heartRateZone")


class HeartRateZone(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    index: int
    label: str
    color: str
    min_bpm: float | None = Field(alias="minBpm")
    max_bpm: float | None = Field(alias="maxBpm")
    duration_seconds: float | None = Field(alias="durationSeconds")


class NormalizedActivity(BaseModel):
    source: Literal["intervals"] = "intervals"
    source_activity_id: str
    name: str
    sport: str
    start_at: datetime
    moving_time_seconds: int | None
    distance_meters: float | None
    average_heart_rate_bpm: float | None
    max_heart_rate_bpm: float | None
    route_coordinates: list[tuple[float, float]]
    samples: list[NormalizedSample]
    heart_rate_zones: list[HeartRateZone]
    raw_metadata: dict[str, Any]
    source_updated_at: datetime | None
