"""Fetch daily rainfall per district, 2015-2024, from the Open-Meteo archive API
(ERA5 / ERA5-Land reanalysis; free, no key).

Districts are represented by their polygon centroid. ERA5 cells are ~9-25 km, so
centroid sampling is appropriate at kecamatan scale for a demo pipeline.

Output: data-raw/rainfall_daily.parquet  columns: district_id, date, precip_mm
Run:    python ml/fetch_rainfall.py   (from backend/, venv active)
Safe to re-run: skips districts already fetched.
"""

import json
import time
from pathlib import Path

import geopandas as gpd
import pandas as pd
import requests

BACKEND = Path(__file__).resolve().parents[1]
DISTRICTS = BACKEND / "data" / "districts.geojson"
OUT = BACKEND.parent / "data-raw" / "rainfall_daily.parquet"

API = "https://archive-api.open-meteo.com/v1/archive"
START, END = "2015-01-01", "2024-12-31"
BATCH = 25  # locations per request; keeps URLs and responses sane


def main() -> None:
    gdf = gpd.read_file(DISTRICTS)
    # Centroid in a projected CRS to avoid geographic-centroid warnings/skew.
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
            "daily": "precipitation_sum",
            "timezone": "Asia/Jakarta",
        }
        for attempt in range(5):
            r = requests.get(API, params=params, timeout=120)
            if r.status_code == 200:
                break
            wait = 2 ** (attempt + 1)
            print(f"  HTTP {r.status_code}, retry in {wait}s: {r.text[:120]}")
            time.sleep(wait)
        else:
            raise RuntimeError("Open-Meteo kept failing; try again later")

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
                        "precip_mm": daily["precipitation_sum"],
                    }
                )
            )

        # Checkpoint after every batch so an interruption loses nothing.
        pd.concat(frames, ignore_index=True).to_parquet(OUT, index=False)
        print(
            f"  batch {start // BATCH + 1}: total districts saved = "
            f"{start + len(chunk) + len(done)}"
        )
        time.sleep(1)  # be polite to the free API

    final = pd.concat(frames, ignore_index=True)
    print(
        f"Done: {final['district_id'].nunique()} districts, "
        f"{len(final):,} rows, null precip: {final['precip_mm'].isna().sum()}"
    )


if __name__ == "__main__":
    main()
