"""Monthly training table for the inundation head, labelled by Sentinel-1 radar.

Why a third head exists. The flood label in flood_dataset.parquet is a high
percentile of GloFAS river discharge, so by construction it can only mark
fluvial flooding. Rob is seawater over subsided ground with no river involved,
and no threshold on discharge will ever label it. We had no label for the
hazard that defines this coast.

Radar gives us one. Standing water above a kecamatan's own seasonal normal is
an observation of inundation whatever caused it, so it can be used as a target
and learned from the same weather and terrain features the other heads use.

Leakage discipline. Every quantity derived from the radar series itself -- the
seasonal baseline and the subsidence trend -- is computed on development years
only (2015-2022). Using the full record would let the test years inform their
own labels and their own features, and the resulting AUC would be fiction.

Run after ml/fetch_sar_water.py and ml/build_rob.py:
    venv/Scripts/python ml/build_rob_features.py
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "data"
OUT = DATA / "rob_dataset.parquet"

DEV_END = 2022          # development years are <= this; 2023-2024 are held out
MIN_BASELINE_N = 5      # calendar-month observations needed for a baseline
ANOM_HIGH = 0.06        # label threshold, matches ml/build_rob.py

TREND_EARLY = (2015, 2017)
TREND_LATE = (2020, 2022)   # inside dev, unlike the display trend in build_rob


def monthly_weather() -> pd.DataFrame:
    """Aggregate the daily flood table up to the monthly grid radar works on."""
    f = pd.read_parquet(
        DATA / "flood_dataset.parquet",
        columns=["district_id", "date", "rain_1d", "disc_now", "coastal"],
    )
    f["month"] = f["date"].values.astype("datetime64[M]")
    g = f.groupby(["district_id", "month"])
    out = g.agg(
        rain_sum=("rain_1d", "sum"),
        rain_max=("rain_1d", "max"),
        disc_mean=("disc_now", "mean"),
        disc_max=("disc_now", "max"),
        coastal=("coastal", "max"),
    ).reset_index()
    # Days of meaningful rain: a month can reach the same total from one storm
    # or from steady drizzle, and those flood very differently.
    wet = (
        f.assign(wet=(f["rain_1d"] >= 20).astype("int8"))
        .groupby(["district_id", "month"])["wet"].sum()
        .rename("wet_days").reset_index()
    )
    return out.merge(wet, on=["district_id", "month"], how="left")


def monthly_dryness() -> pd.DataFrame:
    d = pd.read_parquet(
        DATA / "drought_dataset.parquet",
        columns=["district_id", "date", "spi1", "spi3"],
    )
    d = d.rename(columns={"date": "month"})
    d["month"] = d["month"].values.astype("datetime64[M]")
    return d


def dev_baseline(sar: pd.DataFrame) -> pd.DataFrame:
    """Seasonal normal per district and calendar month, development years only."""
    dev = sar[sar["month"].dt.year <= DEV_END]
    g = dev.groupby(["district_id", "cal_month"])["water_frac"]
    base = g.median().rename("water_base")
    n = g.size().rename("base_n")
    out = pd.concat([base, n], axis=1).reset_index()
    return out[out["base_n"] >= MIN_BASELINE_N].drop(columns="base_n")


def dev_trend(sar: pd.DataFrame) -> pd.DataFrame:
    """Growth in permanent water inside the development window.

    A static per-district proxy for land subsidence. Kept to dev years so a
    district's test-period behaviour never leaks into its own feature.
    """
    yearly = (
        sar.assign(year=sar["month"].dt.year)
        .groupby(["district_id", "year"])["water_frac"].mean().reset_index()
    )
    def window(lo, hi):
        w = yearly[(yearly["year"] >= lo) & (yearly["year"] <= hi)]
        return w.groupby("district_id")["water_frac"].mean()

    early, late = window(*TREND_EARLY), window(*TREND_LATE)
    tr = (late - early).rename("subsid_trend").reset_index()
    return tr.fillna({"subsid_trend": 0.0})


def main() -> None:
    src = DATA / "sar_water.parquet"
    if not src.exists():
        raise SystemExit(f"missing {src}; run ml/fetch_sar_water.py first")

    sar = pd.read_parquet(src).dropna(subset=["water_frac"])
    sar["month"] = pd.to_datetime(sar["month"])
    sar["cal_month"] = sar["month"].dt.month
    sar = sar.sort_values(["district_id", "month"])

    df = sar.merge(dev_baseline(sar), on=["district_id", "cal_month"], how="inner")
    df = df.merge(dev_trend(sar), on="district_id", how="left")
    df["anomaly"] = df["water_frac"] - df["water_base"]
    df["rob_label"] = (df["anomaly"] >= ANOM_HIGH).astype("int8")

    # The forecast target. rob_label describes the month the features are drawn
    # from, so a model trained on it diagnoses a month radar has already seen
    # and adds nothing an operator can act on. rob_label_next moves the answer
    # one month ahead, which is what the other two heads already do:
    # build_features.py shifts the flood label into t+1..t+3 and the drought
    # label into the following month.
    df["rob_label_next"] = (
        df.groupby("district_id")["rob_label"].shift(-1).astype("float32")
    )

    # Autoregressive terms. Available at prediction time: last month's radar
    # pass has already happened when this month is being forecast.
    g = df.groupby("district_id")["anomaly"]
    df["anom_lag1"] = g.shift(1)
    df["anom_lag2"] = g.shift(2)

    df = df.merge(monthly_weather(), on=["district_id", "month"], how="left")
    df = df.merge(monthly_dryness(), on=["district_id", "month"], how="left")

    df["year"] = df["month"].dt.year
    df = df.rename(columns={"cal_month": "month_of_year"})
    df = df.dropna(subset=["anom_lag1", "anom_lag2", "rain_sum"])

    feats = [
        "month_of_year", "coastal", "water_base", "subsid_trend",
        "anom_lag1", "anom_lag2",
        "rain_sum", "rain_max", "wet_days", "disc_mean", "disc_max",
        "spi1", "spi3",
    ]
    # `anomaly` is carried through so the persistence baseline in
    # ml/rob_variants.py can be scored on exactly these rows.
    keep = ["district_id", "month", "year", *feats, "anomaly",
            "rob_label", "rob_label_next"]
    out = df[keep].dropna(subset=["rob_label_next"]).copy()
    out["rob_label_next"] = out["rob_label_next"].astype("int8")
    out.to_parquet(OUT, index=False)

    dev = out[out["year"] <= DEV_END]
    te = out[out["year"] > DEV_END]
    print("wrote", OUT, out.shape)
    print("districts:", out.district_id.nunique(),
          " months:", out.month.nunique(),
          f" {out.month.min().date()} to {out.month.max().date()}")
    for col in ("rob_label", "rob_label_next"):
        print("%-15s dev %d/%d (%.2f%%)  test %d/%d (%.2f%%)" % (
            col, dev[col].sum(), len(dev), 100 * dev[col].mean(),
            te[col].sum(), len(te), 100 * te[col].mean()))
    coastal = out.groupby("coastal")["rob_label"].mean()
    print("positive rate by coastal flag:\n", (coastal * 100).round(2).to_string())


if __name__ == "__main__":
    main()
