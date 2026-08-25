"""Shared, cached access to the corridor data: district metadata + centroids,
population, precomputed risk history, and the depot fleet. Routers build on this.
"""

import json
import copy
import math
from functools import lru_cache
from pathlib import Path

import pandas as pd

from app.services.allocator import Depot

DATA = Path(__file__).resolve().parents[1].parent / "data"

SUPPLY_SCOPES = {"corridor", "regional", "provincial"}
SUPPLY_TIERS = {
    "corridor": {"local"},
    "regional": {"local", "regional"},
    "provincial": {"local", "regional", "provincial_reserve"},
}


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


@lru_cache(maxsize=3)
def provincial_reserve_rows() -> list[dict]:
    """All province-owned InaLogpal records, whether activated or not."""
    raw = json.loads((DATA / "depots.expanded.json").read_text(encoding="utf-8"))
    return [d for d in raw["depots"] if d.get("tier") == "provincial_reserve"]


def known_provincial_reserve_ids() -> frozenset[str]:
    return frozenset(d["depot_id"] for d in provincial_reserve_rows())


def supply_raw(
    supply_scope: str = "corridor",
    confirmed_provincial_depot_ids: tuple[str, ...] = (),
) -> dict:
    """Registered inventory for one operational supply scope.

    The corridor file is retained byte-for-byte as the evaluated profile. The
    expanded file is filtered by tier, so provincial stock cannot accidentally
    enter a plan merely because it exists in InaLogpal.
    """
    if supply_scope not in SUPPLY_SCOPES:
        raise ValueError(f"unknown supply scope: {supply_scope}")
    if supply_scope == "corridor":
        raw = depots_raw()
        raw = copy.deepcopy(raw)
        for d in raw["depots"]:
            d.setdefault("tier", "local")
            d.setdefault("inventory_status", "registered_unconfirmed")
            d.setdefault("location_accuracy", "kabupaten_centroid")
        raw.setdefault("profile", {
            "key": "corridor",
            "label": "Inventaris koridor",
            "evaluation_status": "historically_evaluated",
        })
        return raw

    path = DATA / "depots.expanded.json"
    raw = json.loads(path.read_text(encoding="utf-8"))
    allowed = SUPPLY_TIERS[supply_scope]
    confirmed = set(confirmed_provincial_depot_ids)
    raw["depots"] = [
        d for d in raw["depots"]
        if d.get("tier") in allowed
        and (
            d.get("tier") != "provincial_reserve"
            or d["depot_id"] in confirmed
        )
    ]
    raw["profile"] = {
        "key": supply_scope,
        "label": (
            "Koridor + depot regional"
            if supply_scope == "regional"
            else (
                f"Koridor + regional + {len(confirmed)} dukungan provinsi"
                if confirmed
                else "Koridor + depot regional"
            )
        ),
        "evaluation_status": "exploratory",
    }
    return raw


def _available_units(registered: int, availability_pct: int) -> int:
    # Round halves upward (Python's round uses banker's rounding). A registered
    # single unit at 50% therefore remains one planning unit, rather than
    # disappearing because 0.5 rounded to the even number zero.
    return int(math.floor(registered * availability_pct / 100.0 + 0.5))


def supply_view(
    supply_scope: str = "corridor",
    availability_pct: int = 100,
    confirmed_provincial_depot_ids: tuple[str, ...] = (),
) -> dict:
    """API-facing inventory with registered and scenario-available counts."""
    if not 25 <= availability_pct <= 100:
        raise ValueError("availability_pct must be between 25 and 100")
    raw = copy.deepcopy(supply_raw(supply_scope, confirmed_provincial_depot_ids))
    for d in raw["depots"]:
        registered = dict(d["fleet"])
        d["registered_fleet"] = registered
        d["fleet"] = {
            key: _available_units(int(value), availability_pct)
            for key, value in registered.items()
        }
        d["availability_pct"] = availability_pct
        d["crew_source"] = "scenario_assumption"
    return raw


@lru_cache(maxsize=24)
def depots(
    supply_scope: str = "corridor",
    availability_pct: int = 100,
    confirmed_provincial_depot_ids: tuple[str, ...] = (),
) -> tuple[Depot, ...]:
    return tuple(
        Depot(
            depot_id=d["depot_id"],
            name=d["name"],
            lat=d["lat"],
            lon=d["lon"],
            trucks=d["fleet"]["truk_tangki"],
            pumps=d["fleet"]["pompa"],
            crews=d["fleet"]["regu"],
            tier=d.get("tier", "local"),
            inventory_status=d.get("inventory_status", "registered_unconfirmed"),
            location_accuracy=d.get("location_accuracy", "kabupaten_centroid"),
        )
        for d in supply_view(
            supply_scope, availability_pct, confirmed_provincial_depot_ids
        )["depots"]
    )


@lru_cache(maxsize=1)
def date_bounds() -> tuple[str, str]:
    r = risk_history()
    return str(r["date"].min().date()), str(r["date"].max().date())


# Calibration is measured on the held-out years by ml/run_reliability.py. The
# API only reads the result, so nothing here needs the training stack.
RESULTS = DATA.parent / "results"


@lru_cache(maxsize=1)
def calibration() -> dict:
    """What predicted probabilities actually verified at, per hazard.

    Returns the reliability curve plus headline metrics so the interface can
    qualify a probability with its observed frequency. Missing files are not
    an error: the API still serves, the interface simply omits the caveat.
    """
    rel_path = RESULTS / "reliability.json"
    csv_path = RESULTS / "reliability.csv"
    if not rel_path.exists() or not csv_path.exists():
        return {}

    summary = json.loads(rel_path.read_text(encoding="utf-8"))
    bins = pd.read_csv(csv_path)
    out: dict[str, dict] = {}
    for hazard, s in summary.items():
        rows = bins[(bins["hazard"] == hazard) & (bins["n"] >= s["min_bin_n"])]
        out[hazard] = {
            "brier": round(s["brier"], 4),
            "reliability": round(s["reliability"], 5),
            "worst_gap_above_0.5": round(s["worst_gap_above_0.5"], 3),
            "base_rate": round(s["base_rate"], 4),
            "test_years": s["test_years"],
            "curve": [
                {
                    "lo": float(r.bin_lo),
                    "hi": float(r.bin_hi),
                    "predicted": round(float(r.mean_predicted), 3),
                    "observed": round(float(r.observed_freq), 3),
                    "n": int(r.n),
                }
                for r in rows.itertuples()
            ],
        }

    metrics_path = Path(__file__).resolve().parents[1] / "artifacts" / "metrics.json"
    if metrics_path.exists():
        m = json.loads(metrics_path.read_text(encoding="utf-8"))
        for hazard in ("flood", "drought"):
            if hazard in out and hazard in m:
                out[hazard]["precision_at_op"] = round(m[hazard]["precision_at_op"], 3)
                out[hazard]["recall_at_op"] = round(m[hazard]["recall_at_op"], 3)
    return out


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


@lru_cache(maxsize=1)
def modeled_ids() -> frozenset[str]:
    """Districts the hazard models actually cover: 318 of 324.

    The remaining six sit on the Cirebon and Indramayu coast and have no
    modelled river reach, so no flood row was ever produced for them.
    """
    return frozenset(risk_history()["district_id"].unique())


def risk_on(date: str | None = None) -> tuple[pd.Timestamp, pd.DataFrame]:
    """District metadata joined with flood/drought probability for a date.

    Districts the models do not cover keep a probability of 0.0 so every
    downstream consumer -- the optimizer above all, which compares against
    RISK_FLOOR -- keeps working on plain floats. They are marked `modeled`
    False instead, and it is the interface's job to render that as "not
    assessed" rather than as "0%, safe". The distinction matters: all six are
    on the rob-exposed coast, which is precisely where a confident zero is
    most misleading.
    """
    ts = _nearest_available_date(date)
    r = risk_history()
    day = r[r["date"] == ts][["district_id", "flood_prob", "drought_prob"]]
    merged = district_meta().merge(day, on="district_id", how="left")
    merged["modeled"] = merged["district_id"].isin(modeled_ids())
    merged["flood_prob"] = merged["flood_prob"].fillna(0.0)
    merged["drought_prob"] = merged["drought_prob"].fillna(0.0)
    return ts, merged


def risk_records(date: str | None = None) -> tuple[pd.Timestamp, list[dict]]:
    ts, df = risk_on(date)
    cols = [
        "district_id", "name", "kabupaten", "lat", "lon",
        "population", "flood_prob", "drought_prob", "modeled",
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
