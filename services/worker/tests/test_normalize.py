from __future__ import annotations

from typing import Any

import pytest
from pydantic import TypeAdapter

from vatove_worker.intervals import FetchedActivity, IntervalsPayloadError, parse_map_payload
from vatove_worker.normalize import heart_rate_zone, normalize_activity, select_sport_settings
from vatove_worker.schemas import IntervalsActivity, IntervalsSportSettings, IntervalsStream


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


def settings_from_fixtures(fixture_json: Any) -> list[IntervalsSportSettings]:
    return TypeAdapter(list[IntervalsSportSettings]).validate_python(
        fixture_json("sport_settings.json")
    )


def test_normalization_aligns_map_source_indices_and_streams(fixture_json: Any) -> None:
    fetched = fetched_from_fixtures(fixture_json)
    fetched = FetchedActivity(
        fetched.activity.model_copy(
            update={
                "average_heartrate": 146.2,
                "max_heartrate": 181.0,
                "icu_hr_zone_times": [120, 480, 1380, 900],
            }
        ),
        fetched.raw_activity,
        fetched.map_points,
        fetched.streams,
    )
    activity = normalize_activity(fetched, settings_from_fixtures(fixture_json))

    assert activity.route_coordinates == [
        (-0.1246, 51.5007),
        (-0.12, 51.5015),
        (-0.115, 51.503),
    ]
    persisted_samples = [sample.model_dump(by_alias=True) for sample in activity.samples]
    assert [sample["sourceIndex"] for sample in persisted_samples] == [0, 2, 4]
    assert [sample["elapsedSeconds"] for sample in persisted_samples] == [0.0, 10.0, 20.0]
    assert [sample["heartRateZone"] for sample in persisted_samples] == [1, 2, 4]
    assert [sample["speedMetersPerSecond"] for sample in persisted_samples] == [2.5, 3.6, 4.2]
    assert len(activity.route_coordinates) == len(activity.samples)
    assert len(activity.heart_rate_zones) == 4
    assert [zone.label for zone in activity.heart_rate_zones] == [
        "Recovery",
        "Endurance",
        "Tempo",
        "Threshold",
    ]
    assert activity.heart_rate_zones[-1].min_bpm == 161
    assert activity.heart_rate_zones[-1].max_bpm == 180
    assert [zone.duration_seconds for zone in activity.heart_rate_zones] == [
        120,
        480,
        1380,
        900,
    ]
    assert activity.average_heart_rate_bpm == 146.2
    assert activity.max_heart_rate_bpm == 181


def test_missing_heart_rate_produces_neutral_route(fixture_json: Any) -> None:
    fetched = fetched_from_fixtures(fixture_json)
    fetched = FetchedActivity(
        fetched.activity,
        fetched.raw_activity,
        fetched.map_points,
        [stream for stream in fetched.streams if stream.type != "heartrate"],
    )
    activity = normalize_activity(fetched, [])
    assert all(sample.heart_rate_bpm is None for sample in activity.samples)
    assert all(sample.heart_rate_zone is None for sample in activity.samples)
    assert [zone.max_bpm for zone in activity.heart_rate_zones] == [120, 140, 160, 180]


def test_missing_elevation_keeps_route_with_null_elevation(fixture_json: Any) -> None:
    fetched = fetched_from_fixtures(fixture_json)
    fetched = FetchedActivity(
        fetched.activity,
        fetched.raw_activity,
        fetched.map_points,
        [stream for stream in fetched.streams if stream.type != "altitude"],
    )
    activity = normalize_activity(fetched, settings_from_fixtures(fixture_json))
    assert activity.route_coordinates
    assert all(sample.elevation_meters is None for sample in activity.samples)


def test_fewer_than_two_coordinates_is_list_only(fixture_json: Any) -> None:
    fetched = fetched_from_fixtures(fixture_json)
    fetched = FetchedActivity(
        fetched.activity, fetched.raw_activity, fetched.map_points[:1], fetched.streams
    )
    activity = normalize_activity(fetched, settings_from_fixtures(fixture_json))
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
            FetchedActivity(fetched.activity, fetched.raw_activity, fetched.map_points, broken),
            settings_from_fixtures(fixture_json),
        )


def test_heart_rate_at_boundary_remains_in_zone_and_above_max_clamps() -> None:
    assert heart_rate_zone(140, [120, 140, 160]) == 2
    assert heart_rate_zone(999, [120, 140, 160]) == 3
    assert heart_rate_zone(None, [120, 140, 160]) is None


def test_unknown_sport_uses_unique_other_setting(fixture_json: Any) -> None:
    settings = settings_from_fixtures(fixture_json)
    assert select_sport_settings("Kayak", settings) is settings[1]


def test_activity_zone_snapshot_survives_a_missing_sport_settings_match(
    fixture_json: Any,
) -> None:
    fetched = fetched_from_fixtures(fixture_json)
    activity = normalize_activity(
        fetched,
        [IntervalsSportSettings(types=["Run"], hr_zones=[100, 120])],
    )

    assert [zone.max_bpm for zone in activity.heart_rate_zones] == [120, 140, 160, 180]
    assert [sample.heart_rate_zone for sample in activity.samples] == [1, 2, 4]


def test_malformed_zone_settings_do_not_fail_activity(fixture_json: Any) -> None:
    fetched = fetched_from_fixtures(fixture_json)
    fetched = FetchedActivity(
        fetched.activity.model_copy(update={"icu_hr_zones": []}),
        fetched.raw_activity,
        fetched.map_points,
        fetched.streams,
    )
    invalid = IntervalsSportSettings(
        types=["Ride"],
        hr_zones=[120, "bad", 180],
        hr_zone_names=["One", "Two", "Three"],
    )

    activity = normalize_activity(fetched, [invalid])

    assert activity.heart_rate_zones == []
    assert all(sample.heart_rate_zone is None for sample in activity.samples)


def test_invalid_and_missing_zone_times_become_null(fixture_json: Any) -> None:
    fetched = fetched_from_fixtures(fixture_json)
    fetched = FetchedActivity(
        fetched.activity.model_copy(update={"icu_hr_zone_times": [10, -1, "bad", 40, 50]}),
        fetched.raw_activity,
        fetched.map_points,
        fetched.streams,
    )

    activity = normalize_activity(fetched, settings_from_fixtures(fixture_json))

    assert [zone.duration_seconds for zone in activity.heart_rate_zones] == [10, None, None, 40]
