"""Observed surface water from Sentinel-1 radar, served per district per date.

Everything else in SIAGA is a prediction. This is a measurement, and it exists
because the flood head cannot see the flood that matters most on this coast.

The flood model is trained on GloFAS river discharge, so it detects fluvial
flooding. Rob is seawater pushed inland over subsided ground, with no river
involved, and the model reads it as quiet. Radar does not care where the water
came from, and it sees through monsoon cloud.

Serving is read-only: ml/build_rob.py does the seasonal-baseline arithmetic
offline, exactly like district_centroids.csv, so the API never needs the
analysis stack.
"""

import json
from functools import lru_cache
from pathlib import Path

import pandas as pd

DATA = Path(__file__).resolve().parents[1].parent / "data"

MONTHLY = DATA / "sar_rob.parquet"
TREND = DATA / "sar_trend.parquet"
META = DATA / "sar_rob.json"

# Below this flood probability the optimizer treats a district as quiet. Radar
# seeing real water there is the disagreement worth surfacing.
QUIET_FLOOD_PROB = 0.05

# A relative jump is not enough on its own. A kecamatan going from 2% to 4.5%
# of its area under water clears the anomaly band while covering almost no
# ground, and speckle on a single month's composite can produce that much.
# 14% of all anomaly flags were of that kind. Requiring real extent as well
# drops them and leaves a list an operator can act on.
MIN_WATER_FRAC = 0.05


def available() -> bool:
    """Radar is an optional layer. Missing files degrade the interface, not the
    service: every other view keeps working and the mode is simply hidden."""
    return MONTHLY.exists() and TREND.exists() and META.exists()


@lru_cache(maxsize=1)
def meta() -> dict:
    return json.loads(META.read_text(encoding="utf-8")) if META.exists() else {}


@lru_cache(maxsize=1)
def monthly() -> pd.DataFrame:
    df = pd.read_parquet(MONTHLY)
    df["month"] = pd.to_datetime(df["month"])
    return df


@lru_cache(maxsize=1)
def trend() -> pd.DataFrame:
    return pd.read_parquet(TREND)


def _level(anomaly: float | None) -> str:
    if anomaly is None or pd.isna(anomaly):
        return "tak_terpantau"
    m = meta()
    if anomaly >= m.get("anomaly_high", 0.06):
        return "tinggi"
    if anomaly >= m.get("anomaly_watch", 0.02):
        return "waspada"
    return "normal"


@lru_cache(maxsize=32)
def _rob_for_month(month: pd.Timestamp) -> dict[str, dict]:
    """Readings keyed by month, cached. The full corridor is 324 rows and was
    being rebuilt on every request, which was a third of the endpoint's time
    for a table that changes only when the month does.

    The returned readings are shared, not copied, so callers must treat them as
    read-only. Copying per request would give the cache back its cost.
    """
    df = monthly()
    rows = df[df["month"] == month]
    if rows.empty:
        return {}

    tr = trend().set_index("district_id")
    out: dict[str, dict] = {}
    for r in rows.itertuples():
        anomaly = None if pd.isna(r.anomaly) else round(float(r.anomaly), 4)
        out[r.district_id] = {
            "water_frac": round(float(r.water_frac), 4),
            "baseline": None if pd.isna(r.baseline) else round(float(r.baseline), 4),
            "anomaly": anomaly,
            "level": _level(anomaly),
            "chronic": bool(tr["chronic"].get(r.district_id, False)),
            "trend": round(float(tr["trend"].get(r.district_id, 0.0)), 4),
            "coastal": bool(tr["coastal"].get(r.district_id, 0)),
        }
    return out


def rob_on(date: str | pd.Timestamp) -> dict[str, dict]:
    """Radar readings for the calendar month containing `date`, by district.

    Sentinel-1 revisits every 12 days, so a single day has no reading. The
    month the operator's date falls in is the honest resolution, and the
    interface labels it as such.
    """
    if not available():
        return {}

    # Before or after radar coverage this is empty rather than the nearest
    # month: showing January's water on a June map would be a silent lie about
    # when it was observed.
    return _rob_for_month(pd.Timestamp(date).replace(day=1).normalize())


@lru_cache(maxsize=1)
def rob_series() -> dict:
    """Every district's anomaly for every month, as parallel arrays.

    The console shows one month at a time, which turns a decade of measured
    inundation into a single frame. This is the whole record so the interface
    can play it: on the Demak and Pekalongan coast the permanent water grows
    visibly between 2015 and 2024, and that is the case the product is arguing.

    Arrays rather than objects, and rounded to three decimals: the same data as
    a list of records is roughly four times the bytes for no added meaning.
    Nulls are preserved -- a month a district was never observed in must not be
    drawn as if it were dry.
    """
    if not available():
        return {"months": [], "districts": {}}

    df = monthly().sort_values(["district_id", "month"])
    months = [str(m.date()) for m in sorted(df["month"].unique())]
    index = {m: i for i, m in enumerate(months)}

    out: dict[str, list] = {}
    for did, g in df.groupby("district_id", sort=False):
        row: list[float | None] = [None] * len(months)
        for r in g.itertuples():
            a = r.anomaly
            row[index[str(r.month.date())]] = None if pd.isna(a) else round(float(a), 3)
        out[did] = row

    return {"months": months, "districts": out}


def observed_month(date: str | pd.Timestamp) -> str | None:
    """Which month the radar figures actually come from, for the caption."""
    if not available():
        return None
    m = pd.Timestamp(date).replace(day=1).normalize()
    return str(m.date()) if (monthly()["month"] == m).any() else None


def blind_spot(rob: dict | None, flood_prob: float) -> bool:
    """Radar sees real standing water where the flood model says quiet.

    This is the model reporting its own known failure mode rather than hiding
    it, and it is the reason the layer is in the product at all.

    Restricted to coastal kecamatan. The claim being made is specific: the
    flood head is trained on river discharge and therefore cannot represent
    tidal inundation. Inland, a wet month with a quiet river is usually a
    permanent water body rather than a failure -- Waduk Rawapening reads 69%
    water every July and would otherwise top this list, which would discredit
    every other entry on it.
    """
    if not rob or rob["level"] not in ("tinggi", "waspada"):
        return False
    if not rob.get("coastal"):
        return False
    if rob["water_frac"] < MIN_WATER_FRAC:
        return False
    return flood_prob < QUIET_FLOOD_PROB
