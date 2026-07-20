from __future__ import annotations

import bisect
import math
from typing import Any

from vatove_worker.intervals import FetchedActivity, IntervalsPayloadError
from vatove_worker.schemas import HeartRateZone, NormalizedActivity, NormalizedSample

ZONE_COLORS = (
    "#3b82f6",
    "#22c55e",
    "#eab308",
    "#f97316",
    "#ef4444",
    "#a855f7",
    "#7f1d1d",
)


def normalize_activity(fetched: FetchedActivity) -> NormalizedActivity:
    streams: dict[str, list[Any]] = {}
    for stream in fetched.streams:
        if stream.type in streams:
            raise IntervalsPayloadError(f"duplicate stream type: {stream.type}")
        streams[stream.type] = stream.data

    relevant = {
        name: values
        for name, values in streams.items()
        if name in {"time", "distance", "heartrate", "altitude"}
    }
    populated_lengths = {len(values) for values in relevant.values() if values}
    if len(populated_lengths) > 1:
        raise IntervalsPayloadError("activity streams do not have matching lengths")
    stream_length = next(iter(populated_lengths), 0)

    points = fetched.map_points
    previous_index = -1
    for point in points:
        if point.source_index <= previous_index:
            raise IntervalsPayloadError("map source indices must be strictly increasing")
        previous_index = point.source_index
        if stream_length and point.source_index >= stream_length:
            raise IntervalsPayloadError("map source index is outside the activity streams")

    if (
        stream_length
        and any(not point.source_index_explicit for point in points)
        and len(points) != stream_length
    ):
        raise IntervalsPayloadError(
            "map payload omitted source indices and cannot be safely aligned to streams"
        )

    thresholds = _validated_thresholds(fetched.activity.icu_hr_zones)
    zones = build_heart_rate_zones(thresholds)
    samples: list[NormalizedSample] = []
    route_coordinates: list[tuple[float, float]] = []

    # One point is not a valid LineString and is intentionally treated as list-only.
    if len(points) >= 2:
        for output_index, point in enumerate(points):
            source_index = point.source_index
            elapsed = _stream_float(relevant.get("time"), source_index, "time")
            distance = _stream_float(relevant.get("distance"), source_index, "distance")
            elevation = _stream_float(relevant.get("altitude"), source_index, "altitude")
            heart_rate_value = _stream_float(
                relevant.get("heartrate"), source_index, "heartrate"
            )
            heart_rate = round(heart_rate_value) if heart_rate_value is not None else None
            zone = heart_rate_zone(heart_rate, thresholds)
            route_coordinates.append((point.longitude, point.latitude))
            samples.append(
                NormalizedSample.model_validate(
                    {
                        "index": output_index,
                        "sourceIndex": source_index,
                        "longitude": point.longitude,
                        "latitude": point.latitude,
                        "elapsedSeconds": elapsed,
                        "distanceMeters": distance,
                        "elevationMeters": elevation,
                        "heartRateBpm": heart_rate,
                        "heartRateZone": zone,
                    }
                )
            )

    activity = fetched.activity
    return NormalizedActivity(
        source_activity_id=activity.id,
        name=activity.name,
        sport=activity.sport,
        start_at=activity.start_at,
        moving_time_seconds=activity.moving_time,
        distance_meters=activity.distance,
        route_coordinates=route_coordinates,
        samples=samples,
        heart_rate_zones=zones,
        raw_metadata=fetched.raw_activity,
        source_updated_at=activity.source_updated_at,
    )


def build_heart_rate_zones(thresholds: list[float]) -> list[HeartRateZone]:
    if not thresholds:
        return []

    zones: list[HeartRateZone] = []
    previous_max: float | None = None
    for index, maximum in enumerate([*thresholds, None], start=1):
        zones.append(
            HeartRateZone.model_validate(
                {
                    "index": index,
                    "label": f"Z{index}",
                    "color": ZONE_COLORS[min(index - 1, len(ZONE_COLORS) - 1)],
                    "minBpm": previous_max,
                    "maxBpm": maximum,
                }
            )
        )
        previous_max = maximum
    return zones


def heart_rate_zone(heart_rate: int | None, thresholds: list[float]) -> int | None:
    if heart_rate is None or not thresholds:
        return None
    # The recorded values are boundaries. Equality enters the next zone and N boundaries define
    # N+1 zones, with the final zone open-ended.
    return bisect.bisect_right(thresholds, heart_rate) + 1


def _validated_thresholds(values: list[float]) -> list[float]:
    thresholds: list[float] = []
    for value in values:
        numeric = float(value)
        if not math.isfinite(numeric) or numeric <= 0:
            raise IntervalsPayloadError("heart-rate zone thresholds must be positive numbers")
        if thresholds and numeric <= thresholds[-1]:
            raise IntervalsPayloadError("heart-rate zone thresholds must increase")
        thresholds.append(numeric)
    return thresholds


def _stream_float(values: list[Any] | None, index: int, name: str) -> float | None:
    if values is None:
        return None
    if index >= len(values):
        raise IntervalsPayloadError(f"{name} stream is shorter than the map source index")
    value = values[index]
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise IntervalsPayloadError(f"{name} stream contains a non-numeric value")
    numeric = float(value)
    return numeric if math.isfinite(numeric) else None
