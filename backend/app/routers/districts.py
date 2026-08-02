import json
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, HTTPException

router = APIRouter()

DATA = Path(__file__).resolve().parents[2] / "data" / "districts.geojson"


@lru_cache(maxsize=1)
def _load() -> dict:
    if not DATA.exists():
        raise FileNotFoundError(
            f"{DATA} missing. Run: python ml/build_districts.py"
        )
    return json.loads(DATA.read_text(encoding="utf-8"))


@router.get("/districts")
def districts() -> dict:
    """Corridor kecamatan boundaries (GeoJSON FeatureCollection)."""
    try:
        return _load()
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=str(e))
