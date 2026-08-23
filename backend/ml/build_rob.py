"""Turn raw Sentinel-1 water fractions into the three numbers the interface shows.

Raw water fraction is not usable on its own. Pantura is mostly irrigated rice,
and flooded paddy is radar-dark exactly like flood water, so the raw number
lights up the whole corridor every wet season and means nothing.

Three derived signals, each answering a different operational question:

  anomaly   How much standing water is there this month compared with what
            this kecamatan normally has in this calendar month? Paddy floods
            on schedule, so it cancels. Rob and river flooding do not.

  trend     Has permanent water grown here over the decade? Land subsidence
            turns farmland into permanent sea, and that shows up as a rising
            floor rather than a spike. This is the Demak story.

  blind     Does radar see water on a day the flood model called quiet? The
            flood head is trained on river discharge and is structurally blind
            to tidal inundation, so this marks where its number is untrustworthy.

Run after ml/fetch_sar_water.py:
    venv/Scripts/python ml/build_rob.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "data"
SRC = DATA / "sar_water.parquet"
OUT = DATA / "sar_rob.parquet"
META = DATA / "sar_rob.json"

# A kecamatan needs this many observations of a calendar month before its
# seasonal baseline is worth trusting. Ten years of data means up to 10.
MIN_BASELINE_N = 5

# Anomaly bands, in fraction of kecamatan area above that month's own normal.
# 2 pp is roughly the point where the signal clears speckle noise on a polygon
# of this size; 6 pp is visible inundation over a meaningful part of the area.
ANOM_WATCH = 0.02
ANOM_HIGH = 0.06

# Trend band. A kecamatan whose permanent water grew by this much between the
# first and last three years is losing land, not having a wet season.
TREND_CHRONIC = 0.03

EARLY_YEARS = 3
LATE_YEARS = 3


def load() -> pd.DataFrame:
    if not SRC.exists():
        raise SystemExit(f"missing {SRC}; run ml/fetch_sar_water.py first")
    df = pd.read_parquet(SRC)
    df["month"] = pd.to_datetime(df["month"])
    df["cal_month"] = df["month"].dt.month
    df["year"] = df["month"].dt.year
    return df.dropna(subset=["water_frac"])


def add_anomaly(df: pd.DataFrame) -> pd.DataFrame:
    """Water fraction minus this district's own median for that calendar month.

    Median rather than mean: a single extreme flood year would drag a mean
    baseline up and then hide the next flood of the same size.
    """
    g = df.groupby(["district_id", "cal_month"])["water_frac"]
    base = g.transform("median")
    n = g.transform("size")
    df["baseline"] = base.where(n >= MIN_BASELINE_N)
    df["anomaly"] = df["water_frac"] - df["baseline"]
    return df


def coastal_flag() -> pd.Series:
    """Which kecamatan front the sea, from the feature table the models use."""
    f = pd.read_parquet(DATA / "flood_dataset.parquet", columns=["district_id", "coastal"])
    return f.groupby("district_id")["coastal"].max()


def district_trend(df: pd.DataFrame) -> pd.DataFrame:
    """Change in annual mean water fraction, first 3 years to last 3 years.

    Averaging whole years first means the comparison is not contaminated by
    which calendar months happened to have usable radar coverage.
    """
    yearly = df.groupby(["district_id", "year"])["water_frac"].mean().reset_index()
    years = sorted(yearly["year"].unique())
    early, late = years[:EARLY_YEARS], years[-LATE_YEARS:]

    a = yearly[yearly["year"].isin(early)].groupby("district_id")["water_frac"].mean()
    b = yearly[yearly["year"].isin(late)].groupby("district_id")["water_frac"].mean()
    out = pd.DataFrame({"water_early": a, "water_late": b}).dropna()
    out["trend"] = out["water_late"] - out["water_early"]

    # Growing water inland is not land loss. The largest riser in the corridor
    # is Waduk Rawapening, a reservoir in Kab. Semarang whose level rose over
    # the decade: a real observation, but not rob, and flagging it as chronic
    # inundation would discredit the whole layer. Chronic is claimed only where
    # the kecamatan fronts the sea.
    coastal = coastal_flag()
    out["coastal"] = out.index.map(coastal).fillna(0).astype(int)
    out["chronic"] = (out["trend"] >= TREND_CHRONIC) & (out["coastal"] == 1)
    return out.reset_index()


def main() -> None:
    df = add_anomaly(load())
    print("rows:", len(df), " districts:", df.district_id.nunique(),
          " months:", df.month.nunique())

    keep = ["district_id", "month", "water_frac", "baseline", "anomaly"]
    monthly = df[keep].copy()
    monthly["water_frac"] = monthly["water_frac"].astype("float32")
    monthly["baseline"] = monthly["baseline"].astype("float32")
    monthly["anomaly"] = monthly["anomaly"].astype("float32")
    monthly.to_parquet(OUT, index=False)
    print("wrote", OUT, monthly.shape)

    trend = district_trend(df)
    trend.to_parquet(DATA / "sar_trend.parquet", index=False)
    n_chronic = int(trend["chronic"].sum())
    print("wrote sar_trend.parquet:", trend.shape, "| chronic:", n_chronic)

    META.write_text(json.dumps({
        "source": "COPERNICUS/S1_GRD, IW, VV, monthly median",
        "threshold_db": -16.0,
        "scale_m": 100,
        "anomaly_watch": ANOM_WATCH,
        "anomaly_high": ANOM_HIGH,
        "trend_chronic": TREND_CHRONIC,
        "min_baseline_n": MIN_BASELINE_N,
        "months": [str(df.month.min().date()), str(df.month.max().date())],
        "n_districts": int(df.district_id.nunique()),
        "n_chronic": n_chronic,
    }, indent=2), encoding="utf-8")

    top = trend.nlargest(12, "trend")
    print("\nlargest growth in permanent water:")
    print(top[["district_id", "water_early", "water_late", "trend", "coastal",
               "chronic"]].round(4).to_string(index=False))


if __name__ == "__main__":
    main()
