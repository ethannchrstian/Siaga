"""Contract tests for POST /allocate. Run: pytest tests/ -q  (from backend/).

The endpoint used to have no error handling at all: a malformed date returned
500, an override naming a district that does not exist was silently dropped,
and a solve that came back infeasible or timed out still produced a
plan-shaped body the interface rendered as success. These tests pin the fixed
behaviour so it cannot regress.
"""

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.main import app  # noqa: E402
from app.routers.allocate import RESOURCES  # noqa: E402

DATE = "2024-02-05"          # inside the Demak flood window, a busy day
DISTRICT = "IDN.10.8.12_1"   # Kec. Sayung, Demak


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


@pytest.fixture(scope="module")
def plan(client):
    r = client.post("/allocate", json={"date": DATE})
    assert r.status_code == 200
    return r.json()


def test_valid_date_returns_a_plan(plan):
    assert plan["date"] == DATE
    assert isinstance(plan["plan"], list)
    assert plan["summary"]["status"] == "Optimal"
    assert "degraded" not in plan


def test_malformed_date_is_422_not_500(client):
    r = client.post("/allocate", json={"date": "not-a-date"})
    assert r.status_code == 422
    assert "invalid date" in r.json()["detail"]


def test_unknown_district_in_lock_is_rejected(client):
    r = client.post("/allocate", json={
        "date": DATE,
        "locks": [{"district_id": "NO_SUCH_DISTRICT", "resource": "pompa", "units": 2}],
    })
    assert r.status_code == 422
    assert "unknown district_id" in r.json()["detail"]


def test_unknown_resource_is_rejected(client):
    r = client.post("/allocate", json={
        "date": DATE,
        "locks": [{"district_id": DISTRICT, "resource": "helicopter", "units": 2}],
    })
    assert r.status_code == 422
    assert "unknown resource" in r.json()["detail"]


def test_reject_list_is_validated_too(client):
    r = client.post("/allocate", json={
        "date": DATE,
        "rejects": [{"district_id": "NO_SUCH_DISTRICT", "resource": "pompa"}],
    })
    assert r.status_code == 422


def test_negative_units_rejected_by_schema(client):
    r = client.post("/allocate", json={
        "date": DATE,
        "locks": [{"district_id": DISTRICT, "resource": "pompa", "units": -1}],
    })
    assert r.status_code == 422


def test_known_resources_are_the_two_the_depots_stock():
    assert RESOURCES == {"pompa", "truk_tangki"}


def test_response_carries_measured_timing(plan):
    """The 'about N seconds' claim has to come from somewhere auditable."""
    t = plan["timing_ms"]
    assert set(t) == {"risk_lookup", "solve", "baseline_and_metrics", "total"}
    assert t["total"] > 0
    # total should account for the stages, allowing for rounding
    assert t["total"] >= t["solve"] - 1


def test_lock_is_honoured_in_the_returned_plan(client, plan):
    """An override the operator sets must actually appear in the re-solved plan,
    which is the failure the district validation above exists to prevent."""
    if not plan["plan"]:
        pytest.skip("no recommendations on this date")
    top = plan["plan"][0]
    lock = {"district_id": top["district_id"], "resource": top["resource"],
            "units": int(top["units"])}
    r = client.post("/allocate", json={"date": DATE, "locks": [lock]})
    assert r.status_code == 200
    got = [
        p for p in r.json()["plan"]
        if p["district_id"] == lock["district_id"] and p["resource"] == lock["resource"]
    ]
    assert got, "locked line vanished from the plan"
    assert sum(p["units"] for p in got) >= lock["units"]


def test_baseline_counterfactual_is_present(plan):
    """The B2 two-desk comparison is what the impact claim rests on."""
    assert "baseline" in plan
    for key in ("siaga", "baseline", "delta_protected", "delta_cvar"):
        assert key in plan["comparison"]


def test_time_limited_solve_is_flagged_degraded(client):
    """CBC reports "Optimal" even when it stops on the time limit and returns
    its incumbent, so status alone is not enough. 2015-11-15 is the one date in
    a 60-date sample that consumes the full budget, on only 26 active
    districts, and it must not be presented as a proven optimum."""
    b = client.post("/allocate", json={"date": "2015-11-15"}).json()
    s = b["summary"]
    assert s["hit_time_limit"] is True
    assert "degraded" in b, "a solve that ran out of budget was reported as success"
    assert "budget" in b["degraded"]["reason"]


def test_fast_date_is_not_flagged(client):
    b = client.post("/allocate", json={"date": "2024-02-05"}).json()
    assert b["summary"]["hit_time_limit"] is False
    assert "degraded" not in b
