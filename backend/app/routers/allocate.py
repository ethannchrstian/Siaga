from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.services import scenario
from app.services.allocator import allocate
from app.services.baseline import allocate_baseline, coverage_metrics

router = APIRouter()


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


@router.post("/allocate")
def allocate_endpoint(req: AllocateRequest):
    """Solve pre-positioning for a date. Locks/rejects are sent by the client
    each time (the endpoint is stateless) so the plan re-optimizes around the
    operator's decisions."""
    ts, records = scenario.risk_records(req.date)
    depots = list(scenario.depots())
    result = allocate(
        records,
        depots,
        locks=[l.model_dump() for l in req.locks],
        rejects=[r.model_dump() for r in req.rejects],
    )
    result["date"] = str(ts.date())

    # Counterfactual: the paper's B2 config (independent per-hazard allocation,
    # no crew coordination). Ignores locks/rejects by design — it is the world
    # without SIAGA. Both plans are scored on the same scenario ensemble.
    baseline = allocate_baseline(records, depots)
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
    return result
