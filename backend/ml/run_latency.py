"""End-to-end latency of the /allocate path, measured rather than asserted.

The concept paper, the README and both pitch decks all claim the plan
re-optimises "in about 1.5 seconds". Nothing in the repository ever measured
that. This script does, on the real request path through FastAPI, and writes
results/latency.json so the claim can be corrected to whatever is true.

Three cases, because they are not the same number and the decks conflate them:

  cold      first call in a fresh process, including parquet load
  warm      steady state, corridor-wide solve for a date
  re-solve  warm, with one line locked, which is what an operator actually
            waits on after an override

Run:
    venv/Scripts/python ml/run_latency.py
"""

from __future__ import annotations

import json
import platform
import statistics
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent
RESULTS = BACKEND / "results"
sys.path.insert(0, str(BACKEND))   # run from ml/, import the app package
OUT = RESULTS / "latency.json"

N_DATES = 60          # sampled across seasons, not a single lucky week
SEED = 42


def machine() -> dict:
    """Latency without the machine it was measured on is not a number."""
    info = {
        "platform": platform.platform(),
        "processor": platform.processor() or "unknown",
        "python": platform.python_version(),
    }
    try:
        import os
        info["cpu_count"] = os.cpu_count()
    except Exception:
        pass
    return info


def summarise(xs: list[float]) -> dict:
    xs = sorted(xs)
    return {
        "n": len(xs),
        "p50_ms": round(statistics.median(xs), 1),
        "p95_ms": round(xs[min(int(0.95 * len(xs)), len(xs) - 1)], 1),
        "max_ms": round(xs[-1], 1),
        "mean_ms": round(statistics.mean(xs), 1),
    }


def main() -> None:
    RESULTS.mkdir(exist_ok=True)

    # Cold has to be timed before anything else touches the service, because
    # the first call is what pays for loading risk_history.parquet.
    t0 = time.perf_counter()
    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app)
    r = client.post("/allocate", json={"date": "2024-02-05"})
    r.raise_for_status()
    cold_ms = (time.perf_counter() - t0) * 1000
    print("cold (process start to first plan): %.0f ms" % cold_ms)

    hist = pd.read_parquet(BACKEND / "data" / "risk_history.parquet")
    dates = np.array(sorted(hist["date"].unique()))
    pick = np.random.RandomState(SEED).choice(len(dates), N_DATES, replace=False)
    sample = [pd.Timestamp(dates[i]).strftime("%Y-%m-%d") for i in sorted(pick)]

    warm, resolve, breakdown = [], [], []
    for i, d in enumerate(sample, 1):
        t = time.perf_counter()
        r = client.post("/allocate", json={"date": d})
        warm.append((time.perf_counter() - t) * 1000)
        body = r.json()
        breakdown.append(body["timing_ms"])

        # An operator override re-solves around one locked line. Pick the top
        # recommendation for this date so the lock is realistic.
        plan = body.get("plan") or []
        if plan:
            top = plan[0]
            lock = [{"district_id": top["district_id"],
                     "resource": top["resource"],
                     "units": int(top["units"])}]
            t = time.perf_counter()
            client.post("/allocate", json={"date": d, "locks": lock})
            resolve.append((time.perf_counter() - t) * 1000)

        if i % 15 == 0:
            print("  %d/%d dates" % (i, len(sample)))

    report = {
        "machine": machine(),
        "n_dates": len(sample),
        "cold_ms": round(cold_ms, 1),
        "warm_full_solve": summarise(warm),
        "warm_resolve_after_lock": summarise(resolve) if resolve else None,
        "stage_medians_ms": {
            k: round(statistics.median([b[k] for b in breakdown]), 1)
            for k in breakdown[0]
        },
        "note": "measured through the FastAPI request path with TestClient, "
                "same code the frontend calls. CBC runs with a 0.5% MIP gap "
                "and a 25 s time limit.",
    }
    OUT.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print()
    print("warm full solve      ", report["warm_full_solve"])
    print("warm re-solve w/ lock", report["warm_resolve_after_lock"])
    print("stage medians        ", report["stage_medians_ms"])
    print("wrote", OUT)


if __name__ == "__main__":
    main()
