"""Build the Pantura pilot-corridor district file from GADM v4.1 level 3.

Input : data-raw/gadm41_IDN_3.json.zip  (full Indonesia, kecamatan level)
Output: backend/data/districts.geojson  (corridor only, simplified, keyed by district_id)

Run once:  python ml/build_districts.py   (from backend/, venv active)
"""

from pathlib import Path

import geopandas as gpd
import pandas as pd

BACKEND = Path(__file__).resolve().parents[1]
RAW = BACKEND.parent / "data-raw" / "gadm41_IDN_3.json.zip"
OUT = BACKEND / "data" / "districts.geojson"

# Pantura corridor kab/kota. GADM NAME_2 sometimes splits "X" (kabupaten) and
# "Kota X"; we accept both and report what actually matched so it can be checked.
CORRIDOR_KABUPATEN = [
    "Jakarta Utara",
    "Bekasi", "Kota Bekasi",
    "Karawang",
    "Subang",
    "Indramayu",
    "Cirebon", "Kota Cirebon",
    "Brebes",
    "Tegal", "Kota Tegal",
    "Pemalang",
    "Pekalongan", "Kota Pekalongan",
    "Kendal",
    "Semarang", "Kota Semarang",
    "Demak",
]

# Degrees; ~0.001 deg is roughly 100 m at the equator. Keeps shapes recognizable
# while cutting file size hard.
SIMPLIFY_TOLERANCE = 0.0015


def main() -> None:
    print(f"Reading {RAW} ...")
    gdf = gpd.read_file(RAW)
    print(f"  {len(gdf)} kecamatan in Indonesia")

    # GADM 4.1 JSON strips spaces from names ("JakartaUtara", "KotaSemarang"),
    # so compare space-stripped lowercase on both sides.
    wanted = {k.replace(" ", "").lower() for k in CORRIDOR_KABUPATEN}
    norm = gdf["NAME_2"].str.replace(" ", "", regex=False).str.lower()
    corridor = gdf[norm.isin(wanted)].copy()

    matched = sorted(corridor["NAME_2"].unique())
    missing = sorted(
        wanted - {m.replace(" ", "").lower() for m in matched}
    )
    print(f"  matched kab/kota ({len(matched)}): {matched}")
    if missing:
        print(f"  NOT FOUND in GADM (check spelling): {missing}")

    # Re-insert the spaces GADM stripped ("TanjungPriok" -> "Tanjung Priok").
    def respace(s: "pd.Series") -> "pd.Series":
        return s.str.replace(r"(?<=[a-z])(?=[A-Z])", " ", regex=True)

    corridor["district_id"] = corridor["GID_3"]
    corridor["name"] = respace(corridor["NAME_3"])
    corridor["kabupaten"] = respace(corridor["NAME_2"])
    corridor["provinsi"] = respace(corridor["NAME_1"])
    corridor = corridor[
        ["district_id", "name", "kabupaten", "provinsi", "geometry"]
    ]

    corridor["geometry"] = corridor["geometry"].simplify(
        SIMPLIFY_TOLERANCE, preserve_topology=True
    )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    corridor.to_file(OUT, driver="GeoJSON")
    size_mb = OUT.stat().st_size / 1e6
    print(f"Wrote {len(corridor)} districts to {OUT} ({size_mb:.1f} MB)")
    if size_mb > 2.5:
        print("WARNING: file still large; raise SIMPLIFY_TOLERANCE")


if __name__ == "__main__":
    main()
