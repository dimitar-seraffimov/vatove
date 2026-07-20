from __future__ import annotations

from typing import Any

import pytest
from pydantic import TypeAdapter

from vatove_worker.intervals import FetchedActivity, IntervalsPayloadError, parse_map_payload
from vatove_worker.normalize import heart_rate_zone, normalize_activity
from vatove_worker.schemas import IntervalsActivity, IntervalsStream


def fetched_from_fixtures(fixture_json: Any) -> FetchedActivity:
    raw_detail = fixture_json("activity_detail.json")
    return FetchedActivity(
        activity=IntervalsActivity.model_validate(raw_detail),
        raw_activity=raw_detail,
        map_points=parse_map_payload(fixture_json("activity_map.json")),
        streams=TypeAdapter(list[IntervalsStream]).validate_python(
            fixture_json("activity_streams.json")
        ),
    )


def test_normalization_aligns_map_source_indices_and_streams(fixture_json: Any) -> None:
    activity = normalize_activity(fetched_from_fixtures(fixture_json))

    assert activity.route_coordinates == [
        (-0.1246, 51.5007),
        (-0.12, 51.5015),
        (-0.115, 51.503),
    ]
    persisted_samples = [sample.model_dump(by_alias=True) for sample in activity.samples]
    assert [sample["sourceIndex"] for sample in persisted_samples] == [0, 2, 4]
    assert [sample["elapsedSeconds"] for sample in persisted_samples] == [0.0, 10.0, 20.0]
    assert [sample["heartRateZone"] for sample in persisted_samples] == [1, 3, 5]
    assert len(activity.route_coordinates) == len(activity.samples)
    assert len(activity.heart_rate_zones) == 5
    assert activity.heart_rate_zones[-1].min_bpm == 180
    assert activity.heart_rate_zones[-1].max_bpm is None


def test_missing_heart_rate_produces_neutral_route(fixture_json: Any) -> None:
    fetched = fetched_from_fixtures(fixture_json)
    fetched = FetchedActivity(
        fetched.activity.model_copy(update={"icu_hr_zones": []}),
        fetched.raw_activity,
        fetched.map_points,
        [stream for stream in fetched.streams if stream.type != "heartrate"],
    )
    activity = normalize_activity(fetched)
    assert all(sample.heart_rate_bpm is None for sample in activity.samples)
    assert all(sample.heart_rate_zone is None for sample in activity.samples)
    assert activity.heart_rate_zones == []


def test_missing_elevation_keeps_route_with_null_elevation(fixture_json: Any) -> None:
    fetched = fetched_from_fixtures(fixture_json)
    fetched = FetchedActivity(
        fetched.activity,
        fetched.raw_activity,
        fetched.map_points,
        [stream for stream in fetched.streams if stream.type != "altitude"],
    )
    activity = normalize_activity(fetched)
    assert activity.route_coordinates
    assert all(sample.elevation_meters is None for sample in activity.samples)


def test_fewer_than_two_coordinates_is_list_only(fixture_json: Any) -> None:
    fetched = fetched_from_fixtures(fixture_json)
    fetched = FetchedActivity(
        fetched.activity, fetched.raw_activity, fetched.map_points[:1], fetched.streams
    )
    activity = normalize_activity(fetched)
    assert activity.route_coordinates == []
    assert activity.samples == []


def test_unaligned_stream_lengths_fail_instead_of_silent_zip(fixture_json: Any) -> None:
    fetched = fetched_from_fixtures(fixture_json)
    broken = [
        stream.model_copy(update={"data": stream.data[:-1]})
        if stream.type == "altitude"
        else stream
        for stream in fetched.streams
    ]
    with pytest.raises(IntervalsPayloadError, match="matching lengths"):
        normalize_activity(
            FetchedActivity(fetched.activity, fetched.raw_activity, fetched.map_points, broken)
        )


def test_heart_rate_at_boundary_enters_next_zone() -> None:
    assert heart_rate_zone(140, [120, 140, 160]) == 3
    assert heart_rate_zone(999, [120, 140, 160]) == 4
    assert heart_rate_zone(None, [120, 140, 160]) is None
