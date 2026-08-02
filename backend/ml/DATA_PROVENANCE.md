# Data provenance

Honest accounting of what is real and what is scenario, mirroring the paper.

## Real, downloaded programmatically (scripts in this folder)

| Data | Source | Script | What it feeds |
|------|--------|--------|---------------|
| Kecamatan boundaries | GADM v4.1 level 3 | `build_districts.py` | Map, unit of analysis |
| Daily rainfall 2015-2024 | ERA5 via Open-Meteo Archive API | `fetch_rainfall.py` | Features + SPI drought label |
| Daily river discharge 2015-2024 | GloFAS v4 via Open-Meteo Flood API | `fetch_discharge.py` | Independent flood label + feature |
| Population 2020 | WorldPop 1km UN-adjusted | `fetch_population.py` | Exposure (people affected) |

324 kecamatan across 18 kab/kota of the Pantura corridor. Rainfall and discharge
are ~1.18M district-day rows each.

## Labels: how we get flood/drought truth without BNPB event records

BNPB's official disaster records (DIBI) are behind a locked Superset instance
(public role denied), and BNPB's open ArcGIS layers return HTTP 500 on query.
The Dartmouth Flood Observatory archive is decommissioned (410) or ends 2010,
and PetaBencana's public API serves no historical depth. So we label from open
physical reanalysis instead, which is arguably more rigorous than news-derived
event lists:

- **Flood label** = river discharge exceeding its local high percentile
  (return-period style), the same rule GloFAS uses for flood alerts. Discharge
  is independent of the rainfall features (it integrates upstream routing).
- **Drought label** = SPI (Standardized Precipitation Index, McKee 1993) below
  threshold, computed from the real rainfall. SPI is Indonesia's official
  drought indicator (Perka BMKG No. 9/2019).

## Scenario data (not public, clearly marked)

- `data/depots.json`: BPBD depot locations are real kota/kabupaten seats; vehicle
  and crew counts are plausible placeholders. Fleet inventories are not published.
