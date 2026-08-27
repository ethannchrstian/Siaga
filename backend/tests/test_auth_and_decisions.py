"""Contract tests for sign-in and for the operator decision log.

Both were added because the console was making claims it could not keep: it
showed a "0%" for kecamatan nothing had assessed, and it recorded operator
overrides to a browser and called that an audit trail.
"""

import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.main import app  # noqa: E402
from app.routers import auth as auth_mod  # noqa: E402
from app.routers import decisions as dec_mod  # noqa: E402
from app.services import llm  # noqa: E402

DATE = "2024-02-05"


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


# --------------------------------------------------------------- sign-in


def test_correct_credentials_return_a_session(client):
    r = client.post("/auth/login", json={"username": "admin", "password": "adminletsgowin"})
    assert r.status_code == 200
    body = r.json()
    assert body["token"]
    assert body["display"]


def test_demo_credentials_return_limited_role(client):
    r = client.post("/auth/login", json={"username": "demo", "password": "123"})
    assert r.status_code == 200
    assert r.json()["role"] == "DEMO"


def test_wrong_password_is_refused(client):
    # The retired demo credential must not remain valid after rotation.
    r = client.post("/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 401


def test_unknown_user_is_refused_the_same_way(client):
    """Same status and message as a wrong password, so the response does not
    say which usernames exist."""
    a = client.post("/auth/login", json={"username": "admin", "password": "nope"})
    b = client.post("/auth/login", json={"username": "ghost", "password": "nope"})
    assert a.status_code == b.status_code == 401
    assert a.json()["detail"] == b.json()["detail"]


def test_password_is_never_stored_in_the_clear():
    """The whole point of hashing server-side. If this fails, the sign-in is
    decoration."""
    users = json.loads(auth_mod.USERS.read_text(encoding="utf-8"))
    assert auth_mod.DEFAULT_PASSWORD not in json.dumps(users)
    record = users["admin"]
    assert len(record["hash"]) == auth_mod.DK_LEN * 2
    assert record["salt"] != record["hash"]


def test_session_survives_and_bad_tokens_do_not(client):
    token = client.post(
        "/auth/login", json={"username": "admin", "password": "adminletsgowin"}
    ).json()["token"]
    ok = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert ok.status_code == 200
    assert client.get("/auth/me", headers={"Authorization": "Bearer nonsense"}).status_code == 401
    assert client.get("/auth/me").status_code == 401


def test_logout_invalidates_the_token(client):
    token = client.post(
        "/auth/login", json={"username": "admin", "password": "adminletsgowin"}
    ).json()["token"]
    client.post("/auth/logout", headers={"Authorization": f"Bearer {token}"})
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_ai_endpoint_requires_a_session(client):
    r = client.post("/explain", json={"date": DATE, "question": "Ringkas rencana"})
    assert r.status_code == 401


def test_demo_identity_reaches_ai_limit_layer(client, monkeypatch):
    token = client.post(
        "/auth/login", json={"username": "demo", "password": "123"}
    ).json()["token"]
    monkeypatch.setattr(llm, "is_configured", lambda role=None: True)

    def fake_explain(ctx, question=None, actor=None):
        assert actor["username"] == "demo"
        assert actor["role"] == "DEMO"
        return {"text": "ok", "cached": False, "model": "test"}

    monkeypatch.setattr(llm, "explain", fake_explain)
    r = client.post(
        "/explain",
        headers={"Authorization": f"Bearer {token}"},
        json={"date": DATE, "question": "Ringkas rencana"},
    )
    assert r.status_code == 200


def test_demo_daily_quota_is_enforced(tmp_path, monkeypatch):
    monkeypatch.setattr(llm, "USAGE_FILE", tmp_path / "ai_usage.json")
    monkeypatch.setattr(llm, "DEMO_DAILY_LIMIT", 2)
    monkeypatch.setattr(llm, "DEMO_RATE_LIMIT", 99)
    llm._recent_demo_requests.clear()

    first = llm._consume_demo_quota("demo")
    second = llm._consume_demo_quota("demo")
    assert first["remaining"] == 1
    assert second["remaining"] == 0
    with pytest.raises(llm.DemoLimitError):
        llm._consume_demo_quota("demo")


# ------------------------------------------------------------- decisions


def test_decision_is_recorded_and_returned(client, tmp_path, monkeypatch):
    monkeypatch.setattr(dec_mod, "LOG", tmp_path / "decisions.jsonl")
    r = client.post("/decisions", json={
        "kind": "lock", "date": DATE, "district": "Sayung",
        "district_id": "IDN.10.8.12_1", "resource": "pompa", "units": 3,
        "operator": "Uji",
    })
    assert r.status_code == 201
    body = client.get("/decisions").json()
    assert body["overrides"] == 1
    assert body["contested"][0] == {"district": "Sayung", "count": 1}


def test_unknown_kind_is_rejected(client, tmp_path, monkeypatch):
    monkeypatch.setattr(dec_mod, "LOG", tmp_path / "decisions.jsonl")
    r = client.post("/decisions", json={"kind": "sabotage", "date": DATE})
    assert r.status_code == 422


@pytest.mark.parametrize("kind", [
    "supply_scope_change",
    "provincial_support_requested",
    "provincial_support_confirmed",
    "provincial_support_cancelled",
    "operational_assumption_change",
])
def test_supply_decision_kinds_are_recorded(client, tmp_path, monkeypatch, kind):
    """Supply controls share the same audit contract as Kunci/Alihkan."""
    monkeypatch.setattr(dec_mod, "LOG", tmp_path / "decisions.jsonl")
    response = client.post("/decisions", json={"kind": kind, "date": DATE})
    assert response.status_code == 201
    assert client.get("/decisions").json()["entries"][-1]["kind"] == kind


def test_contested_ranks_by_how_often_a_district_is_overruled(client, tmp_path, monkeypatch):
    """The ranking is the whole product of this endpoint: repeated overrides on
    one kecamatan are the operator saying the model's inputs are wrong there."""
    monkeypatch.setattr(dec_mod, "LOG", tmp_path / "decisions.jsonl")
    for _ in range(3):
        client.post("/decisions", json={"kind": "lock", "date": DATE, "district": "Bonang"})
    client.post("/decisions", json={"kind": "reject", "date": DATE, "district": "Sayung"})
    # Not an override: it must not enter the ranking.
    client.post("/decisions", json={"kind": "date_change", "date": DATE, "district": "Sayung"})

    body = client.get("/decisions").json()
    assert body["overrides"] == 4
    assert body["contested"][0] == {"district": "Bonang", "count": 3}


# ------------------------------------------- unmodelled kecamatan on /risk


def test_six_kecamatan_are_marked_unmodelled(client):
    """They have no modelled river reach, so their zero means "not assessed".
    Rendering that as 0% told an operator the opposite on the rob-exposed
    Cirebon coast."""
    body = client.get("/risk", params={"date": DATE}).json()
    unmodeled = [d for d in body["districts"] if not d["modeled"]]
    assert len(unmodeled) == 6
    assert {d["name"] for d in unmodeled} == {
        "Kapetakan", "Pangenan", "Juntinyuat",
        "Kejaksan", "Lemahwungkuk", "Pekalipan",
    }
    assert all(d["flood_prob"] == 0.0 for d in unmodeled)


def test_optimizer_still_solves_with_the_flag_present(client):
    """The flag exists instead of a null precisely so allocator.py keeps
    comparing plain floats against RISK_FLOOR."""
    r = client.post("/allocate", json={"date": DATE})
    assert r.status_code == 200
    assert r.json()["summary"]["status"] == "Optimal"


# ------------------------------------------------------- model selection


def test_model_info_names_every_family_and_the_deployed_one(client):
    """The console has to be able to show that XGBoost was selected rather
    than simply reached for. Until this existed, nothing in the product said
    what the model even was."""
    d = client.get("/model-info").json()
    keys = {f["key"] for f in d["families"]}
    assert {"logistic_regression", "random_forest", "lstm", "stgnn_mass", "xgboost"} <= keys
    deployed = [f for f in d["families"] if f["deployed"]]
    assert len(deployed) == 1 and deployed[0]["key"] == "xgboost"


def test_headline_metrics_come_from_the_trained_artifacts(client):
    """These were hand-typed in About.tsx, so a retrain made the page lie."""
    d = client.get("/model-info").json()
    for hazard in ("flood", "drought"):
        assert 0.5 < d["headline"][hazard]["auc"] <= 1.0


def test_rob_head_is_reported_as_beaten(client):
    """A documented loss is evidence too, and it must not quietly disappear."""
    rob = client.get("/model-info").json()["rob"]
    assert rob["served"] is False
    assert rob["baseline_ap"] > rob["model_ap"]


def test_calibrator_choice_is_exposed_with_its_candidates(client):
    d = client.get("/model-info").json()["calibrators"]["flood"]
    assert d["chosen"] == "isotonic"
    assert {c["name"] for c in d["candidates"]} == {"platt", "isotonic", "identity"}
