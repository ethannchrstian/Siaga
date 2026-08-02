"""Two-stage stochastic pre-positioning with a CVaR objective.

This is the decision layer from the paper. Given per-district hazard
probabilities, it decides how to pre-position a limited fleet of water trucks and
flood pumps from BPBD depots, before we know which hazards actually materialize.

Formulation (deterministic-equivalent MILP, solved with CBC via PuLP):

  Stage 1 (here-and-now): x[d,i,r] = integer units of resource r sent from
    depot d to district i. Pre-positioned stock at i is p[i,r] = sum_d x[d,i,r].

  Stage 2 (recourse, per sampled scenario w): a district's realized need
    D[i,r,w] is served from its local pre-positioned stock; the shortfall
    u[i,r,w] = max(D[i,r,w] - p[i,r], 0) carries an unmet-need penalty.

  Objective: minimize  E_w[cost] + beta * CVaR_alpha[cost] + small travel cost,
    where cost in scenario w is the vulnerability-weighted unmet need. CVaR is
    linearized with the Rockafellar-Uryasev auxiliary variables (eta, z_w).

Coupling that makes the two hazards compete: every dispatched unit, whether a
pump or a truck, consumes one crew (regu) from its depot, and crews are limited.
So sending pumps to a flooding kecamatan directly reduces the trucks available
for a drought-stricken one, out of the same pool.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import pulp

# Demo service factors (documented, not fitted): how many people one unit covers.
PEOPLE_PER_PUMP = 8000
PEOPLE_PER_TRUCK = 3000
SPEED_KMH = 40.0
MAX_TRAVEL_MIN = 180.0     # feasibility cutoff depot -> district
RISK_FLOOR = 0.05          # ignore districts below this on both hazards
N_SCENARIOS = 30
CVAR_ALPHA = 0.90
CVAR_BETA = 2.0
TRAVEL_WEIGHT = 0.001      # tiny tie-breaker preferring closer depots
SEED = 42


@dataclass
class Depot:
    depot_id: str
    name: str
    lat: float
    lon: float
    trucks: int
    pumps: int
    crews: int


def haversine_min(lat1, lon1, lat2, lon2) -> float:
    r = 6371.0
    p = math.pi / 180
    a = (
        0.5
        - math.cos((lat2 - lat1) * p) / 2
        + math.cos(lat1 * p)
        * math.cos(lat2 * p)
        * (1 - math.cos((lon2 - lon1) * p))
        / 2
    )
    km = 2 * r * math.asin(math.sqrt(a))
    return km / SPEED_KMH * 60.0


def _expected_need(prob: float, pop: float, per_unit: int) -> float:
    return prob * pop / per_unit


def allocate(
    districts: list[dict],
    depots: list[Depot],
    locks: list[dict] | None = None,
    rejects: list[dict] | None = None,
) -> dict:
    """districts: [{district_id, name, kabupaten, lat, lon, population,
                    flood_prob, drought_prob}]
       locks:   [{district_id, resource, units}]  force this exact allocation
       rejects: [{district_id, resource}]          forbid any allocation
    """
    locks = locks or []
    rejects = rejects or []
    rng = np.random.default_rng(SEED)

    # Keep only districts with meaningful risk; the rest need nothing today.
    active = [
        d
        for d in districts
        if d["flood_prob"] >= RISK_FLOOR or d["drought_prob"] >= RISK_FLOOR
    ]
    if not active:
        return {"plan": [], "summary": _empty_summary(depots)}

    resources = ["pompa", "truk_tangki"]
    prob_key = {"pompa": "flood_prob", "truk_tangki": "drought_prob"}
    per_unit = {"pompa": PEOPLE_PER_PUMP, "truk_tangki": PEOPLE_PER_TRUCK}
    fleet_attr = {"pompa": "pumps", "truk_tangki": "trucks"}

    # Feasible depot->district pairs within the travel cutoff, with minutes.
    tmin = {}
    for i, d in enumerate(active):
        for dep in depots:
            m = haversine_min(dep.lat, dep.lon, d["lat"], d["lon"])
            if m <= MAX_TRAVEL_MIN:
                tmin[(dep.depot_id, d["district_id"])] = m

    reject_set = {(r["district_id"], r["resource"]) for r in rejects}
    lock_map = {(l["district_id"], l["resource"]): int(l["units"]) for l in locks}

    prob = pulp.LpProblem("prepositioning", pulp.LpMinimize)

    # Stage-1 vars x[d,i,r].
    x = {}
    for dep in depots:
        for d in active:
            for r in resources:
                key = (dep.depot_id, d["district_id"], r)
                if (dep.depot_id, d["district_id"]) not in tmin:
                    continue
                if (d["district_id"], r) in reject_set:
                    continue
                # Don't send a resource where its own hazard is negligible
                # (e.g. pumps into a district with 1% flood risk).
                if d[prob_key[r]] < RISK_FLOOR:
                    continue
                x[key] = pulp.LpVariable(
                    f"x_{dep.depot_id}_{d['district_id']}_{r}",
                    lowBound=0,
                    cat="Integer",
                )

    def prepositioned(did, r):
        return pulp.lpSum(
            x[(dep.depot_id, did, r)]
            for dep in depots
            if (dep.depot_id, did, r) in x
        )

    # Depot capacity per resource, and the shared crew coupling.
    for dep in depots:
        for r in resources:
            cap = getattr(dep, fleet_attr[r])
            prob += (
                pulp.lpSum(
                    x[(dep.depot_id, d["district_id"], r)]
                    for d in active
                    if (dep.depot_id, d["district_id"], r) in x
                )
                <= cap
            )
        # one crew per dispatched unit, either resource -> competition
        prob += (
            pulp.lpSum(
                x[(dep.depot_id, d["district_id"], r)]
                for d in active
                for r in resources
                if (dep.depot_id, d["district_id"], r) in x
            )
            <= dep.crews
        )

    # Locks: force the district-resource total.
    for (did, r), units in lock_map.items():
        if any((dep.depot_id, did, r) in x for dep in depots):
            prob += prepositioned(did, r) == units

    # Sample scenarios: hazard occurrence per district, with random severity.
    scenarios = []
    for _ in range(N_SCENARIOS):
        need = {}
        for d in active:
            for r in resources:
                p = d[prob_key[r]]
                occ = rng.random() < p
                sev = rng.uniform(0.5, 1.0) if occ else 0.0
                need[(d["district_id"], r)] = _expected_need(
                    1.0, d["population"], per_unit[r]
                ) * sev
        scenarios.append(need)

    # Vulnerability weight: larger population -> heavier unmet penalty (proxy
    # for people at stake); keeps the optimizer from abandoning big districts.
    maxpop = max(d["population"] for d in active) or 1.0
    vuln = {d["district_id"]: 1.0 + d["population"] / maxpop for d in active}

    # Stage-2 unmet vars + per-scenario cost.
    eta = pulp.LpVariable("eta")
    z = [pulp.LpVariable(f"z_{w}", lowBound=0) for w in range(N_SCENARIOS)]
    scen_cost_terms = []
    for w, need in enumerate(scenarios):
        cost_terms = []
        for d in active:
            for r in resources:
                did = d["district_id"]
                D = need[(did, r)]
                if D <= 1e-9:
                    continue
                u = pulp.LpVariable(f"u_{w}_{did}_{r}", lowBound=0)
                prob += u >= D - prepositioned(did, r)
                cost_terms.append(vuln[did] * u)
        cw = pulp.lpSum(cost_terms)
        scen_cost_terms.append(cw)
        prob += z[w] >= cw - eta

    expected_cost = pulp.lpSum(scen_cost_terms) / N_SCENARIOS
    cvar = eta + pulp.lpSum(z) / ((1 - CVAR_ALPHA) * N_SCENARIOS)
    travel_cost = pulp.lpSum(
        tmin[(dep.depot_id, d["district_id"])] * x[(dep.depot_id, d["district_id"], r)]
        for dep in depots
        for d in active
        for r in resources
        if (dep.depot_id, d["district_id"], r) in x
    )
    prob += expected_cost + CVAR_BETA * cvar + TRAVEL_WEIGHT * travel_cost

    prob.solve(pulp.PULP_CBC_CMD(msg=0, timeLimit=25))

    return _extract_plan(prob, x, active, depots, resources, tmin, per_unit, prob_key)


RES_LABEL = {"pompa": "pompa banjir", "truk_tangki": "truk tangki air"}


def _empty_summary(depots) -> dict:
    return {
        "status": "Optimal",
        "total_dispatched": {"pompa": 0, "truk_tangki": 0},
        "fleet_used_pct": 0.0,
        "n_districts_served": 0,
    }


def _extract_plan(prob, x, active, depots, resources, tmin, per_unit, prob_key):
    status = pulp.LpStatus[prob.status]
    dmap = {d["district_id"]: d for d in active}
    depmap = {dep.depot_id: dep for dep in depots}

    # Aggregate x by (district, resource); remember the depot each unit came from.
    agg: dict[tuple[str, str], dict] = {}
    for (dep_id, did, r), var in x.items():
        units = int(round(var.value() or 0))
        if units <= 0:
            continue
        entry = agg.setdefault((did, r), {"units": 0, "sources": []})
        entry["units"] += units
        entry["sources"].append(
            {"depot_id": dep_id, "units": units, "minutes": round(tmin[(dep_id, did)])}
        )

    plan = []
    for (did, r), entry in agg.items():
        d = dmap[did]
        prob_val = d[prob_key[r]]
        pop = int(d["population"])
        # Nearest contributing depot leads the explanation line.
        nearest = min(entry["sources"], key=lambda s: s["minutes"])
        dep = depmap[nearest["depot_id"]]
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
                "minutes": nearest["minutes"],
                "hazard_prob": round(prob_val, 3),
                "population": pop,
                "people_exposed": exposed,
                "reason": (
                    f"kirim {entry['units']} {RES_LABEL[r]} ke {d['name']}: "
                    f"{prob_val * 100:.0f}% peluang "
                    f"{'banjir' if r == 'pompa' else 'cekaman air'} dalam horizon, "
                    f"{nearest['minutes']} mnt dari {dep.name}, "
                    f"{exposed:,} jiwa terpapar".replace(",", ".")
                ),
            }
        )

    # Rank by people exposed (what an operator scans first).
    plan.sort(key=lambda p: -p["people_exposed"])

    dispatched = {r: sum(p["units"] for p in plan if p["resource"] == r) for r in resources}
    total_fleet = {
        "pompa": sum(dep.pumps for dep in depots),
        "truk_tangki": sum(dep.trucks for dep in depots),
    }
    used_pct = 100.0 * sum(dispatched.values()) / max(sum(total_fleet.values()), 1)

    return {
        "plan": plan,
        "summary": {
            "status": status,
            "total_dispatched": dispatched,
            "total_fleet": total_fleet,
            "fleet_used_pct": round(used_pct, 1),
            "n_districts_served": len({p["district_id"] for p in plan}),
            "n_active_districts": len(active),
        },
    }
