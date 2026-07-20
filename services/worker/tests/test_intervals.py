from __future__ import annotations

import base64
from collections.abc import Callable
from datetime import date
from typing import Any

import httpx
import pytest

from vatove_worker.intervals import (
    IntervalsAuthenticationError,
    IntervalsClient,
    IntervalsPayloadError,
    map_points_from_streams,
    parse_map_payload,
    retry_after_seconds,
)
from vatove_worker.schemas import IntervalsStream


class FakeTime:
    def __init__(self) -> None:
        self.current = 0.0
        self.sleeps: list[float] = []

    def clock(self) -> float:
        return self.current

    def sleep(self, delay: float) -> None:
        self.sleeps.append(delay)
        self.current += delay


def make_client(
    handler: Callable[[httpx.Request], httpx.Response],
    fake_time: FakeTime,
    *,
    retries: int = 1,
) -> IntervalsClient:
    transport = httpx.MockTransport(handler)
    http_client = httpx.Client(
        base_url="https://intervals.example",
        transport=transport,
        auth=httpx.BasicAuth("API_KEY", "secret-key"),
        headers={"User-Agent": "Mozilla/5.0 vatove-test"},
    )
    return IntervalsClient(
        base_url="https://intervals.example",
        api_key="secret-key",
        user_agent="Mozilla/5.0 vatove-test",
        requests_per_second=8,
        max_retries=retries,
        client=http_client,
        clock=fake_time.clock,
        sleep=fake_time.sleep,
    )


def test_fetch_activity_uses_basic_auth_and_expected_endpoints(fixture_json: Any) -> None:
    responses = {
        "/api/v1/activity/i9001": fixture_json("activity_detail.json"),
        "/api/v1/activity/i9001/streams.json": fixture_json("activity_streams.json"),
    }
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json=responses[request.url.path])

    client = make_client(handler, FakeTime())
    fetched = client.fetch_activity("i9001")

    assert fetched.activity.id == "i9001"
    assert [point.source_index for point in fetched.map_points] == [0, 2, 4]
    assert all(point.source_index_explicit for point in fetched.map_points)
    assert [request.url.path for request in requests] == [
        "/api/v1/activity/i9001",
        "/api/v1/activity/i9001/streams.json",
    ]
    assert requests[-1].url.params["types"] == "time,distance,heartrate,altitude,latlng"
    expected = "Basic " + base64.b64encode(b"API_KEY:secret-key").decode()
    assert all(request.headers["Authorization"] == expected for request in requests)
    assert all("Mozilla/5.0" in request.headers["User-Agent"] for request in requests)


def test_fetch_activity_allows_an_activity_without_a_route(fixture_json: Any) -> None:
    responses = {
        "/api/v1/activity/i9001": fixture_json("activity_detail.json"),
        "/api/v1/activity/i9001/streams.json": [
            {"type": "time", "data": [0, 5]},
            {"type": "heartrate", "data": [100, 105]},
        ],
    }

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=responses[request.url.path])

    fetched = make_client(handler, FakeTime()).fetch_activity("i9001")

    assert fetched.map_points == []


def test_latlng_stream_requires_paired_longitudes() -> None:
    with pytest.raises(IntervalsPayloadError, match="missing longitude"):
        map_points_from_streams([IntervalsStream(type="latlng", data=[51.5])])


def test_429_obeys_retry_after_before_retry(fixture_json: Any) -> None:
    calls = 0
    fake_time = FakeTime()

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            return httpx.Response(429, headers={"Retry-After": "3"})
        return httpx.Response(200, json=fixture_json("activities.json"))

    client = make_client(handler, fake_time)
    result = client.list_activities(date(2026, 7, 1), date(2026, 7, 20))

    assert result[0].id == "i9001"
    assert calls == 2
    assert 3.0 in fake_time.sleeps


def test_authentication_errors_do_not_expose_response_body() -> None:
    fake_time = FakeTime()

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text="secret-key was invalid")

    client = make_client(handler, fake_time)
    with pytest.raises(IntervalsAuthenticationError) as caught:
        client.list_activities(date(2026, 7, 1), date(2026, 7, 20))
    assert "secret-key" not in str(caught.value)


def test_changed_map_shape_fails_validation() -> None:
    with pytest.raises(IntervalsPayloadError):
        parse_map_payload({"unexpected": [[51.5, -0.1]]})


def test_retry_after_supports_delta_seconds() -> None:
    assert retry_after_seconds("2.5") == 2.5
    assert retry_after_seconds("not-a-date") is None
