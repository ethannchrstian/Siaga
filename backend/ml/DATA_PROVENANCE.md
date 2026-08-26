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

## Real, but with one stated assumption

- `data/depots.json` (built by `ml/fetch_inalogpal.py`): **equipment counts are
  real**, pulled from BNPB's InaLogpal logistics platform via its public
  Infografik API (`inalogpal.bnpb.go.id/Api/get_infografiks?pcode={BPS}`), summing
  `Mesin Pompa Air` (pompa) and `Tanki Air Mobile` (truk_tangki) per corridor
  kabupaten. Depot coordinates are kabupaten centroids from
  `district_centroids.csv`. Across the 18-kabupaten corridor this is ~22 flood
  pumps and ~9 water tankers in 14 kabupaten (four register neither and get no
  depot; DKI registers neither of the two, so Jakarta Utara draws from Bekasi).
  **Crews (regu) are the one assumption**: InaLogpal publishes no personnel, so
  regu is derived per depot below the equipment count so the shared-crew
  coupling still binds. This is the single unpublished number in the model.

- `data/depots.expanded.json` is a separate, optional planning profile. It keeps
  the 14 evaluated corridor depots, adds registered kabupaten/kota inventory
  whose administrative centroid is within the same 180-minute straight-line
  approximation used by the optimizer, and stores the Banten, West Java, and
  Central Java provincial records as distinct `provincial_reserve` nodes.
  Provincial rows are not child-region totals and are never copied into local
  stock. They remain excluded until an operator records and confirms provincial
  support. Regional/provincial results are exploratory until their hindcast is
  rerun.

## Operational confirmations not supplied by InaLogpal

- Whether each registered unit is working and not already deployed.
- Personnel, drivers, fuel, power, and earliest departure time.
- Exact warehouse coordinates. Kabupaten/kota nodes use administrative
  centroids; provincial nodes use provincial-capital proxies.
- Road travel time. SIAGA currently estimates time from straight-line distance
  at 40 km/h and exposes the chosen limit as an operator scenario control.
