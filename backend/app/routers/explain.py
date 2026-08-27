"""Plain-language explanation of the current plan. Read-only over the optimizer.

The frontend already holds the solved plan, so it posts the relevant facts here
rather than making the server re-solve the MILP. The endpoint grounds the model
in exactly those facts and returns prose; it changes no allocation and writes no
state.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.routers import auth
from app.services import llm

router = APIRouter()

MAX_QUESTION = 300


class ExplainRequest(BaseModel):
    date: str
    question: str | None = Field(default=None, max_length=MAX_QUESTION)
    summary: dict = {}
    plan: list[dict] = []
    unserved: list[dict] = []
    comparison: dict = {}
    supply_profile: dict = {}


@router.get("/explain/status")
def status() -> dict:
    """Lets the interface hide the panel when no key is configured."""
    return {"available": llm.is_configured(), "model": llm.MODEL}


@router.post("/explain")
def explain(req: ExplainRequest, session: dict = Depends(auth.require_session)) -> dict:
    if not llm.is_configured(session.get("role")):
        raise HTTPException(503, "Fitur penjelasan AI belum dikonfigurasi.")

    ctx = {
        "date": req.date,
        "summary": req.summary,
        "plan": req.plan,
        "unserved": req.unserved,
        "comparison": req.comparison,
        "supply_profile": req.supply_profile,
    }
    question = (req.question or "").strip() or None
    try:
        return llm.explain(ctx, question, actor=session)
    except llm.DemoLimitError as e:
        raise HTTPException(429, str(e)) from e
    except llm.LLMError as e:
        # 502: the request was fine, the upstream model was the problem.
        raise HTTPException(502, str(e)) from e
