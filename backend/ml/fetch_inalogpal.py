"""Build an optional reachable-supply profile from InaLogpal.

The evaluated corridor inventory lives in data/depots.json and is deliberately
never rewritten here. InaLogpal, BNPB's national logistics platform, exposes a
public inventory API:

    inalogpal.bnpb.go.id/Api/get_infografiks?pcode={BPS}&jenis_bencana=[...]

keyed by the standard BPS region code, returning each region's equipment with
quantities, condition, and acquisition year. Two of the 57 equipment types are
exactly what SIAGA allocates:

    pompa        <- "Mesin Pompa Air"   (flood pumps)
    truk_tangki  <- "Tanki Air Mobile"  (water tankers)

This script fetches nearby kabupaten/kota and separate provincial rows, filters
regional candidates by planning reach, and writes data/depots.expanded.json.
Counts are registered inventory, not proof that a unit is operational today.

What InaLogpal does NOT publish is personnel. Crews (regu) are the shared
resource the whole coupling rests on, and they are the one number no public
system carries, so they are derived here by a stated rule and labelled as the
single assumption. See CREW_FACTOR below.

Depot coordinates are each kabupaten's centroid, computed from the kecamatan
points already in district_centroids.csv -- real and reproducible, no geocoding.

Input:  backend/data/depots.json   (evaluated corridor profile, never modified)
Output: backend/data/depots.expanded.json
Run:    venv/Scripts/python ml/fetch_inalogpal.py   (from backend/, venv active)
"""

from __future__ import annotations

import copy
import json
import math
import re
import time
import urllib.request
from pathlib import Path

import pandas as pd

BACKEND = Path(__file__).resolve().parents[1]
CENTROIDS = BACKEND / "data" / "district_centroids.csv"
OUT = BACKEND / "data" / "depots.json"
OUT_EXPANDED = BACKEND / "data" / "depots.expanded.json"
GADM = BACKEND.parent / "data-raw" / "gadm41_IDN_3.json.zip"

API = "https://inalogpal.bnpb.go.id/Api/get_infografiks"
# All hazard types, so equipment is not filtered down to one disaster.
HAZARDS = "[1,2,3,4,5,6,7,8,9,10,11,12,13,14]"
UA = {"User-Agent": "Mozilla/5.0 (SIAGA datathon; grounds depots in InaLogpal)"}

# Item names to match, case-insensitive, against InaLogpal's equipment catalogue.
PUMP_RE = re.compile(r"mesin pompa air", re.I)
TANK_RE = re.compile(r"tanki air|tangki air|mobil tangki", re.I)

# The one assumption. InaLogpal has no personnel, so crews are set below the
# depot's own equipment count -- each depot fields fewer operators than it holds
# machines -- which keeps the shared-crew constraint binding and therefore keeps
# the flood/drought coupling alive. Tune this single constant if the corridor
# crew total looks wrong; nothing else about the model changes with it.
CREW_FACTOR = 0.6

# Corridor kabupaten -> BPS Kemendagri code. Demak (3321) and Kota Semarang
# (3374) were confirmed against the live API to match the standard scheme.
# Jakarta Utara's kota code (3175) is empty, and the DKI province row (31)
# turns out to register no "Mesin Pompa Air" or "Tanki Air Mobile" at all --
# only water-treatment vehicles -- so DKI simply has no depot of the two
# resources SIAGA allocates, and those kecamatan draw from adjacent Bekasi.
CORRIDOR = {
    "Jakarta Utara": ("31", True),   # DKI province row; no pumps/tankers there
    "Bekasi": ("3216", False),
    "Kota Bekasi": ("3275", False),
    "Karawang": ("3215", False),
    "Subang": ("3213", False),
    "Indramayu": ("3212", False),
    "Cirebon": ("3209", False),
    "Kota Cirebon": ("3274", False),
    "Brebes": ("3329", False),
    "Tegal": ("3328", False),
    "Kota Tegal": ("3376", False),
    "Pemalang": ("3327", False),
    "Pekalongan": ("3326", False),
    "Kota Pekalongan": ("3375", False),
    "Kendal": ("3324", False),
    "Kota Semarang": ("3374", False),
    "Semarang": ("3322", False),
    "Demak": ("3321", False),
}

# Region codes around the corridor. The generated expanded profile keeps only
# administrative centroids that can reach at least one Pantura kecamatan under
# the same 180 min / 40 km/h approximation used by the runtime optimizer.
# Names on the right match GADM's NAME_1/NAME_2 fields exactly.
REGIONS = [
    # DKI Jakarta
    ("Kepulauan Seribu", "3101", "JakartaRaya", "KepulauanSeribu"),
    ("Jakarta Selatan", "3171", "JakartaRaya", "JakartaSelatan"),
    ("Jakarta Timur", "3172", "JakartaRaya", "JakartaTimur"),
    ("Jakarta Pusat", "3173", "JakartaRaya", "JakartaPusat"),
    ("Jakarta Barat", "3174", "JakartaRaya", "JakartaBarat"),
    ("Jakarta Utara", "3175", "JakartaRaya", "JakartaUtara"),
    # Banten
    ("Pandeglang", "3601", "Banten", "Pandeglang"),
    ("Lebak", "3602", "Banten", "Lebak"),
    ("Tangerang", "3603", "Banten", "Tangerang"),
    ("Serang", "3604", "Banten", "Serang"),
    ("Kota Tangerang", "3671", "Banten", "KotaTangerang"),
    ("Kota Cilegon", "3672", "Banten", "Cilegon"),
    ("Kota Serang", "3673", "Banten", "KotaSerang"),
    ("Kota Tangerang Selatan", "3674", "Banten", "TangerangSelatan"),
    # Jawa Barat
    ("Bogor", "3201", "JawaBarat", "Bogor"),
    ("Sukabumi", "3202", "JawaBarat", "Sukabumi"),
    ("Cianjur", "3203", "JawaBarat", "Cianjur"),
    ("Bandung", "3204", "JawaBarat", "Bandung"),
    ("Garut", "3205", "JawaBarat", "Garut"),
    ("Tasikmalaya", "3206", "JawaBarat", "Tasikmalaya"),
    ("Ciamis", "3207", "JawaBarat", "Ciamis"),
    ("Kuningan", "3208", "JawaBarat", "Kuningan"),
    ("Cirebon", "3209", "JawaBarat", "Cirebon"),
    ("Majalengka", "3210", "JawaBarat", "Majalengka"),
    ("Sumedang", "3211", "JawaBarat", "Sumedang"),
    ("Indramayu", "3212", "JawaBarat", "Indramayu"),
    ("Subang", "3213", "JawaBarat", "Subang"),
    ("Purwakarta", "3214", "JawaBarat", "Purwakarta"),
    ("Karawang", "3215", "JawaBarat", "Karawang"),
    ("Bekasi", "3216", "JawaBarat", "Bekasi"),
    ("Bandung Barat", "3217", "JawaBarat", "BandungBarat"),
    ("Pangandaran", "3218", "JawaBarat", "Pangandaran"),
    ("Kota Bogor", "3271", "JawaBarat", "KotaBogor"),
    ("Kota Sukabumi", "3272", "JawaBarat", "KotaSukabumi"),
    ("Kota Bandung", "3273", "JawaBarat", "KotaBandung"),
    ("Kota Cirebon", "3274", "JawaBarat", "KotaCirebon"),
    ("Kota Bekasi", "3275", "JawaBarat", "KotaBekasi"),
    ("Kota Depok", "3276", "JawaBarat", "Depok"),
    ("Kota Cimahi", "3277", "JawaBarat", "Cimahi"),
    ("Kota Tasikmalaya", "3278", "JawaBarat", "KotaTasikmalaya"),
    ("Kota Banjar", "3279", "JawaBarat", "Banjar"),
    # Jawa Tengah
    ("Cilacap", "3301", "JawaTengah", "Cilacap"),
    ("Banyumas", "3302", "JawaTengah", "Banyumas"),
    ("Purbalingga", "3303", "JawaTengah", "Purbalingga"),
    ("Banjarnegara", "3304", "JawaTengah", "Banjarnegara"),
    ("Kebumen", "3305", "JawaTengah", "Kebumen"),
    ("Purworejo", "3306", "JawaTengah", "Purworejo"),
    ("Wonosobo", "3307", "JawaTengah", "Wonosobo"),
    ("Magelang", "3308", "JawaTengah", "Magelang"),
    ("Boyolali", "3309", "JawaTengah", "Boyolali"),
    ("Klaten", "3310", "JawaTengah", "Klaten"),
    ("Sukoharjo", "3311", "JawaTengah", "Sukoharjo"),
    ("Wonogiri", "3312", "JawaTengah", "Wonogiri"),
    ("Karanganyar", "3313", "JawaTengah", "Karanganyar"),
    ("Sragen", "3314", "JawaTengah", "Sragen"),
    ("Grobogan", "3315", "JawaTengah", "Grobogan"),
    ("Blora", "3316", "JawaTengah", "Blora"),
    ("Rembang", "3317", "JawaTengah", "Rembang"),
    ("Pati", "3318", "JawaTengah", "Pati"),
    ("Kudus", "3319", "JawaTengah", "Kudus"),
    ("Jepara", "3320", "JawaTengah", "Jepara"),
    ("Demak", "3321", "JawaTengah", "Demak"),
    ("Semarang", "3322", "JawaTengah", "Semarang"),
    ("Temanggung", "3323", "JawaTengah", "Temanggung"),
    ("Kendal", "3324", "JawaTengah", "Kendal"),
    ("Batang", "3325", "JawaTengah", "Batang"),
    ("Pekalongan", "3326", "JawaTengah", "Pekalongan"),
    ("Pemalang", "3327", "JawaTengah", "Pemalang"),
    ("Tegal", "3328", "JawaTengah", "Tegal"),
    ("Brebes", "3329", "JawaTengah", "Brebes"),
    ("Kota Magelang", "3371", "JawaTengah", "KotaMagelang"),
    ("Kota Surakarta", "3372", "JawaTengah", "Surakarta"),
    ("Kota Salatiga", "3373", "JawaTengah", "Salatiga"),
    ("Kota Semarang", "3374", "JawaTengah", "KotaSemarang"),
    ("Kota Pekalongan", "3375", "JawaTengah", "KotaPekalongan"),
    ("Kota Tegal", "3376", "JawaTengah", "KotaTegal"),
]

# Provincial entries in InaLogpal are distinct reserve records, not sums copied
# into every child district. Coordinates are planning proxies at the provincial
# capital until the owning BPBD confirms the actual dispatch warehouse.
PROVINCIAL_RESERVES = [
    ("BPBD Provinsi Jawa Barat", "32", -6.91474, 107.60981),
    ("BPBD Provinsi Jawa Tengah", "33", -6.99320, 110.42030),
    ("BPBD Provinsi Banten", "36", -6.12009, 106.15028),
]

REGIONAL_MAX_KM = 40.0 * 180.0 / 60.0


def fetch(pcode: str) -> list[dict]:
    """Equipment detail rows for one region, or [] on any failure."""
    url = f"{API}?pcode={pcode}&jenis_bencana={HAZARDS}"
    req = urllib.request.Request(url, headers=UA)
    payload = json.load(urllib.request.urlopen(req, timeout=45))
    data = payload.get("data") or {}
    if not isinstance(data, dict):
        return []
    node = data.get(pcode, data)
    return node.get("detail", []) if isinstance(node, dict) else []


def count(detail: list[dict]) -> tuple[int, int]:
    """(pumps, tankers), de-duping the rows InaLogpal repeats verbatim."""
    seen: set[tuple] = set()
    pumps = tanks = 0
    for item in detail:
        key = (
            item.get("id"),
            item.get("nama"),
            item.get("tahun"),
            item.get("jumlah"),
        )
        if key in seen:
            continue
        seen.add(key)
        qty = int(item.get("jumlah", 0))
        name = str(item.get("nama", ""))
        if PUMP_RE.search(name):
            pumps += qty
        elif TANK_RE.search(name):
            tanks += qty
    return pumps, tanks


def regional_centroids() -> dict[tuple[str, str], tuple[float, float]]:
    """Administrative centroids for candidate supply regions from local GADM."""
    import geopandas as gpd

    frame = gpd.read_file(f"zip://{GADM}")
    wanted = {(province, name) for _, _, province, name in REGIONS}
    frame = frame[
        frame.apply(lambda r: (r["NAME_1"], r["NAME_2"]) in wanted, axis=1)
    ][["NAME_1", "NAME_2", "geometry"]]
    dissolved = frame.dissolve(by=["NAME_1", "NAME_2"]).reset_index()
    projected = dissolved.to_crs(3857)
    points = projected.geometry.centroid.to_crs(4326)
    return {
        (row.NAME_1, row.NAME_2): (round(point.y, 5), round(point.x, 5))
        for row, point in zip(dissolved.itertuples(), points)
    }


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1 = a
    lat2, lon2 = b
    p = math.pi / 180.0
    value = (
        0.5
        - math.cos((lat2 - lat1) * p) / 2
        + math.cos(lat1 * p)
        * math.cos(lat2 * p)
        * (1 - math.cos((lon2 - lon1) * p))
        / 2
    )
    return 2 * 6371.0 * math.asin(math.sqrt(value))


def reaches_corridor(point: tuple[float, float]) -> bool:
    demand = pd.read_csv(CENTROIDS, usecols=["lat", "lon"])
    return any(
        haversine_km(point, (float(r.lat), float(r.lon))) <= REGIONAL_MAX_KM
        for r in demand.itertuples()
    )


def depot_record(
    pcode: str,
    name: str,
    lat: float,
    lon: float,
    pumps: int,
    tanks: int,
    tier: str,
    location_accuracy: str,
) -> dict:
    crews = max(2, round(CREW_FACTOR * (pumps + tanks)))
    return {
        "depot_id": "DEP-" + pcode,
        "name": name,
        "lat": lat,
        "lon": lon,
        "tier": tier,
        "authority": (
            "provinsi" if tier == "provincial_reserve" else "kabupaten_kota"
        ),
        "inventory_status": "registered_unconfirmed",
        "dispatch_status": (
            "requires_confirmation"
            if tier == "provincial_reserve"
            else "eligible_planning"
        ),
        "location_accuracy": location_accuracy,
        "fleet": {"truk_tangki": tanks, "pompa": pumps, "regu": crews},
    }


def main() -> None:
    # The evaluated corridor file may contain in-progress work and is therefore
    # an immutable input here. This generator creates a separate expanded
    # profile; it never rewrites data/depots.json.
    doc = json.loads(OUT.read_text(encoding="utf-8"))
    depots = doc["depots"]
    region_points = regional_centroids()
    local_codes = {pcode for pcode, _ in CORRIDOR.values()}
    all_codes = {
        pcode for _, pcode, _, _ in REGIONS if pcode not in local_codes
    }
    all_codes.update(pcode for _, pcode, _, _ in PROVINCIAL_RESERVES)

    inventory: dict[str, tuple[int, int]] = {}
    print(f"Fetching {len(all_codes)} InaLogpal region records ...")
    for idx, pcode in enumerate(sorted(all_codes), 1):
        inventory[pcode] = count(fetch(pcode))
        if idx < len(all_codes):
            time.sleep(0.15)  # gentle on a government endpoint

    # Expanded planning profile. Local rows are copied from the evaluated
    # corridor profile, regional rows are admitted only when their centroid is
    # within the runtime reach approximation, and provincial rows remain a
    # separate confirmation-gated tier.
    expanded = []
    for local in depots:
        row = copy.deepcopy(local)
        row.update({
            "tier": "local",
            "authority": "kabupaten_kota",
            "inventory_status": "registered_unconfirmed",
            "dispatch_status": "eligible_planning",
            "location_accuracy": "kabupaten_centroid",
        })
        expanded.append(row)

    for label, pcode, province, gadm_name in REGIONS:
        if pcode in local_codes:
            continue
        point = region_points.get((province, gadm_name))
        if point is None or not reaches_corridor(point):
            continue
        pumps, tanks = inventory[pcode]
        if pumps == 0 and tanks == 0:
            continue
        expanded.append(
            depot_record(
                pcode,
                "BPBD " + label,
                point[0],
                point[1],
                pumps,
                tanks,
                "regional",
                "kabupaten_centroid",
            )
        )

    for name, pcode, lat, lon in PROVINCIAL_RESERVES:
        pumps, tanks = inventory[pcode]
        if pumps == 0 and tanks == 0:
            continue
        expanded.append(
            depot_record(
                pcode,
                name,
                lat,
                lon,
                pumps,
                tanks,
                "provincial_reserve",
                "provincial_capital_proxy",
            )
        )

    expanded.sort(
        key=lambda d: (
            {"local": 0, "regional": 1, "provincial_reserve": 2}[d["tier"]],
            d["name"],
        )
    )
    expanded_doc = {
        "_note": (
            "Equipment counts are registered InaLogpal records fetched on "
            + time.strftime("%Y-%m-%d")
            + ". Local and regional locations use administrative centroids; "
            "provincial locations use the provincial capital as a planning "
            "proxy until the owning BPBD confirms the dispatch warehouse. "
            "Regional candidates are prefiltered to a 180-minute straight-line "
            "planning reach at 40 km/h. Provincial rows are separate reserve "
            "records and are never copied into kabupaten totals. Crews are a "
            "scenario assumption, not InaLogpal personnel data."
        ),
        "resources": ["truk_tangki", "pompa", "regu"],
        "resource_labels": doc["resource_labels"],
        "depots": expanded,
    }
    OUT_EXPANDED.write_text(
        json.dumps(expanded_doc, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    tiers: dict[str, int] = {}
    for row in expanded:
        tiers[row["tier"]] = tiers.get(row["tier"], 0) + 1
    print(f"wrote {OUT_EXPANDED}  ({len(expanded)} depots: {tiers})")


if __name__ == "__main__":
    main()
