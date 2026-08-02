"""Fetch daily river discharge per district, 2015-2024, from the Open-Meteo Flood
API (GloFAS v4 hydrological reanalysis; free, no key).

River discharge is the physical fluvial-flood variable: it integrates upstream
rainfall, routing, and soil state, so it is a genuine flood observation that is
independent of the local rainfall features we train on. GloFAS itself issues
flood alerts on discharge exceeding return-period thresholds; we label floods
the same way downstream (see build_features.py).

Output: data-raw/discharge_daily.parquet  columns: district_id, date, discharge_m3s
Run:    python ml/fetch_discharge.py   (from backend/, venv active)
Safe to re-run: skips districts already fetched.
"""

import time
from pathlib import Path

import geopandas as gpd
import pandas as pd
import requests

BACKEND = Path(__file__).resolve().parents[1]
DISTRICTS = BACKEND / "data" / "districts.geojson"
OUT = BACKEND.parent / "data-raw" / "discharge_daily.parquet"

API = "https://flood-api.open-meteo.com/v1/flood"
START, END = "2015-01-01", "2024-12-31"
BATCH = 25


def main() -> None:
    gdf = gpd.read_file(DISTRICTS)
    cent = gdf.geometry.to_crs(32748).centroid.to_crs(4326)
    points = pd.DataFrame(
        {"district_id": gdf["district_id"], "lat": cent.y, "lon": cent.x}
    )

    done: set[str] = set()
    frames: list[pd.DataFrame] = []
    if OUT.exists():
        prev = pd.read_parquet(OUT)
        done = set(prev["district_id"].unique())
        frames.append(prev)
        print(f"Resuming: {len(done)} districts already fetched")

    todo = points[~points["district_id"].isin(done)].reset_index(drop=True)
    print(f"Fetching {len(todo)} districts in batches of {BATCH}")

    for start in range(0, len(todo), BATCH):
        chunk = todo.iloc[start : start + BATCH]
        params = {
            "latitude": ",".join(f"{v:.4f}" for v in chunk["lat"]),
            "longitude": ",".join(f"{v:.4f}" for v in chunk["lon"]),
            "start_date": START,
            "end_date": END,
            "daily": "river_discharge",
        }
        for attempt in range(5):
            r = requests.get(API, params=params, timeout=120)
            if r.status_code == 200:
                break
            wait = 2 ** (attempt + 1)
            print(f"  HTTP {r.status_code}, retry in {wait}s: {r.text[:120]}")
            time.sleep(wait)
        else:
            raise RuntimeError("Open-Meteo Flood API kept failing; retry later")

        payload = r.json()
        results = payload if isinstance(payload, list) else [payload]
        if len(results) != len(chunk):
            raise RuntimeError(
                f"got {len(results)} results for {len(chunk)} locations"
            )

        for (_, row), res in zip(chunk.iterrows(), results):
            daily = res["daily"]
            frames.append(
                pd.DataFrame(
                    {
                        "district_id": row["district_id"],
                        "date": pd.to_datetime(daily["time"]),
                        "discharge_m3s": daily["river_discharge"],
                    }
                )
            )

        pd.concat(frames, ignore_index=True).to_parquet(OUT, index=False)
        print(
            f"  batch {start // BATCH + 1}: total districts saved = "
            f"{start + len(chunk) + len(done)}"
        )
        time.sleep(1)

    final = pd.concat(frames, ignore_index=True)
    nulls = final["discharge_m3s"].isna().sum()
    print(
        f"Done: {final['district_id'].nunique()} districts, "
        f"{len(final):,} rows, null discharge: {nulls} "
        f"({nulls / len(final):.1%})"
    )
    if nulls / len(final) > 0.3:
        print(
            "NOTE: many nulls. GloFAS only resolves cells on modeled river "
            "networks; inland kecamatan off a major river return no discharge. "
            "Those districts fall back to rainfall-only flood features."
        )


if __name__ == "__main__":
    main()
