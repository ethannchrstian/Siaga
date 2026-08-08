"""Reliability of the two hazard heads on the held-out test years.

The allocator samples scenarios straight from these probabilities, so
calibration matters more than ranking. An 80% flood probability has to mean
that floods follow about 80% of the time, otherwise the CVaR tail the optimizer
protects against is the wrong tail.

Reports, per hazard, on 2023-2024:
  reliability curve  observed frequency against predicted probability, in bins
  Brier decomposition  reliability, resolution and uncertainty (Murphy 1973),
                       where brier = reliability - resolution + uncertainty and
                       lower reliability is better

Outputs (backend/results/):
  reliability.csv       one row per (hazard, bin)
  reliability.json      Brier decomposition per hazard

Run: PYTHONPATH=. python ml/run_reliability.py   (from backend/, venv active)
Needs requirements-dev.txt: this reloads the boosters, unlike the API.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.services.hazard import score_drought, score_flood  # noqa: E402

DATA = BACKEND / "data"
RESULTS = BACKEND / "results"

TEST_FROM_YEAR = 2023
N_BINS = 10
# Bins thinner than this are reported but excluded from worst-gap summaries.
MIN_BIN_N = 20

HAZARDS = {
    "flood": {
        "dataset": "flood_dataset.parquet",
        "label": "flood_label",
        "scorer": score_flood,
        "title": "Banjir 0-72 jam",
    },
    "drought": {
        "dataset": "drought_dataset.parquet",
        "label": "drought_label",
        "scorer": score_drought,
        "title": "Cekaman air bulan depan",
    },
}


def brier_decomposition(y: np.ndarray, p: np.ndarray, bins: np.ndarray) -> dict:
    """Murphy's three-term decomposition.

    brier = reliability - resolution + uncertainty

    reliability  mean squared gap between forecast and observed frequency in
                 each bin. Zero is perfect. This is the calibration term.
    resolution   how far bin frequencies sit from the base rate. Higher is
                 better: it means the forecasts separate events from non-events.
    uncertainty  base rate variance. A property of the data, not the model.
    """
    idx = np.clip(np.digitize(p, bins) - 1, 0, len(bins) - 2)
    base = y.mean()
    n = len(y)
    reliability = resolution = 0.0
    for b in range(len(bins) - 1):
        m = idx == b
        nk = int(m.sum())
        if nk == 0:
            continue
        obs = y[m].mean()
        fc = p[m].mean()
        reliability += nk * (fc - obs) ** 2
        resolution += nk * (obs - base) ** 2
    return {
        "brier": float(np.mean((p - y) ** 2)),
        "reliability": float(reliability / n),
        "resolution": float(resolution / n),
        "uncertainty": float(base * (1 - base)),
        "base_rate": float(base),
        "n": int(n),
    }


def run_one(name: str, cfg: dict) -> tuple[pd.DataFrame, dict]:
    df = pd.read_parquet(DATA / cfg["dataset"])
    test = df[df["year"] >= TEST_FROM_YEAR]
    y = test[cfg["label"]].to_numpy(dtype=float)
    p = np.asarray(cfg["scorer"](test), dtype=float)

    # Equal-width bins. Equal-count bins would hide the sparse high-probability
    # region, which is exactly the region the allocator acts on.
    bins = np.linspace(0.0, 1.0, N_BINS + 1)
    idx = np.clip(np.digitize(p, bins) - 1, 0, N_BINS - 1)

    rows = []
    for b in range(N_BINS):
        m = idx == b
        nk = int(m.sum())
        rows.append(
            {
                "hazard": name,
                "bin_lo": float(bins[b]),
                "bin_hi": float(bins[b + 1]),
                "n": nk,
                "mean_predicted": float(p[m].mean()) if nk else np.nan,
                "observed_freq": float(y[m].mean()) if nk else np.nan,
            }
        )

    frame = pd.DataFrame(rows)
    dec = brier_decomposition(y, p, bins)
    dec["title"] = cfg["title"]
    dec["test_years"] = f"{TEST_FROM_YEAR}-2024"

    # Worst gap, restricted to bins holding enough rows to mean anything. A bin
    # with three observations produces a gap of 0.3 by chance and says nothing
    # about calibration, so quoting the unrestricted maximum is misleading.
    solid = frame[frame["n"] >= MIN_BIN_N]
    gaps = (solid["observed_freq"] - solid["mean_predicted"]).abs()
    dec["worst_gap"] = float(gaps.max()) if len(gaps) else float("nan")
    high = solid[solid["bin_lo"] >= 0.5]
    high_gaps = (high["observed_freq"] - high["mean_predicted"]).abs()
    dec["worst_gap_above_0.5"] = (
        float(high_gaps.max()) if len(high_gaps) else float("nan")
    )
    dec["n_above_0.5"] = int(solid[solid["bin_lo"] >= 0.5]["n"].sum())
    dec["min_bin_n"] = MIN_BIN_N
    return frame, dec


def main() -> None:
    RESULTS.mkdir(parents=True, exist_ok=True)
    frames, decs = [], {}
    for name, cfg in HAZARDS.items():
        frame, dec = run_one(name, cfg)
        frames.append(frame)
        decs[name] = dec
        print(f"[{name}] n={dec['n']:,}  base rate {dec['base_rate']:.4f}")
        print(f"  brier {dec['brier']:.4f} = reliability {dec['reliability']:.5f}"
              f" - resolution {dec['resolution']:.5f}"
              f" + uncertainty {dec['uncertainty']:.5f}")
        print(f"  worst gap (bins with >= {dec['min_bin_n']} rows): "
              f"{dec['worst_gap']:.3f}")
        print(f"  worst gap above 0.5: {dec['worst_gap_above_0.5']:.3f}"
              f"  ({dec['n_above_0.5']:,} rows there)\n")

    pd.concat(frames).to_csv(RESULTS / "reliability.csv", index=False)
    (RESULTS / "reliability.json").write_text(
        json.dumps(decs, indent=2), encoding="utf-8"
    )
    print(f"Wrote reliability.csv and reliability.json to {RESULTS}")


if __name__ == "__main__":
    main()
