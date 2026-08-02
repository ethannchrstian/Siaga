"""Population per district from WorldPop (2020, 1km, UN-adjusted).

Downloads the Indonesia 1km raster once, then sums population inside each
kecamatan polygon (zonal sum).

Output: backend/data/population.csv  columns: district_id, population
Run:    python ml/fetch_population.py   (from backend/, venv active)
"""

from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
import requests
from rasterio.mask import mask

BACKEND = Path(__file__).resolve().parents[1]
DISTRICTS = BACKEND / "data" / "districts.geojson"
RASTER = BACKEND.parent / "data-raw" / "idn_ppp_2020_1km_UNadj.tif"
OUT = BACKEND / "data" / "population.csv"

URL = (
    "https://data.worldpop.org/GIS/Population/Global_2000_2020_1km_UNadj/"
    "2020/IDN/idn_ppp_2020_1km_Aggregated_UNadj.tif"
)


def main() -> None:
    if not RASTER.exists():
        print(f"Downloading WorldPop raster -> {RASTER.name}")
        r = requests.get(URL, timeout=300, stream=True)
        r.raise_for_status()
        RASTER.parent.mkdir(parents=True, exist_ok=True)
        with open(RASTER, "wb") as f:
            for chunk in r.iter_content(chunk_size=1 << 20):
                f.write(chunk)
        print(f"  {RASTER.stat().st_size / 1e6:.1f} MB")

    gdf = gpd.read_file(DISTRICTS)
    rows = []
    with rasterio.open(RASTER) as src:
        nodata = src.nodata
        gdf = gdf.to_crs(src.crs)
        for _, row in gdf.iterrows():
            try:
                out, _ = mask(src, [row.geometry], crop=True, filled=True)
                band = out[0].astype("float64")
                if nodata is not None:
                    band = band[band != nodata]
                band = band[band > 0]  # WorldPop uses negative/nodata fill
                pop = float(np.nansum(band))
            except (ValueError, IndexError):
                pop = 0.0  # polygon outside raster footprint
            rows.append({"district_id": row["district_id"], "population": round(pop)})

    df = pd.DataFrame(rows)
    df.to_csv(OUT, index=False)
    print(
        f"Wrote {len(df)} districts to {OUT}. "
        f"total pop: {df['population'].sum():,.0f}, "
        f"zero-pop districts: {(df['population'] == 0).sum()}"
    )
    print(df.sort_values("population", ascending=False).head(5).to_string(index=False))


if __name__ == "__main__":
    main()
