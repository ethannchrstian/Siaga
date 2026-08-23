from fastapi import APIRouter, HTTPException, Query

from app.services import rob as rob_svc
from app.services import scenario

router = APIRouter()

MAX_RANGE_DAYS = 60


@router.get("/risk/range")
def risk_range(
    start: str = Query(description="YYYY-MM-DD"),
    end: str = Query(description="YYYY-MM-DD"),
):
    """Per-district probability series over a window (hindcast replay).
    Capped so a typo can't request a decade of daily data."""
    import pandas as pd

    try:
        lo, hi = pd.Timestamp(start), pd.Timestamp(end)
    except ValueError:
        raise HTTPException(422, "invalid date")
    if hi < lo:
        raise HTTPException(422, "end before start")
    if (hi - lo).days > MAX_RANGE_DAYS:
        raise HTTPException(422, f"range capped at {MAX_RANGE_DAYS} days")
    return scenario.risk_range(start, end)


@router.get("/risk/district/{district_id}")
def district_series(
    district_id: str,
    days: int = Query(default=60, ge=7, le=180),
    end: str | None = Query(default=None, description="YYYY-MM-DD"),
):
    """Risk history for one district, `days` back from `end` (default latest).
    `end` should be the operator's selected date so the chart never shows the
    future relative to the hindcast."""
    import pandas as pd

    r = scenario.risk_history()
    hi = pd.Timestamp(end) if end else r["date"].max()
    lo = hi - pd.Timedelta(days=days)
    win = r[
        (r["district_id"] == district_id) & (r["date"] >= lo) & (r["date"] <= hi)
    ].sort_values("date")
    return {
        "district_id": district_id,
        "dates": [str(d.date()) for d in win["date"]],
        "flood": [round(float(v), 3) for v in win["flood_prob"]],
        "drought": [round(float(v), 3) for v in win["drought_prob"]],
    }


@router.get("/risk")
def risk(date: str | None = Query(default=None, description="YYYY-MM-DD")):
    """Per-district flood and water-stress probabilities for a date.
    Defaults to the latest available date; snaps to the nearest if the exact
    date is missing."""
    ts, records = scenario.risk_records(date)
    lo, hi = scenario.date_bounds()
    # Radar is an optional layer keyed by calendar month, not by day. When it
    # is absent or the date falls outside coverage this is simply empty and
    # every other field is unaffected.
    rob = rob_svc.rob_on(ts)
    return {
        "date": str(ts.date()),
        "date_min": lo,
        "date_max": hi,
        "rob_available": bool(rob),
        "rob_month": rob_svc.observed_month(ts),
        "districts": [
            {
                "district_id": r["district_id"],
                "name": r["name"],
                "kabupaten": r["kabupaten"],
                "population": int(r["population"]),
                "flood_prob": round(r["flood_prob"], 4),
                "drought_prob": round(r["drought_prob"], 4),
                # False for the six kecamatan with no modelled river. Their
                # probabilities are zero because nothing was computed, not
                # because anything was found to be safe.
                "modeled": bool(r["modeled"]),
                # Canonical exposure. Computed here from full-precision
                # probabilities so every screen shows one number: recomputing
                # it client-side from the rounded probs above lands ~20 people
                # off and made two pages disagree about the same kecamatan.
                "people_exposed": int(
                    round(
                        max(r["flood_prob"], r["drought_prob"]) * int(r["population"])
                    )
                ),
                # Observed water from radar, and whether it contradicts the
                # flood model. Null when this district has no usable radar
                # coverage for the month.
                "rob": rob.get(r["district_id"]),
                "rob_blind_spot": rob_svc.blind_spot(
                    rob.get(r["district_id"]), r["flood_prob"]
                ),
            }
            for r in records
        ],
    }


@router.get("/scenario")
def scenario_info():
    """Depots, fleet, resource labels, the date range, and how well the
    hazard models are actually calibrated.

    The calibration block is served so the interface can say what a
    probability has historically meant instead of presenting it as certainty.
    A dashboard that shows 86% without mentioning that 86% verified at 69% on
    held-out years is overstating what the model knows.
    """
    raw = scenario.depots_raw()
    lo, hi = scenario.date_bounds()
    return {
        "date_min": lo,
        "date_max": hi,
        "resources": raw["resources"],
        "resource_labels": raw["resource_labels"],
        "note": raw["_note"],
        "calibration": scenario.calibration(),
        "depots": [
            {
                "depot_id": d["depot_id"],
                "name": d["name"],
                "lat": d["lat"],
                "lon": d["lon"],
                "fleet": d["fleet"],
            }
            for d in raw["depots"]
        ],
    }
