"""Operator overrides, recorded server-side.

Every Kunci and Alihkan is a person with local knowledge telling the optimizer
it is wrong about a specific kecamatan on a specific date. Until now that went
to the browser's localStorage and died there: lost on a different machine,
never visible to anyone else, never available as evidence.

This records it. What it deliberately does not do is retrain anything. A few
dozen overrides are not a training set, and a model that quietly learns from
whoever clicked most is worse than one that does not learn at all. The value is
in the pattern: when operators keep overruling the same kecamatan, and radar
independently flags that kecamatan as a blind spot, two unrelated sources agree
the model is wrong there.

Storage is a JSONL file, appended one line per decision. Note that the deploy
target has no persistent disk, so the log resets on redeploy; it is a record of
a session, not an archive, and must not be described as one.
"""

from __future__ import annotations

import json
import threading
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()

LOG = Path(__file__).resolve().parents[2] / "data" / "decisions.jsonl"

# Mirrors DecisionKind in frontend/src/decisionLog.ts. Kept as an explicit set
# so a typo from a stale client is rejected rather than silently stored.
KINDS = {
    "lock", "unlock", "reject", "clear_reject", "clear_all_locks", "date_change",
    "supply_scope_change", "provincial_support_requested",
    "provincial_support_confirmed", "provincial_support_cancelled",
    "operational_assumption_change",
}

MAX_RETURN = 500

# Appends are tiny but concurrent requests would still interleave lines.
_lock = threading.Lock()


class Decision(BaseModel):
    kind: str
    date: str
    district_id: str | None = None
    district: str | None = None
    resource: str | None = None
    units: int | None = Field(default=None, ge=0)
    operator: str = Field(default="Operator Pusdalops", max_length=80)
    note: str | None = Field(default=None, max_length=280)


@router.post("/decisions", status_code=201)
def record(decision: Decision) -> dict:
    """Append one override. The client also keeps its own copy, so a failure
    here must never cost the operator their decision."""
    if decision.kind not in KINDS:
        raise HTTPException(422, f"unknown decision kind {decision.kind!r}")

    entry = decision.model_dump()
    entry["at"] = datetime.now(timezone.utc).isoformat()

    LOG.parent.mkdir(parents=True, exist_ok=True)
    with _lock, LOG.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return {"recorded": True, "at": entry["at"]}


def _read(limit: int = MAX_RETURN) -> list[dict]:
    if not LOG.exists():
        return []
    out: list[dict] = []
    with LOG.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                # A truncated final line after an interrupted write should not
                # take the whole endpoint down.
                continue
    return out[-limit:]


@router.get("/decisions")
def listing(limit: int = MAX_RETURN) -> dict:
    """Recent overrides, plus which kecamatan draw the most of them.

    `contested` is the part worth reading: a kecamatan the operator keeps
    overruling is a place the optimizer's inputs are probably wrong.
    """
    entries = _read(limit)
    overrides = [e for e in entries if e.get("kind") in {"lock", "reject"}]
    counts = Counter(
        e["district"] for e in overrides if e.get("district")
    )
    return {
        "total": len(entries),
        "overrides": len(overrides),
        "contested": [
            {"district": name, "count": n} for name, n in counts.most_common(10)
        ],
        "entries": entries[-50:],
    }
