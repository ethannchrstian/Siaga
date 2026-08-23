"""Per-kecamatan surface water fraction from Sentinel-1 SAR, via Earth Engine.

Why this exists. The flood head is trained on river discharge, so it detects
fluvial flooding and is blind to tidal inundation (rob) driven by land
subsidence. Rob is the dominant flood mechanism in Demak, Semarang and
Pekalongan, and it is exactly what the Timbulsloko case shows. Radar sees
standing water regardless of where it came from, and it sees through cloud,
which optical imagery cannot do in a monsoon.

Method. Sentinel-1 GRD, IW mode, VV polarisation. Open water is a specular
reflector: it bounces radar away from the sensor, so it returns very low
backscatter. A fixed threshold on VV separates water from land well enough for
an area fraction, which is all we need here.

Output. One row per district-month: the fraction of the kecamatan classified as
water. 2015-2024, 324 kecamatan, about 39k rows.

Setup:
    venv/Scripts/python -m pip install earthengine-api
    venv/Scripts/earthengine authenticate

Run:
    venv/Scripts/python ml/fetch_sar_water.py --project YOUR_GEE_PROJECT
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import ee
import pandas as pd

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "data"
OUT = DATA / "sar_water.parquet"

# Open water in Sentinel-1 VV sits well below land clutter. -16 dB is the
# common operating point for flood mapping and is what we use; the sensitivity
# of the final feature to this choice is reported in the model comparison.
VV_WATER_DB = -16.0

# 100 m is far finer than we need for an area fraction over a kecamatan and
# keeps Earth Engine compute inside the free Community tier.
SCALE_M = 100


def month_starts(start: str, end: str) -> list[pd.Timestamp]:
    return list(pd.date_range(start, end, freq="MS"))


def water_fraction(fc: ee.FeatureCollection, lo: str, hi: str) -> ee.FeatureCollection:
    """Fraction of each polygon returning open-water backscatter in [lo, hi)."""
    s1 = (
        ee.ImageCollection("COPERNICUS/S1_GRD")
        .filterDate(lo, hi)
        .filter(ee.Filter.eq("instrumentMode", "IW"))
        .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
        .select("VV")
    )

    # Median over the month suppresses speckle without needing a filter pass.
    vv = s1.median()
    water = vv.lt(VV_WATER_DB).rename("water")

    # mean of a 0/1 band over the polygon is the area fraction. Reducing the
    # count alongside it lets us drop months with no usable coverage.
    stack = water.addBands(vv.mask().rename("valid"))
    return stack.reduceRegions(
        collection=fc,
        reducer=ee.Reducer.mean(),
        scale=SCALE_M,
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--project", required=True, help="your Earth Engine Cloud project id")
    ap.add_argument("--start", default="2015-01-01")
    ap.add_argument("--end", default="2024-12-01")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()

    ee.Initialize(project=args.project)
    print("earth engine ready, project", args.project)

    districts = json.loads((DATA / "districts.geojson").read_text(encoding="utf-8"))
    feats = [
        ee.Feature(
            ee.Geometry(f["geometry"]),
            {"district_id": f["properties"]["district_id"]},
        )
        for f in districts["features"]
    ]
    fc = ee.FeatureCollection(feats)
    print("districts:", len(feats))

    months = month_starts(args.start, args.end)
    print("months:", len(months), months[0].date(), "to", months[-1].date())

    rows: list[dict] = []
    t0 = time.time()
    for i, m in enumerate(months, 1):
        lo = m.strftime("%Y-%m-%d")
        hi = (m + pd.offsets.MonthBegin(1)).strftime("%Y-%m-%d")
        try:
            got = water_fraction(fc, lo, hi).getInfo()
        except Exception as exc:  # one bad month must not lose the whole run
            print("  [%s] failed: %s" % (lo, exc))
            continue
        for f in got["features"]:
            p = f["properties"]
            rows.append(
                {
                    "district_id": p["district_id"],
                    "month": m,
                    "water_frac": p.get("water"),
                    "valid_frac": p.get("valid"),
                }
            )
        if i % 6 == 0 or i == len(months):
            print(
                "  %3d/%d  %s  rows=%d  %.0fs"
                % (i, len(months), lo, len(rows), time.time() - t0)
            )

    df = pd.DataFrame(rows)
    # Months with almost no valid radar coverage carry no information.
    before = len(df)
    df = df[df["valid_frac"].fillna(0) > 0.5].copy()
    df["water_frac"] = df["water_frac"].astype("float32")
    print("dropped %d rows with thin coverage" % (before - len(df)))

    df.to_parquet(args.out, index=False)
    print("wrote", args.out, df.shape)
    print(df.groupby(df.month.dt.year).water_frac.mean().round(4).to_string())


if __name__ == "__main__":
    main()
