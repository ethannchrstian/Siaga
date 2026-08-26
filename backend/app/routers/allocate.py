import time

import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services import scenario
from app.services.allocator import allocate
from app.services.baseline import allocate_baseline, coverage_metrics

router = APIRouter()

RESOURCES = {"pompa", "truk_tangki"}

# CBC returns a status string per solve. Only the first is a plan an operator
# should act on; the rest must be visible to the caller rather than dressed up
# as success.
GOOD_STATUS = "Optimal"


class Lock(BaseModel):
    district_id: str
    resource: str
    units: int = Field(ge=0)


class Reject(BaseModel):
    district_id: str
    resource: str


class AllocateRequest(BaseModel):
    date: str | None = None
    locks: list[Lock] = []
    rejects: list[Reject] = []
    supply_scope: str = "corridor"
    availability_pct: int = Field(default=100, ge=25, le=100)
    max_travel_min: int = Field(default=180, ge=60, le=180)
    confirmed_provincial_depot_ids: list[str] = []


def _validate(req: AllocateRequest, records: list[dict]) -> None:
    """Reject bad input with 422 before the solver ever runs.

    A lock naming a district that does not exist, or a resource the depots do
    not stock, silently does nothing inside the MILP. The operator would see a
    plan that quietly ignored their override, which is worse than an error.
    """
    known = {r["district_id"] for r in records}
    if req.supply_scope not in scenario.SUPPLY_SCOPES:
        raise HTTPException(
            422,
            f"unknown supply_scope: {req.supply_scope}. "
            f"expected one of {sorted(scenario.SUPPLY_SCOPES)}",
        )
    confirmed = set(req.confirmed_provincial_depot_ids)
    unknown = confirmed - scenario.known_provincial_reserve_ids()
    if unknown:
        raise HTTPException(
            422, f"unknown provincial reserve depot_id: {sorted(unknown)}"
        )
    if confirmed and req.supply_scope != "provincial":
        raise HTTPException(
            422, "confirmed provincial reserves require supply_scope='provincial'"
        )
    for kind, items in (("lock", req.locks), ("reject", req.rejects)):
        for it in items:
            if it.district_id not in known:
                raise HTTPException(
                    422, f"unknown district_id in {kind}: {it.district_id}")
            if it.resource not in RESOURCES:
                raise HTTPException(
                    422,
                    f"unknown resource in {kind}: {it.resource}. "
                    f"expected one of {sorted(RESOURCES)}")


@router.post("/allocate")
def allocate_endpoint(req: AllocateRequest):
    """Solve pre-positioning for a date. Locks/rejects are sent by the client
    each time (the endpoint is stateless) so the plan re-optimizes around the
    operator's decisions."""
    t0 = time.perf_counter()

    if req.date is not None:
        try:
            pd.Timestamp(req.date)
        except (ValueError, TypeError):
            raise HTTPException(422, f"invalid date: {req.date!r}, expected YYYY-MM-DD")

    try:
        ts, records = scenario.risk_records(req.date)
    except (KeyError, IndexError, ValueError) as exc:
        raise HTTPException(422, f"no risk data for {req.date!r}: {exc}")
    t_risk = time.perf_counter()

    _validate(req, records)

    confirmed_ids = tuple(sorted(set(req.confirmed_provincial_depot_ids)))
    depots = list(scenario.depots(
        req.supply_scope, req.availability_pct, confirmed_ids
    ))
    try:
        result = allocate(
            records,
            depots,
            locks=[l.model_dump() for l in req.locks],
            rejects=[r.model_dump() for r in req.rejects],
            max_travel_min=req.max_travel_min,
        )
    except Exception as exc:  # solver blew up rather than returned a bad status
        raise HTTPException(503, f"solver failed: {exc}")
    t_solve = time.perf_counter()

    result["date"] = str(ts.date())
    supply = scenario.supply_view(
        req.supply_scope, req.availability_pct, confirmed_ids
    )
    result["supply_profile"] = supply["profile"]
    result["operational_settings"] = {
        "availability_pct": req.availability_pct,
        "max_travel_min": req.max_travel_min,
        "travel_time_method": "haversine_at_40_kmh",
        "crew_source": "scenario_assumption",
        "confirmed_provincial_depot_ids": list(confirmed_ids),
    }

    # An infeasible or timed-out solve still returns a plan-shaped object. Flag
    # it so the interface can refuse to present it as a dispatchable plan, and
    # hand back the greedy baseline as something the operator can still work
    # from.
    summary = result.get("summary", {})
    status = summary.get("status", "Unknown")
    timed_out = bool(summary.get("hit_time_limit"))
    if status != GOOD_STATUS or timed_out:
        reason = (
            f"solver consumed its full {summary.get('solve_seconds')} s budget, "
            "so the plan is the best incumbent rather than a proven optimum"
            if timed_out
            else f"solver returned {status!r}, not {GOOD_STATUS!r}"
        )
        result["degraded"] = {
            "reason": reason,
            "advice": "treat the ranked plan as indicative and fall back to the "
                      "baseline below; locks may be over-constraining the fleet",
        }

    # Counterfactual: the paper's B2 config (independent per-hazard allocation,
    # no crew coordination). Ignores locks/rejects by design — it is the world
    # without SIAGA. Both plans are scored on the same scenario ensemble.
    baseline = allocate_baseline(
        records, depots, max_travel_min=req.max_travel_min
    )
    siaga_metrics = coverage_metrics(records, result["plan"])
    baseline_metrics = coverage_metrics(records, baseline["plan"])
    result["baseline"] = baseline
    result["comparison"] = {
        "siaga": siaga_metrics,
        "baseline": baseline_metrics,
        "delta_protected": (
            baseline_metrics["expected_uncovered"]
            - siaga_metrics["expected_uncovered"]
        ),
        "delta_cvar": (
            baseline_metrics["cvar_uncovered"] - siaga_metrics["cvar_uncovered"]
        ),
    }
    t_end = time.perf_counter()

    # Published so the "re-solves in about N seconds" claim is measured on the
    # real request path rather than asserted. ml/run_latency.py aggregates this.
    result["timing_ms"] = {
        "risk_lookup": round((t_risk - t0) * 1000, 1),
        "solve": round((t_solve - t_risk) * 1000, 1),
        "baseline_and_metrics": round((t_end - t_solve) * 1000, 1),
        "total": round((t_end - t0) * 1000, 1),
    }
    return result
