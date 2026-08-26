"""Contract tests for the radar (rob) layer on GET /risk.

Two things must hold. First, the layer is optional: the corridor data ships
without radar and every other view has to keep working, so absence is a shape,
not an error. Second, when radar is present it must never be confused with a
forecast, so the fields it adds are separate and explicitly nullable.
"""

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.main import app  # noqa: E402
from app.services import rob as rob_svc  # noqa: E402

DATE = "2024-02-05"


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


@pytest.fixture(scope="module")
def body(client):
    r = client.get("/risk", params={"date": DATE})
    assert r.status_code == 200
    return r.json()


def test_risk_always_carries_the_rob_fields(body):
    """Present whether or not radar data exists, so the client never branches
    on a missing key."""
    assert "rob_available" in body
    assert "rob_month" in body
    for d in body["districts"][:20]:
        assert "rob" in d
        assert "rob_blind_spot" in d
        assert isinstance(d["rob_blind_spot"], bool)


def test_absent_radar_degrades_instead_of_failing(body):
    if rob_svc.available():
        pytest.skip("radar data present; covered by the tests below")
    assert body["rob_available"] is False
    assert body["rob_month"] is None
    assert all(d["rob"] is None for d in body["districts"])
    assert all(d["rob_blind_spot"] is False for d in body["districts"])


@pytest.mark.skipif(not rob_svc.available(), reason="radar data not built")
def test_reading_shape_and_ranges(body):
    readings = [d["rob"] for d in body["districts"] if d["rob"]]
    assert readings, "radar is built but no district carried a reading"
    for r in readings:
        assert set(r) == {"water_frac", "baseline", "anomaly", "level",
                          "chronic", "trend", "coastal"}
        assert 0.0 <= r["water_frac"] <= 1.0
        assert r["level"] in {"tinggi", "waspada", "normal", "tak_terpantau"}
        if r["anomaly"] is not None and r["baseline"] is not None:
            assert r["anomaly"] == pytest.approx(
                r["water_frac"] - r["baseline"], abs=1e-3
            )


@pytest.mark.skipif(not rob_svc.available(), reason="radar data not built")
def test_month_reported_matches_the_month_requested(body):
    """The caption must name the month the water was actually seen in. Showing
    January's water on a June map would be a silent lie about when."""
    assert body["rob_month"] == "2024-02-01"


@pytest.mark.skipif(not rob_svc.available(), reason="radar data not built")
def test_outside_radar_coverage_is_empty_not_stale(client):
    """Radar covers 2015-2024. A date before it must return nothing rather than
    snapping to the nearest available month."""
    b = client.get("/risk", params={"date": "2015-01-05"}).json()
    early = rob_svc.rob_on("2010-01-05")
    assert early == {}
    assert isinstance(b["rob_available"], bool)


@pytest.mark.skipif(not rob_svc.available(), reason="radar data not built")
def test_blind_spot_requires_both_water_and_a_quiet_model(body):
    """The flag exists to mark disagreement. A district the model already calls
    risky is not a blind spot, however wet radar says it is."""
    for d in body["districts"]:
        if d["rob_blind_spot"]:
            assert d["rob"]["level"] in ("tinggi", "waspada")
            assert d["rob"]["coastal"] is True
            assert d["rob"]["water_frac"] >= rob_svc.MIN_WATER_FRAC
            assert d["flood_prob"] < rob_svc.QUIET_FLOOD_PROB


def test_a_relative_jump_over_almost_no_area_is_not_flagged():
    """2% to 4.5% of a kecamatan clears the anomaly band while covering almost
    nothing, and speckle on one month's composite can produce that much."""
    thin = {"level": "tinggi", "coastal": True, "water_frac": 0.045}
    assert rob_svc.blind_spot(thin, 0.001) is False
    real = {"level": "tinggi", "coastal": True, "water_frac": 0.30}
    assert rob_svc.blind_spot(real, 0.001) is True


def test_rob_probability_is_not_served(body):
    """The rob head loses to a naive persistence baseline on average precision
    (results/rob_variants.json), so its number must not reach the interface."""
    assert "rob_prob" not in body["districts"][0]


def test_blind_spot_helper_is_conservative():
    assert rob_svc.blind_spot(None, 0.0) is False
    quiet = {"level": "normal", "coastal": True, "water_frac": 0.30}
    assert rob_svc.blind_spot(quiet, 0.0) is False
    wet = {"level": "tinggi", "coastal": True, "water_frac": 0.30}
    assert rob_svc.blind_spot(wet, 0.9) is False
    assert rob_svc.blind_spot(wet, 0.0) is True


def test_inland_water_body_is_not_a_blind_spot():
    """Waduk Rawapening reads about 69% water every July with a quiet river.
    It is a reservoir, not a failure of the flood head, and flagging it would
    put a lake at the top of a list of endangered kecamatan."""
    lake = {"level": "tinggi", "coastal": False, "water_frac": 0.69}
    assert rob_svc.blind_spot(lake, 0.001) is False


@pytest.mark.skipif(not rob_svc.available(), reason="radar data not built")
def test_series_covers_every_month_for_every_district(client):
    """The console shows one month at a time, which reduces a decade of
    measured inundation to a single frame. This endpoint is the whole record so
    the interface can play it."""
    d = client.get("/rob/series").json()
    assert len(d["months"]) == 120
    assert d["months"][0] == "2015-01-01"
    assert d["months"][-1] == "2024-12-01"
    for series in d["districts"].values():
        assert len(series) == len(d["months"])


@pytest.mark.skipif(not rob_svc.available(), reason="radar data not built")
def test_series_keeps_gaps_as_null(client):
    """A month a district was never observed in must not be drawn as if it were
    dry, so it stays null rather than becoming a zero."""
    d = client.get("/rob/series").json()
    values = [v for s in d["districts"].values() for v in s]
    assert any(v is None for v in values), "expected at least one unobserved month"
    assert all(v is None or -1.0 <= v <= 1.0 for v in values)


@pytest.mark.skipif(not rob_svc.available(), reason="radar data not built")
def test_series_shows_sayung_crossing_its_own_normal(client):
    """The case the playback exists to make: Sayung sits below the decade
    median early and above it late, which is land turning into water."""
    s = client.get("/rob/series").json()["districts"]["IDN.10.8.12_1"]
    early = [v for v in s[:12] if v is not None]
    late = [v for v in s[-12:] if v is not None]
    assert sum(early) / len(early) < 0 < sum(late) / len(late)
