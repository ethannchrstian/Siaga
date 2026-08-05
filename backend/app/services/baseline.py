"""Uncoordinated baseline allocation, and coverage metrics for comparing plans.

This is configuration B2 from the concept paper's evaluation design: two
single-hazard "agencies" that plan independently and never coordinate crews.
The flood desk allocates pumps first (the acute hazard always wins the morning
briefing); the drought desk then plans trucks and discovers that shared-depot
crews are already committed. Both passes are greedy: rank districts by expected
exposure, serve from the nearest feasible depot until stock or crews run out.

SIAGA's MILP (allocator.py) plans both hazards against the same crew pool at
once; `coverage_metrics` scores any plan against the exact scenario ensemble
the MILP optimized over, so the two plans are comparable apples-to-apples.
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


def allocate_baseline(districts: list[dict], depots: list[Depot]) -> dict:
    """Greedy per-hazard allocation with no crew coordination between hazards.

    Returns the same shape as allocator.allocate: {plan, depot_dispatch,
    summary}. Deterministic: no sampling, ties broken by list order.
    """
    active = active_districts(districts)

    stock = {
        dep.depot_id: {
            "pompa": dep.pumps,
            "truk_tangki": dep.trucks,
            "crews": dep.crews,
        }
        for dep in depots
    }
    depmap = {dep.depot_id: dep for dep in depots}
    depot_dispatch = {
        dep.depot_id: {"name": dep.name, "pompa": 0, "truk_tangki": 0}
        for dep in depots
    }

    # (district_id, resource) -> {units, sources: [{depot_id, units, minutes}]}
    agg: dict[tuple[str, str], dict] = {}

    for r in PASS_ORDER:
        pk = PROB_KEY[r]
        per = PER_UNIT[r]
        ranked = sorted(
            (d for d in active if d[pk] >= RISK_FLOOR),
            key=lambda d: -(d[pk] * d["population"]),
        )
        for d in ranked:
            did = d["district_id"]
            # Same demand rounding the MILP effectively targets: units to cover
            # the expected exposed population.
            wanted = math.ceil(d[pk] * d["population"] / per)
            if wanted <= 0:
                continue
            feasible = sorted(
                (
                    (haversine_min(dep.lat, dep.lon, d["lat"], d["lon"]), dep)
                    for dep in depots
                ),
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

    dmap = {d["district_id"]: d for d in active}
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
                "reason": (
                    f"alokasi terpisah: {entry['units']} {RES_LABEL[r]} ke "
                    f"{d['name']} tanpa koordinasi antarbahaya"
                ),
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
            "status": "Greedy",
            "total_dispatched": dispatched,
            "total_fleet": total_fleet,
            "fleet_used_pct": round(used_pct, 1),
            "n_districts_served": len({p["district_id"] for p in plan}),
            "n_active_districts": len(active),
        },
    }


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
    # CVaR: mean of the worst (1 - alpha) tail of scenarios.
    tail = max(1, math.ceil((1.0 - CVAR_ALPHA) * n))
    worst = sorted(uncovered_people, reverse=True)[:tail]
    cvar_uncovered = sum(worst) / len(worst)

    return {
        "expected_uncovered": int(round(expected_uncovered)),
        "cvar_uncovered": int(round(cvar_uncovered)),
        "expected_covered": int(round(expected_demand - expected_uncovered)),
        "expected_demand": int(round(expected_demand)),
    }
