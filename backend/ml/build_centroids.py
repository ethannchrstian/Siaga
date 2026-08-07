"""Precompute kecamatan centroids into a small CSV.

The API needs one lat/lon per kecamatan to compute depot travel times. Deriving
it at request time meant importing geopandas, which drags GDAL into the
production image: five-to-ten minute builds on hosted tiers and a common source
of build failures, all for a value that never changes.

Run this once (and again only if districts.geojson changes):

    python ml/build_centroids.py

Requires the dev dependencies (geopandas). The API itself does not.
"""

from pathlib import Path

import geopandas as gpd
import pandas as pd

DATA = Path(__file__).resolve().parents[1] / "data"
SRC = DATA / "districts.geojson"
OUT = DATA / "district_centroids.csv"

# UTM 48S: the corridor sits in this zone, so centroids are computed in metres
# rather than degrees before being converted back to WGS84.
PROJECTED_CRS = 32748


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"{SRC} missing. Run: python ml/build_districts.py")

    gj = gpd.read_file(SRC)
    centroid = gj.geometry.to_crs(PROJECTED_CRS).centroid.to_crs(4326)

    out = pd.DataFrame(
        {
            "district_id": gj["district_id"],
            "name": gj["name"],
            "kabupaten": gj["kabupaten"],
            "provinsi": gj["provinsi"],
            "lat": centroid.y.values.round(6),
            "lon": centroid.x.values.round(6),
        }
    )
    out.to_csv(OUT, index=False)
    print(f"wrote {OUT} ({len(out)} kecamatan, {OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
