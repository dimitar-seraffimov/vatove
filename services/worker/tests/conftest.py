from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import pytest

WORKER_ROOT = Path(__file__).resolve().parents[1]
SRC = WORKER_ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))


@pytest.fixture
def fixture_json() -> Any:
    def load(name: str) -> Any:
        return json.loads((Path(__file__).parent / "fixtures" / name).read_text("utf-8"))

    return load

