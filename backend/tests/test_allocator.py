"""Allocator sanity + invariant tests. Run: pytest tests/ -q  (from backend/)."""

import json
import sys
import time
from pathlib import Path

import geopandas as gpd
import pandas as pd
import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.services.allocator import Depot, allocate  # noqa: E402

DATA = BACKEND / "data"


def load_scenario(date: str = "2023-09-15"):
    gj = gpd.read_file(DATA / "districts.geojson")
    cent = gj.geometry.to_crs(32748).centroid.to_crs(4326)
    gj = gj.assign(lat=cent.y, lon=cent.x)
    pop = pd.read_csv(DATA / "population.csv")
    risk = pd.read_parquet(DATA / "risk_history.parquet")
    day = risk[risk["date"] == pd.Timestamp(date)]

    df = (
        gj.merge(pop, on="district_id")
        .merge(day[["district_id", "flood_prob", "drought_prob"]], on="district_id")
    )
    districts = [
        {
            "district_id": r["district_id"],
            "name": r["name"],
            "kabupaten": r["kabupaten"],
            "lat": float(r["lat"]),
            "lon": float(r["lon"]),
            "population": float(r["population"]),
            "flood_prob": float(r["flood_prob"]),
            "drought_prob": float(r["drought_prob"]),
        }
        for r in df.to_dict("records")
    ]

    dj = json.loads((DATA / "depots.json").read_text())
    depots = [
        Depot(
            depot_id=d["depot_id"],
            name=d["name"],
            lat=d["lat"],
            lon=d["lon"],
            trucks=d["fleet"]["truk_tangki"],
            pumps=d["fleet"]["pompa"],
            crews=d["fleet"]["regu"],
        )
        for d in dj["depots"]
    ]
    return districts, depots


def test_produces_plan_within_budget():
    districts, depots = load_scenario()
    t0 = time.time()
    res = allocate(districts, depots)
    elapsed = time.time() - t0
    assert res["summary"]["status"] == "Optimal"
    assert res["plan"], "expected a non-empty plan"
    assert elapsed < 30, f"solve took {elapsed:.1f}s"

    # Never dispatch more than the fleet of any resource.
    disp = res["summary"]["total_dispatched"]
    fleet = res["summary"]["total_fleet"]
    for r in ("pompa", "truk_tangki"):
        assert disp[r] <= fleet[r]


def test_crew_coupling_respected():
    districts, depots = load_scenario()
    res = allocate(districts, depots)
    # Total units dispatched cannot exceed total crews (one crew per unit).
    total_units = sum(res["summary"]["total_dispatched"].values())
    total_crews = sum(dep.crews for dep in depots)
    assert total_units <= total_crews


def test_reject_removes_allocation():
    districts, depots = load_scenario()
    base = allocate(districts, depots)
    assert base["plan"]
    top = base["plan"][0]
    rejected = allocate(
        districts,
        depots,
        rejects=[{"district_id": top["district_id"], "resource": top["resource"]}],
    )
    still = [
        p
        for p in rejected["plan"]
        if p["district_id"] == top["district_id"] and p["resource"] == top["resource"]
    ]
    assert not still, "rejected district-resource should get nothing"


def test_lock_forces_units():
    districts, depots = load_scenario()
    base = allocate(districts, depots)
    top = base["plan"][0]
    locked = allocate(
        districts,
        depots,
        locks=[{"district_id": top["district_id"], "resource": top["resource"], "units": 3}],
    )
    got = sum(
        p["units"]
        for p in locked["plan"]
        if p["district_id"] == top["district_id"] and p["resource"] == top["resource"]
    )
    assert got == 3


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-q", "-s"]))
