"""Baseline allocations, and coverage metrics for comparing plans.

Two of the concept paper's four evaluation configurations live here.

B1, `allocate_b1`: forecast-driven greedy top-K. One pooled ranking over every
(kecamatan, resource) candidate by expected people exposed, served from the
nearest feasible depot until stock or crews run out. Crew-aware, but blind to
risk: it sees one expected value per candidate, never a distribution, so it
cannot reason about the tail.

B2, `allocate_baseline`: two single-hazard "agencies" that plan independently
and never coordinate crews. The flood desk allocates pumps first (the acute
hazard always wins the morning briefing); the drought desk then plans trucks and
discovers that shared-depot crews are already committed.

B1 and B2 differ in exactly one thing: whether the two hazards are ranked
together or in sequence. The greedy rule, the demand rounding and the
nearest-depot sourcing are deliberately identical, so B1 vs B2 isolates the
value of pooling the crew pool at all.

B0 needs no function. Reactive dispatch pre-positions nothing, so it is scored
as the empty plan.

SIAGA (B3) is the MILP in allocator.py, which plans both hazards against the
same crew pool at once. `coverage_metrics` scores any plan against the exact
scenario ensemble the MILP optimized over, so all four are comparable
apples-to-apples.
"""

from __future__ import annotations

import math

from .allocator import (
    MAX_TRAVEL_MIN,
    PER_UNIT,
    PROB_KEY,
    RES_LABEL,
    RESOURCES,
    RISK_FLOOR,
    CVAR_ALPHA,
    Depot,
    active_districts,
    haversine_min,
    sample_scenarios,
)

# Flood first: pumps are the acute-hazard response and, uncoordinated, they
# grab depot crews before the slower-moving drought desk plans anything.
PASS_ORDER = ["pompa", "truk_tangki"]
FLEET_ATTR = {"pompa": "pumps", "truk_tangki": "trucks"}


def _finalize(agg: dict, active: list[dict], depots: list[Depot],
              depot_dispatch: dict, status: str, reason_fn) -> dict:
    """Shared plan assembly for the greedy configurations."""
    dmap = {d["district_id"]: d for d in active}
    depmap = {dep.depot_id: dep for dep in depots}

    plan = []
    for (did, r), entry in agg.items():
        d = dmap[did]
        prob_val = d[PROB_KEY[r]]
        pop = int(d["population"])
        lead = max(entry["sources"], key=lambda s: (s["units"], -s["minutes"]))
        dep = depmap[lead["depot_id"]]
        exposed = int(round(prob_val * pop))
        plan.append(
            {
                "district_id": did,
                "district": d["name"],
                "kabupaten": d["kabupaten"],
                "resource": r,
                "resource_label": RES_LABEL[r],
                "units": entry["units"],
                "from_depot": dep.name,
                "minutes": lead["minutes"],
                "hazard_prob": round(prob_val, 3),
                "population": pop,
                "people_exposed": exposed,
                "reason": reason_fn(entry["units"], RES_LABEL[r], d["name"]),
            }
        )
    plan.sort(key=lambda p: -p["people_exposed"])

    dispatched = {
        r: sum(p["units"] for p in plan if p["resource"] == r) for r in RESOURCES
    }
    total_fleet = {
        "pompa": sum(dep.pumps for dep in depots),
        "truk_tangki": sum(dep.trucks for dep in depots),
    }
    used_pct = 100.0 * sum(dispatched.values()) / max(sum(total_fleet.values()), 1)
    return {
        "plan": plan,
        "depot_dispatch": depot_dispatch,
        "summary": {
            "status": status,
            "total_dispatched": dispatched,
            "total_fleet": total_fleet,
            "fleet_used_pct": round(used_pct, 1),
            "n_districts_served": len({p["district_id"] for p in plan}),
            "n_active_districts": len(active),
        },
    }


def _serve_greedy(d: dict, r: str, depots: list[Depot], stock: dict,
                  depot_dispatch: dict, agg: dict) -> None:
    """Take units for one (district, resource) from the nearest depots that
    still have both the resource and a free crew. Mutates stock/agg in place."""
    wanted = math.ceil(d[PROB_KEY[r]] * d["population"] / PER_UNIT[r])
    if wanted <= 0:
        return
    did = d["district_id"]
    feasible = sorted(
        ((haversine_min(dep.lat, dep.lon, d["lat"], d["lon"]), dep) for dep in depots),
        key=lambda t: t[0],
    )
    for minutes, dep in feasible:
        if wanted <= 0:
            break
        if minutes > MAX_TRAVEL_MIN:
            break  # sorted ascending: everything after is too far too
        s = stock[dep.depot_id]
        take = min(wanted, s[r], s["crews"])
        if take <= 0:
            continue
        s[r] -= take
        s["crews"] -= take
        wanted -= take
        depot_dispatch[dep.depot_id][r] += take
        entry = agg.setdefault((did, r), {"units": 0, "sources": []})
        entry["units"] += take
        entry["sources"].append(
            {"depot_id": dep.depot_id, "units": take, "minutes": round(minutes)}
        )


def _fresh_stock(depots: list[Depot]) -> tuple[dict, dict]:
    stock = {
        dep.depot_id: {
            "pompa": dep.pumps,
            "truk_tangki": dep.trucks,
            "crews": dep.crews,
        }
        for dep in depots
    }
    depot_dispatch = {
        dep.depot_id: {"name": dep.name, "pompa": 0, "truk_tangki": 0}
        for dep in depots
    }
    return stock, depot_dispatch


def allocate_b1(districts: list[dict], depots: list[Depot]) -> dict:
    """B1: forecast + greedy top-K over one pooled ranking of both hazards.

    A competent operations team with a forecast in hand and no optimizer. Every
    (kecamatan, resource) candidate is scored by expected people exposed, which
    is comparable across resources because both are measured in people, and the
    single ranked list is served greedily. Crews are shared, so pumps and trucks
    compete, but they compete first-come-first-served by expected value rather
    than by any assessment of risk.
    """
    active = active_districts(districts)
    stock, depot_dispatch = _fresh_stock(depots)
    agg: dict[tuple[str, str], dict] = {}

    candidates = [
        (d[PROB_KEY[r]] * d["population"], d, r)
        for d in active
        for r in RESOURCES
        if d[PROB_KEY[r]] >= RISK_FLOOR
    ]
    # Ties broken by district id then resource so the ranking is deterministic.
    candidates.sort(key=lambda c: (-c[0], c[1]["district_id"], c[2]))

    for _score, d, r in candidates:
        _serve_greedy(d, r, depots, stock, depot_dispatch, agg)

    return _finalize(
        agg, active, depots, depot_dispatch, "Greedy top-K",
        lambda units, label, name: (
            f"greedy top-K: {units} {label} ke {name} berdasarkan paparan harapan"
        ),
    )


def allocate_baseline(districts: list[dict], depots: list[Depot]) -> dict:
    """B2: greedy per-hazard allocation with no crew coordination between
    hazards.

    Returns the same shape as allocator.allocate: {plan, depot_dispatch,
    summary}. Deterministic: no sampling, ties broken by list order.
    """
    active = active_districts(districts)
    stock, depot_dispatch = _fresh_stock(depots)
    agg: dict[tuple[str, str], dict] = {}

    for r in PASS_ORDER:
        pk = PROB_KEY[r]
        ranked = sorted(
            (d for d in active if d[pk] >= RISK_FLOOR),
            key=lambda d: -(d[pk] * d["population"]),
        )
        for d in ranked:
            _serve_greedy(d, r, depots, stock, depot_dispatch, agg)

    return _finalize(
        agg, active, depots, depot_dispatch, "Greedy",
        lambda units, label, name: (
            f"alokasi terpisah: {units} {label} ke {name} "
            f"tanpa koordinasi antarbahaya"
        ),
    )


def coverage_metrics(districts: list[dict], plan: list[dict]) -> dict:
    """Score a plan (people covered / left uncovered) on the shared scenario
    ensemble. Any two plans scored here are directly comparable because
    sample_scenarios is seeded and draw order depends only on the active set.
    """
    active = active_districts(districts)
    scenarios = sample_scenarios(active)

    units: dict[tuple[str, str], int] = {}
    for p in plan:
        key = (p["district_id"], p["resource"])
        units[key] = units.get(key, 0) + int(p["units"])

    uncovered_people = []  # per scenario
    demand_people = []
    for need in scenarios:
        unc = 0.0
        dem = 0.0
        for (did, r), d_units in need.items():
            people = d_units * PER_UNIT[r]
            dem += people
            supplied = units.get((did, r), 0) * PER_UNIT[r]
            unc += max(0.0, people - supplied)
        uncovered_people.append(unc)
        demand_people.append(dem)

    n = len(uncovered_people)
    expected_uncovered = sum(uncovered_people) / n
    expected_demand = sum(demand_people) / n

    # CVaR: mean of the worst (1 - alpha) tail of scenarios. Rank scenarios by
    # uncovered need and take that same set for the demand figure, so tail
    # coverage is a ratio within one set of scenarios. Dividing tail uncovered
    # by mean demand instead compares two different scenario sets and can
    # exceed 100%.
    tail = max(1, math.ceil((1.0 - CVAR_ALPHA) * n))
    order = sorted(range(n), key=lambda w: -uncovered_people[w])[:tail]
    cvar_uncovered = sum(uncovered_people[w] for w in order) / tail
    cvar_demand = sum(demand_people[w] for w in order) / tail

    return {
        "expected_uncovered": int(round(expected_uncovered)),
        "cvar_uncovered": int(round(cvar_uncovered)),
        "expected_covered": int(round(expected_demand - expected_uncovered)),
        "expected_demand": int(round(expected_demand)),
        "cvar_demand": int(round(cvar_demand)),
    }
