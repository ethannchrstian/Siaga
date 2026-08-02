"""Turn raw rainfall + discharge into two supervised datasets, and save the
per-district climatology needed to reproduce features at serving time.

Outputs (in backend/data/):
  flood_dataset.parquet    daily rows: features known at t, label = flood in t+1..t+3
  drought_dataset.parquet  monthly rows: features at month m, label = water stress at m+1
  ../app/artifacts/climatology.json  per-district discharge threshold + SPI gamma params

Flood label  = river discharge in the next 72h exceeds the district's 95th-pct
               discharge (GloFAS-style return-period alert).
Drought label = SPI-3 next month <= -1.0 (moderate drought, McKee 1993; SPI is
               Indonesia's official drought index, Perka BMKG 9/2019).

Run: python ml/build_features.py   (from backend/, venv active)
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats

BACKEND = Path(__file__).resolve().parents[1]
RAW = BACKEND.parent / "data-raw"
DATA = BACKEND / "data"
ARTIFACTS = BACKEND / "app" / "artifacts"

FLOOD_PCTILE = 95           # discharge percentile that defines a flood day
FLOOD_HORIZON = 3           # days ahead (0-72h)
DROUGHT_SPI_THRESHOLD = -1.0
COASTAL_KABUPATEN = {       # kab/kota fronting the sea (rob / saline-well exposure)
    "Jakarta Utara", "Bekasi", "Karawang", "Subang", "Indramayu", "Cirebon",
    "Kota Cirebon", "Brebes", "Tegal", "Kota Tegal", "Pemalang", "Pekalongan",
    "Kota Pekalongan", "Kendal", "Kota Semarang", "Demak",
}


def spi_from_accumulation(x: np.ndarray) -> tuple[np.ndarray, dict]:
    """Standardized Precipitation Index from a k-month accumulation series.

    Fit a gamma to the positive values (zero-adjusted), map through the gamma
    CDF, then to a standard normal. Returns the SPI series and the fitted
    params so serving can reproduce it.
    """
    x = np.asarray(x, dtype="float64")
    valid = ~np.isnan(x)
    pos = x[valid & (x > 0)]
    if len(pos) < 20:
        return np.full_like(x, np.nan), {}
    # gamma fit with location fixed at 0 (standard for precip)
    a, loc, scale = stats.gamma.fit(pos, floc=0)
    p0 = float((x[valid] == 0).mean())
    cdf = np.full_like(x, np.nan)
    nz = valid & (x > 0)
    cdf[nz] = p0 + (1 - p0) * stats.gamma.cdf(x[nz], a, loc=0, scale=scale)
    zero = valid & (x == 0)
    cdf[zero] = p0 / 2
    cdf = np.clip(cdf, 1e-6, 1 - 1e-6)
    spi = np.full_like(x, np.nan)
    spi[valid] = stats.norm.ppf(cdf[valid])
    return spi, {"a": float(a), "scale": float(scale), "p0": p0}


def build_flood(rain: pd.DataFrame, disc: pd.DataFrame, meta: pd.DataFrame):
    df = rain.merge(disc, on=["district_id", "date"]).sort_values(
        ["district_id", "date"]
    )
    g = df.groupby("district_id", group_keys=False)

    # Rainfall accumulations (features known at t).
    df["rain_1d"] = df["precip_mm"]
    df["rain_3d"] = g["precip_mm"].transform(lambda s: s.rolling(3).sum())
    df["rain_7d"] = g["precip_mm"].transform(lambda s: s.rolling(7).sum())
    df["rain_30d"] = g["precip_mm"].transform(lambda s: s.rolling(30).sum())
    # Discharge state at t.
    df["disc_now"] = df["discharge_m3s"]
    df["disc_7d_mean"] = g["discharge_m3s"].transform(lambda s: s.rolling(7).mean())
    df["disc_change_3d"] = df["discharge_m3s"] - g["discharge_m3s"].transform(
        lambda s: s.shift(3)
    )
    df["month"] = df["date"].dt.month

    # Per-district flood threshold + label = exceedance within next FLOOD_HORIZON.
    thresholds = {}
    labels = []
    for did, grp in df.groupby("district_id"):
        d = grp["discharge_m3s"]
        if d.notna().sum() < 100:
            thr = np.nan
        else:
            thr = float(np.nanpercentile(d, FLOOD_PCTILE))
        thresholds[did] = thr
        if np.isnan(thr):
            labels.append(pd.Series(np.nan, index=grp.index))
            continue
        future_max = d[::-1].rolling(FLOOD_HORIZON, min_periods=1).max()[::-1]
        future_max = future_max.shift(-1)  # strictly future (t+1..t+H)
        labels.append((future_max > thr).astype("float"))
    df["flood_label"] = pd.concat(labels).sort_index()

    df = df.merge(meta[["district_id", "coastal"]], on="district_id", how="left")
    feats = [
        "rain_1d", "rain_3d", "rain_7d", "rain_30d",
        "disc_now", "disc_7d_mean", "disc_change_3d", "month", "coastal",
    ]
    out = df.dropna(subset=feats + ["flood_label"]).copy()
    out["year"] = out["date"].dt.year
    return out[["district_id", "date", "year", *feats, "flood_label"]], thresholds


def build_drought(rain: pd.DataFrame, meta: pd.DataFrame):
    rain = rain.copy()
    rain["ym"] = rain["date"].dt.to_period("M")
    monthly = (
        rain.groupby(["district_id", "ym"])["precip_mm"].sum().reset_index()
    )
    monthly = monthly.sort_values(["district_id", "ym"])
    g = monthly.groupby("district_id", group_keys=False)

    monthly["p1"] = monthly["precip_mm"]
    monthly["p3"] = g["precip_mm"].transform(lambda s: s.rolling(3).sum())
    monthly["p6"] = g["precip_mm"].transform(lambda s: s.rolling(6).sum())

    spi_params = {}
    for k, col in [(1, "p1"), (3, "p3"), (6, "p6")]:
        spi_all = []
        for did, grp in monthly.groupby("district_id"):
            spi, params = spi_from_accumulation(grp[col].values)
            spi_all.append(pd.Series(spi, index=grp.index))
            spi_params.setdefault(did, {})[f"spi{k}"] = params
        monthly[f"spi{k}"] = pd.concat(spi_all).sort_index()

    # Dry-spell proxy: months in the last 3 with below-median rainfall.
    monthly["dry_run"] = g["precip_mm"].transform(
        lambda s: (s < s.median()).rolling(3).sum()
    )
    monthly["month"] = monthly["ym"].dt.month

    # Label: SPI-3 next month <= threshold (water stress in ~2-8 weeks).
    monthly["spi3_next"] = g["spi3"].transform(lambda s: s.shift(-1))
    monthly["drought_label"] = (
        monthly["spi3_next"] <= DROUGHT_SPI_THRESHOLD
    ).astype("float")

    monthly = monthly.merge(
        meta[["district_id", "coastal"]], on="district_id", how="left"
    )
    feats = ["spi1", "spi3", "spi6", "p1", "dry_run", "month", "coastal"]
    out = monthly.dropna(subset=feats + ["spi3_next"]).copy()
    out["date"] = out["ym"].dt.to_timestamp()
    out["year"] = out["date"].dt.year
    return out[["district_id", "date", "year", *feats, "drought_label"]], spi_params


def main() -> None:
    rain = pd.read_parquet(RAW / "rainfall_daily.parquet")
    disc = pd.read_parquet(RAW / "discharge_daily.parquet")

    import geopandas as gpd

    gj = gpd.read_file(DATA / "districts.geojson")
    meta = pd.DataFrame(
        {
            "district_id": gj["district_id"],
            "kabupaten": gj["kabupaten"],
        }
    )
    meta["coastal"] = meta["kabupaten"].isin(COASTAL_KABUPATEN).astype(int)

    print("Building flood dataset ...")
    flood, thresholds = build_flood(rain, disc, meta)
    print(
        f"  {len(flood):,} rows, positive rate "
        f"{flood['flood_label'].mean():.2%}"
    )

    print("Building drought dataset ...")
    drought, spi_params = build_drought(rain, meta)
    print(
        f"  {len(drought):,} rows, positive rate "
        f"{drought['drought_label'].mean():.2%}"
    )

    DATA.mkdir(exist_ok=True)
    flood.to_parquet(DATA / "flood_dataset.parquet", index=False)
    drought.to_parquet(DATA / "drought_dataset.parquet", index=False)

    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    clim = {
        "flood_threshold_m3s": thresholds,
        "spi_params": spi_params,
        "config": {
            "flood_pctile": FLOOD_PCTILE,
            "flood_horizon_days": FLOOD_HORIZON,
            "drought_spi_threshold": DROUGHT_SPI_THRESHOLD,
        },
    }
    (ARTIFACTS / "climatology.json").write_text(json.dumps(clim), encoding="utf-8")
    print(f"Saved datasets + climatology to {DATA} and {ARTIFACTS}")


if __name__ == "__main__":
    main()
