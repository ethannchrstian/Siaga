from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.services import scenario
from app.services.allocator import allocate

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
    result = allocate(
        records,
        list(scenario.depots()),
        locks=[l.model_dump() for l in req.locks],
        rejects=[r.model_dump() for r in req.rejects],
    )
    result["date"] = str(ts.date())
    return result
