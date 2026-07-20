from __future__ import annotations

import bisect
import logging
import math
from collections.abc import Sequence
from typing import Any

from vatove_worker.intervals import FetchedActivity, IntervalsPayloadError
from vatove_worker.schemas import (
    HeartRateZone,
    IntervalsSportSettings,
    NormalizedActivity,
    NormalizedSample,
)

logger = logging.getLogger(__name__)

ZONE_COLORS = (
    "#3b82f6",
    "#22c55e",
    "#eab308",
    "#f97316",
    "#ef4444",
    "#a855f7",
    "#7f1d1d",
)


def normalize_activity(
    fetched: FetchedActivity, sport_settings: Sequence[IntervalsSportSettings] = ()
) -> NormalizedActivity:
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

    setting = select_sport_settings(fetched.activity.sport, sport_settings)
    thresholds: list[float] = []
    labels: list[str] = []
    if setting is not None:
        try:
            thresholds = _validated_thresholds(setting.hr_zones)
        except IntervalsPayloadError as error:
            logger.warning(
                "Ignoring invalid heart-rate zones for activity %s (%s): %s",
                fetched.activity.id,
                fetched.activity.sport,
                error,
            )
        else:
            labels = _zone_labels(setting.hr_zone_names, len(thresholds))
    zones = build_heart_rate_zones(
        thresholds,
        labels=labels,
        durations=fetched.activity.icu_hr_zone_times,
    )
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
        average_heart_rate_bpm=_valid_heart_rate(
            activity.average_heartrate, "average_heartrate", activity.id
        ),
        max_heart_rate_bpm=_valid_heart_rate(
            activity.max_heartrate, "max_heartrate", activity.id
        ),
        route_coordinates=route_coordinates,
        samples=samples,
        heart_rate_zones=zones,
        raw_metadata=fetched.raw_activity,
        source_updated_at=activity.source_updated_at,
    )


def select_sport_settings(
    sport: str, settings: Sequence[IntervalsSportSettings]
) -> IntervalsSportSettings | None:
    sport_key = sport.strip().casefold()
    matches = [
        setting
        for setting in settings
        if any(
            isinstance(candidate, str) and candidate.strip().casefold() == sport_key
            for candidate in setting.types
        )
    ]
    if matches:
        if len(matches) > 1:
            logger.warning("Multiple Intervals sport settings match activity type %s", sport)
        return matches[0]

    fallbacks = [setting for setting in settings if setting.other]
    if len(fallbacks) == 1:
        return fallbacks[0]
    if len(fallbacks) > 1:
        logger.warning("Multiple Intervals sport settings are marked as other")
    return None


def build_heart_rate_zones(
    thresholds: list[float],
    *,
    labels: Sequence[str] = (),
    durations: Sequence[Any] | None = None,
) -> list[HeartRateZone]:
    if not thresholds:
        return []

    if durations is not None and len(durations) > len(thresholds):
        logger.warning(
            "Intervals returned %d heart-rate zone times for %d configured zones; "
            "ignoring surplus values",
            len(durations),
            len(thresholds),
        )
    zones: list[HeartRateZone] = []
    previous_max: float | None = None
    for index, maximum in enumerate(thresholds, start=1):
        minimum = previous_max + 1 if previous_max is not None else None
        duration = (
            _valid_duration(durations[index - 1])
            if durations is not None and index <= len(durations)
            else None
        )
        zones.append(
            HeartRateZone.model_validate(
                {
                    "index": index,
                    "label": labels[index - 1] if index <= len(labels) else f"Z{index}",
                    "color": ZONE_COLORS[min(index - 1, len(ZONE_COLORS) - 1)],
                    "minBpm": minimum,
                    "maxBpm": maximum,
                    "durationSeconds": duration,
                }
            )
        )
        previous_max = maximum
    return zones


def heart_rate_zone(heart_rate: int | None, thresholds: list[float]) -> int | None:
    if heart_rate is None or not thresholds:
        return None
    # Intervals returns one maximum per zone. Equality remains in that zone and values above the
    # configured athlete maximum are clamped into the final zone.
    return min(bisect.bisect_left(thresholds, heart_rate) + 1, len(thresholds))


def _validated_thresholds(values: Sequence[Any]) -> list[float]:
    thresholds: list[float] = []
    for value in values:
        if isinstance(value, bool):
            raise IntervalsPayloadError("heart-rate zone thresholds must be positive numbers")
        try:
            numeric = float(value)
        except (TypeError, ValueError) as error:
            raise IntervalsPayloadError(
                "heart-rate zone thresholds must be positive numbers"
            ) from error
        if not math.isfinite(numeric) or numeric <= 0:
            raise IntervalsPayloadError("heart-rate zone thresholds must be positive numbers")
        if thresholds and numeric <= thresholds[-1]:
            raise IntervalsPayloadError("heart-rate zone thresholds must increase")
        thresholds.append(numeric)
    return thresholds


def _zone_labels(values: Sequence[Any], zone_count: int) -> list[str]:
    labels: list[str] = []
    for index in range(zone_count):
        value = values[index] if index < len(values) else None
        label = value.strip() if isinstance(value, str) else ""
        labels.append(label or f"Z{index + 1}")
    return labels


def _valid_duration(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    duration = float(value)
    return duration if math.isfinite(duration) and duration >= 0 else None


def _valid_heart_rate(value: Any, field: str, activity_id: str) -> float | None:
    if value is None:
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        logger.warning("Ignoring invalid %s for activity %s", field, activity_id)
        return None
    if math.isfinite(numeric) and numeric > 0:
        return numeric
    logger.warning("Ignoring invalid %s for activity %s", field, activity_id)
    return None


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
