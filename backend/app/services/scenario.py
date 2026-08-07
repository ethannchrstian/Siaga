"""Shared, cached access to the corridor data: district metadata + centroids,
population, precomputed risk history, and the depot fleet. Routers build on this.
"""

import json
from functools import lru_cache
from pathlib import Path

import pandas as pd

from app.services.allocator import Depot

DATA = Path(__file__).resolve().parents[1].parent / "data"


@lru_cache(maxsize=1)
def district_meta() -> pd.DataFrame:
    """Kecamatan metadata plus one centroid each, for depot travel times.

    Centroids come from a precomputed CSV rather than being derived from the
    GeoJSON at request time. They never change, and computing them here meant
    importing geopandas, which pulls GDAL into the production image for no
    runtime benefit. Regenerate with: python ml/build_centroids.py
    """
    meta = pd.read_csv(
        DATA / "district_centroids.csv",
        usecols=["district_id", "name", "kabupaten", "provinsi", "lat", "lon"],
    )
    pop = pd.read_csv(DATA / "population.csv")
    return meta.merge(pop, on="district_id", how="left").fillna({"population": 0})


@lru_cache(maxsize=1)
def risk_history() -> pd.DataFrame:
    df = pd.read_parquet(DATA / "risk_history.parquet")
    df["date"] = pd.to_datetime(df["date"])
    return df


@lru_cache(maxsize=1)
def depots_raw() -> dict:
    return json.loads((DATA / "depots.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def depots() -> tuple[Depot, ...]:
    return tuple(
        Depot(
            depot_id=d["depot_id"],
            name=d["name"],
            lat=d["lat"],
            lon=d["lon"],
            trucks=d["fleet"]["truk_tangki"],
            pumps=d["fleet"]["pompa"],
            crews=d["fleet"]["regu"],
        )
        for d in depots_raw()["depots"]
    )


@lru_cache(maxsize=1)
def date_bounds() -> tuple[str, str]:
    r = risk_history()
    return str(r["date"].min().date()), str(r["date"].max().date())


def _nearest_available_date(date: str | None) -> pd.Timestamp:
    r = risk_history()
    if date is None:
        return r["date"].max()
    ts = pd.Timestamp(date)
    exact = r[r["date"] == ts]
    if len(exact):
        return ts
    # snap to the closest available date
    uniq = r["date"].drop_duplicates().sort_values()
    idx = (uniq - ts).abs().idxmin()
    return uniq.loc[idx]


def risk_on(date: str | None = None) -> tuple[pd.Timestamp, pd.DataFrame]:
    """District metadata joined with flood/drought probability for a date.
    Districts without a modeled river (no flood row) get flood_prob 0."""
    ts = _nearest_available_date(date)
    r = risk_history()
    day = r[r["date"] == ts][["district_id", "flood_prob", "drought_prob"]]
    merged = district_meta().merge(day, on="district_id", how="left")
    merged["flood_prob"] = merged["flood_prob"].fillna(0.0)
    merged["drought_prob"] = merged["drought_prob"].fillna(0.0)
    return ts, merged


def risk_records(date: str | None = None) -> tuple[pd.Timestamp, list[dict]]:
    ts, df = risk_on(date)
    cols = [
        "district_id", "name", "kabupaten", "lat", "lon",
        "population", "flood_prob", "drought_prob",
    ]
    return ts, df[cols].to_dict("records")


def risk_range(start: str, end: str) -> dict:
    """Compact per-district series over [start, end] for the hindcast replay:
    one fetch instead of one request per day. Missing districts (no modeled
    river) are zero-filled, mirroring risk_on."""
    r = risk_history()
    lo, hi = pd.Timestamp(start), pd.Timestamp(end)
    window = r[(r["date"] >= lo) & (r["date"] <= hi)]
    meta = district_meta()
    dates = sorted(window["date"].drop_duplicates())
    district_ids = list(meta["district_id"])

    # Reindex both axes and fill gaps before serializing. A partially modeled
    # district/day previously leaked NaN into the JSON response, which browsers
    # reject and made replay appear to do nothing.
    flood = (
        window.pivot_table(index="district_id", columns="date", values="flood_prob")
        .reindex(index=district_ids, columns=dates)
        .fillna(0.0)
    )
    drought = (
        window.pivot_table(index="district_id", columns="date", values="drought_prob")
        .reindex(index=district_ids, columns=dates)
        .fillna(0.0)
    )

    districts = []
    for did in district_ids:
        districts.append(
            {
                "district_id": did,
                "flood": [round(float(flood.at[did, dt]), 3) for dt in dates],
                "drought": [round(float(drought.at[did, dt]), 3) for dt in dates],
            }
        )
    return {"dates": [str(dt.date()) for dt in dates], "districts": districts}
