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


def test_time_limited_solve_is_flagged_degraded(client, monkeypatch):
    """CBC reports "Optimal" even when it stops on the time limit and returns
    its incumbent, so status alone is not enough. With the real InaLogpal fleet
    the corridor problem is small and no date exhausts the budget, so the guard
    is exercised by forcing a tiny limit: any solve then overruns it and must be
    flagged rather than presented as a proven optimum."""
    from app.services import allocator
    monkeypatch.setattr(allocator, "SOLVE_TIME_LIMIT_S", 0.001)
    b = client.post("/allocate", json={"date": "2024-02-05"}).json()
    assert b["summary"]["hit_time_limit"] is True
    assert "degraded" in b, "a solve that ran out of budget was reported as success"
    assert "budget" in b["degraded"]["reason"]


def test_fast_date_is_not_flagged(client):
    b = client.post("/allocate", json={"date": "2024-02-05"}).json()
    assert b["summary"]["hit_time_limit"] is False
    assert "degraded" not in b


def test_unserved_districts_carry_a_reason(client, plan):
    """The plan explained every line it contained and nothing about the
    hundreds it left out, which is the question an operator in an unserved
    kecamatan actually asks."""
    assert plan["unserved"], "no unserved rows on a date with 300+ active districts"
    reasons = {"di_bawah_ambang", "di_luar_jangkauan", "armada_habis", "kalah_prioritas"}
    for row in plan["unserved"]:
        assert row["reason"] in reasons
        assert row["text"]
    served = {p["district_id"] for p in plan["plan"]}
    assert not (served & {u["district_id"] for u in plan["unserved"]})


def test_unserved_is_sorted_by_exposure(plan):
    """An operator reads the top of this list, so the biggest has to be there."""
    exposed = [u["people_exposed"] for u in plan["unserved"]]
    assert exposed == sorted(exposed, reverse=True)


def test_crew_exhaustion_reason_fires_when_the_pool_is_spent():
    """Crews bind, not vehicles: judging this on fleet_used_pct once called 305
    kecamatan 'outranked' on a date where every crew was committed. The real
    InaLogpal fleet is scarce enough that the 29 corridor crews never fully
    exhaust, so the guard is tested directly: with crews_used == crews_total an
    unserved coastal kecamatan is 'armada_habis', not 'outranked'."""
    from app.services.allocator import explain_unserved
    districts = [{
        "district_id": "X", "name": "Contoh", "kabupaten": "Demak",
        "flood_prob": 0.9, "drought_prob": 0.0, "population": 100_000,
    }]
    active = list(districts)
    rows = explain_unserved(
        districts, active, plan=[], nearest_min={"X": 30.0},
        crews_used=29, crews_total=29,
    )
    assert rows and rows[0]["reason"] == "armada_habis"


def test_spare_crews_means_outranked_not_exhausted(client):
    """The general case with the real fleet: crews remain, so an unserved
    kecamatan is outranked, never fleet-exhausted."""
    b = client.post("/allocate", json={"date": "2019-07-15"}).json()
    s = b["summary"]
    assert s["crews_used"] < s["crews_total"]
    assert b["unserved_counts"].get("kalah_prioritas", 0) > 0
    assert "armada_habis" not in b["unserved_counts"]


def test_default_supply_profile_preserves_evaluated_corridor(client):
    """New supply controls must not silently change the evaluated default."""
    body = client.get("/scenario").json()
    assert body["supply_profile"]["key"] == "corridor"
    assert body["supply_profile"]["evaluation_status"] == "historically_evaluated"
    assert len(body["depots"]) == 14
    assert sum(d["fleet"]["pompa"] for d in body["depots"]) == 22
    assert sum(d["fleet"]["truk_tangki"] for d in body["depots"]) == 9


def test_provincial_inventory_is_confirmation_gated(client):
    regional = client.get(
        "/scenario", params={"supply_scope": "regional"}
    ).json()
    assert regional["depots"]
    assert all(d["tier"] != "provincial_reserve" for d in regional["depots"])

    provincial = client.get(
        "/scenario", params={"supply_scope": "provincial"}
    ).json()
    reserves = [d for d in provincial["depots"] if d["tier"] == "provincial_reserve"]
    assert reserves == []
    assert len(provincial["provincial_reserves"]) == 3

    selected_id = provincial["provincial_reserves"][0]["depot_id"]
    confirmed = client.get("/scenario", params={
        "supply_scope": "provincial",
        "confirmed_provincial_depot_ids": selected_id,
    }).json()
    reserves = [d for d in confirmed["depots"] if d["tier"] == "provincial_reserve"]
    assert [d["depot_id"] for d in reserves] == [selected_id]
    assert len({d["depot_id"] for d in provincial["depots"]}) == len(
        provincial["depots"]
    )


def test_provincial_confirmation_rejects_unknown_depot(client):
    response = client.post("/allocate", json={
        "date": DATE,
        "supply_scope": "provincial",
        "confirmed_provincial_depot_ids": ["DEP-NOT-REAL"],
    })
    assert response.status_code == 422


def test_operational_controls_are_applied_and_reported(client):
    body = client.post("/allocate", json={
        "date": DATE,
        "locks": [],
        "rejects": [],
        "supply_scope": "regional",
        "availability_pct": 70,
        "max_travel_min": 90,
    }).json()
    assert body["supply_profile"]["key"] == "regional"
    assert body["operational_settings"]["availability_pct"] == 70
    assert body["operational_settings"]["max_travel_min"] == 90
    assert all(item["minutes"] <= 90 for item in body["plan"])
    assert all(item["source_tier"] in {"local", "regional"} for item in body["plan"])


def test_unknown_supply_scope_is_rejected(client):
    response = client.post("/allocate", json={
        "date": DATE,
        "supply_scope": "automatic_national_dispatch",
    })
    assert response.status_code == 422
