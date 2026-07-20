from __future__ import annotations

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import OperationalError

import vatove_worker.database as database_module
from vatove_worker.database import (
    REQUIRED_SCHEMA_REVISION,
    DatabaseSchemaError,
    assert_schema_compatible,
)


def schema_engine(
    *,
    revision: str = REQUIRED_SCHEMA_REVISION,
    include_average_heart_rate: bool = True,
    include_max_heart_rate: bool = True,
) -> Engine:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    columns = ["id TEXT PRIMARY KEY"]
    if include_average_heart_rate:
        columns.append("average_heart_rate_bpm FLOAT")
    if include_max_heart_rate:
        columns.append("max_heart_rate_bpm FLOAT")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE alembic_version (version_num TEXT NOT NULL)"))
        connection.execute(
            text("INSERT INTO alembic_version (version_num) VALUES (:revision)"),
            {"revision": revision},
        )
        connection.execute(text(f"CREATE TABLE activities ({', '.join(columns)})"))
    return engine


def test_schema_compatibility_accepts_required_revision_and_columns() -> None:
    engine = schema_engine()

    assert_schema_compatible(engine)


def test_schema_compatibility_rejects_old_revision_with_migration_hint() -> None:
    engine = schema_engine(revision="20260720_0001")

    with pytest.raises(DatabaseSchemaError) as captured:
        assert_schema_compatible(engine)

    message = str(captured.value)
    assert REQUIRED_SCHEMA_REVISION in message
    assert "Run database migrations" in message
    assert "20260720_0001" not in message


def test_schema_compatibility_detects_required_columns_even_when_revision_is_stamped() -> None:
    engine = schema_engine(include_average_heart_rate=False)

    with pytest.raises(DatabaseSchemaError) as captured:
        assert_schema_compatible(engine)

    message = str(captured.value)
    assert "average_heart_rate_bpm" in message
    assert "max_heart_rate_bpm" not in message
    assert "Run database migrations" in message


def test_schema_compatibility_rejects_missing_migration_state() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")

    with pytest.raises(DatabaseSchemaError) as captured:
        assert_schema_compatible(engine)

    assert str(captured.value).startswith("Database migration state is missing.")


def test_schema_inspection_failure_suppresses_database_exception_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeInspector:
        def has_table(self, _: str) -> bool:
            return True

    class BrokenEngine:
        def connect(self) -> None:
            raise OperationalError(
                "SELECT private_statement",
                {"credential": "DATABASE_PASSWORD"},
                RuntimeError("PRIVATE_DRIVER_DETAIL"),
            )

    monkeypatch.setattr(database_module, "inspect", lambda _: FakeInspector())

    with pytest.raises(DatabaseSchemaError) as captured:
        assert_schema_compatible(BrokenEngine())  # type: ignore[arg-type]

    assert "Database schema could not be verified" in str(captured.value)
    assert captured.value.__suppress_context__ is True
    for unsafe_value in ("private_statement", "DATABASE_PASSWORD", "PRIVATE_DRIVER_DETAIL"):
        assert unsafe_value not in str(captured.value)
