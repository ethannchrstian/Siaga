from fastapi import APIRouter, Query

from app.services import scenario

router = APIRouter()


@router.get("/risk")
def risk(date: str | None = Query(default=None, description="YYYY-MM-DD")):
    """Per-district flood and water-stress probabilities for a date.
    Defaults to the latest available date; snaps to the nearest if the exact
    date is missing."""
    ts, records = scenario.risk_records(date)
    lo, hi = scenario.date_bounds()
    return {
        "date": str(ts.date()),
        "date_min": lo,
        "date_max": hi,
        "districts": [
            {
                "district_id": r["district_id"],
                "name": r["name"],
                "kabupaten": r["kabupaten"],
                "population": int(r["population"]),
                "flood_prob": round(r["flood_prob"], 4),
                "drought_prob": round(r["drought_prob"], 4),
            }
            for r in records
        ],
    }


@router.get("/scenario")
def scenario_info():
    """Depots, fleet, resource labels, and the available date range."""
    raw = scenario.depots_raw()
    lo, hi = scenario.date_bounds()
    return {
        "date_min": lo,
        "date_max": hi,
        "resources": raw["resources"],
        "resource_labels": raw["resource_labels"],
        "note": raw["_note"],
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
