from __future__ import annotations

import email.utils
import logging
import math
import threading
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any
from urllib.parse import quote

import httpx
from pydantic import TypeAdapter, ValidationError

from vatove_worker.schemas import (
    IntervalsActivity,
    IntervalsSportSettings,
    IntervalsStream,
    MapPoint,
)

logger = logging.getLogger(__name__)

ACTIVITY_FIELDS = ",".join(
    (
        "id",
        "name",
        "type",
        "start_date",
        "start_date_local",
        "moving_time",
        "distance",
        "updated",
        "average_heartrate",
        "max_heartrate",
        "icu_hr_zone_times",
        "icu_hr_zones",
    )
)


class IntervalsError(RuntimeError):
    """Base error for the Intervals boundary."""


class IntervalsAuthenticationError(IntervalsError):
    """The configured API key is missing or rejected."""


class IntervalsUpstreamError(IntervalsError):
    """Intervals returned a non-retryable or exhausted response."""


class IntervalsPayloadError(IntervalsError):
    """Intervals returned JSON that no longer matches the expected contract."""


@dataclass(frozen=True, slots=True)
class FetchedActivity:
    activity: IntervalsActivity
    raw_activity: dict[str, Any]
    map_points: list[MapPoint]
    streams: list[IntervalsStream]


class _RateLimiter:
    def __init__(
        self,
        requests_per_second: float,
        *,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._interval = 1.0 / requests_per_second
        self._clock = clock
        self._sleep = sleep
        self._next_request_at = 0.0
        self._lock = threading.Lock()

    def wait(self) -> None:
        with self._lock:
            now = self._clock()
            delay = self._next_request_at - now
            if delay > 0:
                self._sleep(delay)
                now = self._clock()
            self._next_request_at = max(now, self._next_request_at) + self._interval


class IntervalsClient:
    """Small, rate-limited client for the Intervals endpoints used by the MVP."""

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        user_agent: str,
        athlete_id: str = "0",
        requests_per_second: float = 8.0,
        timeout_seconds: float = 30.0,
        max_retries: int = 4,
        client: httpx.Client | None = None,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        if not api_key:
            raise IntervalsAuthenticationError("INTERVALS_API_KEY must be configured")
        if not 0 < requests_per_second < 10:
            raise ValueError("requests_per_second must be greater than 0 and below 10")
        self._sleep = sleep
        self._max_retries = max_retries
        self._athlete_id = quote(athlete_id.strip(), safe="")
        if not self._athlete_id:
            raise ValueError("athlete_id must not be empty")
        self._limiter = _RateLimiter(requests_per_second, clock=clock, sleep=sleep)
        self._owns_client = client is None
        self._client = client or httpx.Client(
            base_url=base_url.rstrip("/"),
            auth=httpx.BasicAuth("API_KEY", api_key),
            headers={
                "Accept": "application/json",
                "User-Agent": user_agent,
            },
            timeout=timeout_seconds,
            follow_redirects=False,
        )

    def __enter__(self) -> IntervalsClient:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def list_activities(self, oldest: date, newest: date) -> list[IntervalsActivity]:
        payload = self._get_json(
            f"/api/v1/athlete/{self._athlete_id}/activities",
            params={
                "oldest": oldest.isoformat(),
                "newest": newest.isoformat(),
                "fields": ACTIVITY_FIELDS,
            },
        )
        try:
            return TypeAdapter(list[IntervalsActivity]).validate_python(payload)
        except ValidationError as error:
            raise IntervalsPayloadError("invalid activity-list payload") from error

    def fetch_sport_settings(self) -> list[IntervalsSportSettings]:
        payload = self._get_json(f"/api/v1/athlete/{self._athlete_id}/sport-settings")
        try:
            return TypeAdapter(list[IntervalsSportSettings]).validate_python(payload)
        except ValidationError as error:
            raise IntervalsPayloadError("invalid sport-settings payload") from error

    def fetch_activity(self, activity_id: str) -> FetchedActivity:
        raw_activity = self._get_json(f"/api/v1/activity/{activity_id}")
        if not isinstance(raw_activity, dict):
            raise IntervalsPayloadError("activity detail must be a JSON object")
        try:
            activity = IntervalsActivity.model_validate(raw_activity)
        except ValidationError as error:
            raise IntervalsPayloadError(f"invalid activity detail for {activity_id}") from error

        raw_streams = self._get_json(
            f"/api/v1/activity/{activity_id}/streams.json",
            params={"types": "time,distance,heartrate,altitude,velocity_smooth,latlng"},
        )
        try:
            streams = TypeAdapter(list[IntervalsStream]).validate_python(raw_streams)
        except ValidationError as error:
            raise IntervalsPayloadError(f"invalid stream payload for {activity_id}") from error
        map_points = map_points_from_streams(streams)
        return FetchedActivity(activity, raw_activity, map_points, streams)

    def _get_json(self, path: str, params: Mapping[str, str] | None = None) -> Any:
        last_error: Exception | None = None
        for attempt in range(self._max_retries + 1):
            self._limiter.wait()
            try:
                response = self._client.get(path, params=params)
            except httpx.RequestError as error:
                last_error = error
                if attempt == self._max_retries:
                    break
                self._sleep(self._backoff(attempt))
                continue

            if response.status_code in {401, 403}:
                raise IntervalsAuthenticationError(
                    f"Intervals rejected the configured credentials ({response.status_code})"
                )
            if response.status_code == 429 or 500 <= response.status_code < 600:
                if attempt == self._max_retries:
                    raise IntervalsUpstreamError(
                        f"Intervals request failed after retries ({response.status_code})"
                    )
                delay = retry_after_seconds(response.headers.get("Retry-After"))
                self._sleep(delay if delay is not None else self._backoff(attempt))
                continue
            if response.is_redirect:
                raise IntervalsUpstreamError(
                    f"Intervals unexpectedly redirected {path} ({response.status_code})"
                )
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError as error:
                raise IntervalsUpstreamError(
                    f"Intervals request failed ({response.status_code})"
                ) from error
            try:
                return response.json()
            except ValueError as error:
                raise IntervalsPayloadError("Intervals returned invalid JSON") from error

        raise IntervalsUpstreamError("Intervals request failed after retries") from last_error

    @staticmethod
    def _backoff(attempt: int) -> float:
        return min(0.5 * (2**attempt), 30.0)


def retry_after_seconds(value: str | None, *, now: datetime | None = None) -> float | None:
    if value is None:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        pass
    try:
        retry_at = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError, OverflowError):
        return None
    if retry_at.tzinfo is None:
        retry_at = retry_at.replace(tzinfo=UTC)
    current = now or datetime.now(UTC)
    return max(0.0, (retry_at - current).total_seconds())


def parse_map_payload(payload: Any) -> list[MapPoint]:
    """Validate map points while tolerating the documented API's historical wire variants.

    The endpoint has returned point objects, paired latitude/longitude arrays and GeoJSON over
    its lifetime. All forms are converted to an explicit source stream index.
    """

    if payload in (None, [], {}):
        return []

    if isinstance(payload, dict):
        if payload.get("type") == "Feature":
            geometry = payload.get("geometry")
            if not isinstance(geometry, dict):
                raise IntervalsPayloadError("map GeoJSON feature has no geometry")
            return _geojson_points(geometry)
        if payload.get("type") == "LineString":
            return _geojson_points(payload)

        for key in ("points", "map", "latlng", "coordinates"):
            if key in payload:
                value = payload[key]
                if key == "coordinates":
                    return _geojson_points({"type": "LineString", "coordinates": value})
                if isinstance(value, dict):
                    return parse_map_payload(value)
                indices = payload.get("indices") or payload.get("source_indices")
                return _point_sequence(value, indices=indices)

        latitudes = payload.get(
            "latitudes", payload.get("latitude", payload.get("lat", payload.get("data")))
        )
        longitudes = payload.get(
            "longitudes",
            payload.get("longitude", payload.get("lng", payload.get("lon", payload.get("data2")))),
        )
        if isinstance(latitudes, list) and isinstance(longitudes, list):
            if len(latitudes) != len(longitudes):
                raise IntervalsPayloadError("map latitude/longitude arrays have different lengths")
            indices = payload.get("indices") or payload.get("source_indices")
            if indices is not None and (
                not isinstance(indices, list) or len(indices) != len(latitudes)
            ):
                raise IntervalsPayloadError("map indices do not align with coordinates")
            return [
                _validate_point(
                    indices[index] if indices is not None else index,
                    latitude,
                    longitudes[index],
                    explicit=indices is not None,
                )
                for index, latitude in enumerate(latitudes)
                if latitude is not None and longitudes[index] is not None
            ]
        raise IntervalsPayloadError("unrecognized map object payload")

    return _point_sequence(payload)


def map_points_from_streams(streams: Sequence[IntervalsStream]) -> list[MapPoint]:
    """Build route points from Intervals' paired ``latlng`` activity stream.

    Intervals stores latitude in ``data`` and longitude in ``data2``. Array positions are the
    source indices shared by all activity streams, so retain them when either coordinate is null.
    """

    latlng_streams = [stream for stream in streams if stream.type == "latlng"]
    if not latlng_streams:
        return []
    if len(latlng_streams) > 1:
        raise IntervalsPayloadError("duplicate stream type: latlng")

    stream = latlng_streams[0]
    if stream.data2 is None:
        raise IntervalsPayloadError("latlng stream is missing longitude data")
    return parse_map_payload(
        {
            "data": stream.data,
            "data2": stream.data2,
            "source_indices": list(range(len(stream.data))),
        }
    )


def _geojson_points(geometry: Mapping[str, Any]) -> list[MapPoint]:
    if geometry.get("type") != "LineString":
        raise IntervalsPayloadError("map geometry must be a LineString")
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list):
        raise IntervalsPayloadError("map LineString coordinates must be an array")
    points: list[MapPoint] = []
    for index, coordinate in enumerate(coordinates):
        if not isinstance(coordinate, Sequence) or isinstance(coordinate, (str, bytes)):
            raise IntervalsPayloadError("invalid map coordinate")
        if len(coordinate) < 2:
            raise IntervalsPayloadError("map coordinate must contain longitude and latitude")
        points.append(_validate_point(index, coordinate[1], coordinate[0], explicit=False))
    return points


def _point_sequence(value: Any, *, indices: Any = None) -> list[MapPoint]:
    if not isinstance(value, list):
        raise IntervalsPayloadError("map points must be an array")
    if indices is not None and (not isinstance(indices, list) or len(indices) != len(value)):
        raise IntervalsPayloadError("map indices do not align with coordinates")
    points: list[MapPoint] = []
    for fallback_index, raw_point in enumerate(value):
        if raw_point is None:
            continue
        if isinstance(raw_point, dict):
            inherited_index = indices[fallback_index] if indices is not None else fallback_index
            source_index = raw_point.get(
                "sourceIndex",
                raw_point.get("source_index", raw_point.get("index", inherited_index)),
            )
            latitude = raw_point.get("lat", raw_point.get("latitude"))
            longitude = raw_point.get(
                "lng", raw_point.get("lon", raw_point.get("longitude"))
            )
            latlng = raw_point.get("latlng")
            if (
                (latitude is None or longitude is None)
                and isinstance(latlng, Sequence)
                and not isinstance(latlng, (str, bytes))
                and len(latlng) >= 2
            ):
                latitude, longitude = latlng[0], latlng[1]
            if latitude is None or longitude is None:
                raise IntervalsPayloadError("map point is missing latitude or longitude")
            points.append(
                _validate_point(
                    source_index,
                    latitude,
                    longitude,
                    explicit=indices is not None
                    or any(
                        key in raw_point for key in ("sourceIndex", "source_index", "index")
                    ),
                )
            )
            continue
        if isinstance(raw_point, Sequence) and not isinstance(raw_point, (str, bytes)):
            if len(raw_point) < 2:
                raise IntervalsPayloadError("map point array must contain latitude and longitude")
            # The Intervals map endpoint uses [latitude, longitude, optional source-index].
            source_index = (
                raw_point[2]
                if len(raw_point) > 2
                else indices[fallback_index]
                if indices is not None
                else fallback_index
            )
            points.append(
                _validate_point(
                    source_index,
                    raw_point[0],
                    raw_point[1],
                    explicit=len(raw_point) > 2 or indices is not None,
                )
            )
            continue
        raise IntervalsPayloadError("invalid map point")
    return points


def _validate_point(
    source_index: Any, latitude: Any, longitude: Any, *, explicit: bool = True
) -> MapPoint:
    try:
        point = MapPoint.model_validate(
            {
                "source_index": source_index,
                "latitude": latitude,
                "longitude": longitude,
                "source_index_explicit": explicit,
            }
        )
    except (ValidationError, TypeError, ValueError) as error:
        raise IntervalsPayloadError("invalid map point value") from error
    if (
        point.source_index < 0
        or not math.isfinite(point.latitude)
        or not math.isfinite(point.longitude)
    ):
        raise IntervalsPayloadError("invalid map point value")
    return point
