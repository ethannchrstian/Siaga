"""Baseline allocator + comparison-metric invariants. Run: pytest tests/ -q."""

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.services.allocator import active_districts, allocate, sample_scenarios  # noqa: E402
from app.services.baseline import (  # noqa: E402
    allocate_b1,
    allocate_baseline,
    coverage_metrics,
)
from tests.test_allocator import load_scenario  # noqa: E402

PRESET_DATES = ["2015-02-19", "2023-09-15", "2024-01-15"]

# Every configuration that produces a plan has to respect the same fleet.
GREEDY_CONFIGS = [allocate_b1, allocate_baseline]


@pytest.mark.parametrize("alloc", GREEDY_CONFIGS)
def test_baseline_respects_capacity(alloc):
    districts, depots = load_scenario()
    res = alloc(districts, depots)
    fleet = {"pompa": 0, "truk_tangki": 0}
    for dep in depots:
        fleet["pompa"] += dep.pumps
        fleet["truk_tangki"] += dep.trucks
    for r in ("pompa", "truk_tangki"):
        assert res["summary"]["total_dispatched"][r] <= fleet[r]
    # per-depot: outflow never exceeds that depot's stock or crews
    depmap = {dep.depot_id: dep for dep in depots}
    for dep_id, dd in res["depot_dispatch"].items():
        dep = depmap[dep_id]
        assert dd["pompa"] <= dep.pumps
        assert dd["truk_tangki"] <= dep.trucks
        assert dd["pompa"] + dd["truk_tangki"] <= dep.crews


@pytest.mark.parametrize("alloc", GREEDY_CONFIGS)
def test_greedy_configs_are_deterministic(alloc):
    """B1 and B2 sample nothing, so repeated calls must agree exactly. The
    hindcast compares configurations date by date and would be meaningless if
    a baseline drifted between runs."""
    districts, depots = load_scenario()
    assert alloc(districts, depots) == alloc(districts, depots)


def test_b1_pools_both_hazards_into_one_ranking():
    """B1 differs from B2 in one thing only: both hazards are ranked together
    rather than flood-first. When the fleet is scarce enough to bind, that has
    to be able to produce a different plan, otherwise the comparison in the
    paper measures nothing."""
    districts, depots = load_scenario("2024-07-04")
    b1 = allocate_b1(districts, depots)
    b2 = allocate_baseline(districts, depots)
    assert b1["plan"] != b2["plan"]


def test_b0_is_the_empty_plan():
    """B0 pre-positions nothing, so it covers nobody and every unit of realized
    demand goes unmet. This anchors the bottom of the comparison table."""
    districts, _ = load_scenario()
    m = coverage_metrics(districts, [])
    assert m["expected_covered"] == 0
    assert m["expected_uncovered"] == m["expected_demand"]


def test_scenarios_are_reproducible():
    districts, _ = load_scenario()
    active = active_districts(districts)
    a = sample_scenarios(active)
    b = sample_scenarios(active)
    assert a == b, "same active set must yield identical scenario draws"


def test_coverage_metrics_shape_and_sanity():
    districts, depots = load_scenario()
    res = allocate_baseline(districts, depots)
    m = coverage_metrics(districts, res["plan"])
    for k in ("expected_uncovered", "cvar_uncovered", "expected_covered", "expected_demand"):
        assert k in m and m[k] >= 0
    assert m["cvar_uncovered"] >= m["expected_uncovered"]
    assert m["expected_covered"] + m["expected_uncovered"] == pytest.approx(
        m["expected_demand"], abs=2
    )
    # an empty plan covers nobody
    empty = coverage_metrics(districts, [])
    assert empty["expected_covered"] == 0
    assert empty["expected_uncovered"] == empty["expected_demand"]


@pytest.mark.parametrize("date", PRESET_DATES)
def test_siaga_beats_baseline_on_presets(date):
    """The headline demo claim: on every preset date the coupled plan protects
    at least as many people (in expectation AND in the CVaR tail)."""
    districts, depots = load_scenario(date)
    siaga = allocate(districts, depots)
    base = allocate_baseline(districts, depots)
    ms = coverage_metrics(districts, siaga["plan"])
    mb = coverage_metrics(districts, base["plan"])
    assert mb["expected_uncovered"] >= ms["expected_uncovered"], (
        f"{date}: baseline uncovered {mb['expected_uncovered']} < "
        f"siaga {ms['expected_uncovered']}"
    )
    assert mb["cvar_uncovered"] >= ms["cvar_uncovered"]


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-q", "-s"]))
