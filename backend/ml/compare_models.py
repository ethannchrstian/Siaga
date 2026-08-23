"""Model family comparison for the flood and water stress heads.

The semifinal scored us 83 on AI Implementation, last among the seven
finalists, and the repository gave no evidence that the model family was ever
chosen rather than defaulted to: train.py fits XGBoost and nothing else. This
script fixes that by running every candidate through the identical protocol
already used in train.py, so the numbers are directly comparable to the
deployed model.

Protocol, held constant for every candidate:

  1. development years 2015-2022, test years 2023-2024, split by year
  2. out-of-fold probabilities across all development rows (5 folds)
  3. isotonic calibration fitted on those out-of-fold scores
  4. refit on all development rows, predict test, apply the calibrator
  5. score AUC, AP, Brier, Murphy reliability term, worst gap above p = 0.5

Calibration is deliberately held fixed rather than re-selected per candidate.
We are comparing model families here, not calibrators; train.py already
established isotonic for both heads.

Run:
    venv/Scripts/python ml/compare_models.py                # trees and linear
    venv/Scripts/python ml/compare_models.py --deep         # adds LSTM and GNN
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    roc_auc_score,
)
from sklearn.model_selection import cross_val_predict
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from xgboost import XGBClassifier

from train import (  # noqa: E402  same-directory import, matches other ml/ scripts
    DROUGHT_FEATS,
    FLOOD_FEATS,
    dev_test_split,
    reliability_term,
    worst_gap_above,
)

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent
DATA = BACKEND / "data"
RESULTS = BACKEND / "results"
OUT = RESULTS / "model_comparison.json"

SEED = 42


# --------------------------------------------------------------- candidates
def _pos_weight(y: pd.Series) -> float:
    ratio = (y == 0).sum() / max((y == 1).sum(), 1)
    return float(np.sqrt(ratio))


def cand_logistic(dev, te, feats, label):
    """The floor. If a linear model on the same features is close, the problem
    did not need anything more."""
    m = make_pipeline(
        StandardScaler(),
        LogisticRegression(max_iter=1000, class_weight="balanced", random_state=SEED),
    )
    oof = cross_val_predict(m, dev[feats], dev[label], cv=5,
                            method="predict_proba", n_jobs=1)[:, 1]
    m.fit(dev[feats], dev[label])
    return oof, m.predict_proba(te[feats])[:, 1]


def cand_random_forest(dev, te, feats, label):
    """Non-boosted tree control. Separates 'trees help' from 'boosting helps'."""
    m = RandomForestClassifier(
        n_estimators=200, max_depth=14, min_samples_leaf=20,
        class_weight="balanced_subsample", n_jobs=-1, random_state=SEED,
    )
    oof = cross_val_predict(m, dev[feats], dev[label], cv=5,
                            method="predict_proba", n_jobs=1)[:, 1]
    m.fit(dev[feats], dev[label])
    return oof, m.predict_proba(te[feats])[:, 1]


def cand_xgboost(dev, te, feats, label):
    """The incumbent, with exactly the hyperparameters train.py deploys."""
    def build():
        return XGBClassifier(
            n_estimators=300, max_depth=5, learning_rate=0.05,
            subsample=0.9, colsample_bytree=0.9,
            scale_pos_weight=_pos_weight(dev[label]),
            eval_metric="logloss", tree_method="hist", random_state=SEED,
        )

    oof = cross_val_predict(build(), dev[feats], dev[label], cv=5,
                            method="predict_proba", n_jobs=1)[:, 1]
    m = build()
    m.fit(dev[feats], dev[label])
    return oof, m.predict_proba(te[feats])[:, 1]


CANDIDATES = {
    "logistic_regression": cand_logistic,
    "random_forest": cand_random_forest,
    "xgboost": cand_xgboost,
}


# ------------------------------------------------------------------ scoring
def calibrate_and_score(oof, y_dev, te_raw, y_te) -> dict:
    """Isotonic fitted on development out-of-fold scores, applied to test.

    Clipped into the open interval for the same reason train.py clips: the
    allocator samples occurrence from these numbers, and a probability of
    exactly 1 asserts a certainty the data cannot support.
    """
    iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
    iso.fit(oof, y_dev)
    te_cal = np.clip(iso.predict(te_raw), 1e-3, 1 - 1e-3)

    return {
        "auc": float(roc_auc_score(y_te, te_cal)),
        "average_precision": float(average_precision_score(y_te, te_cal)),
        "brier": float(brier_score_loss(y_te, te_cal)),
        "brier_uncalibrated": float(brier_score_loss(y_te, te_raw)),
        "reliability": reliability_term(y_te, te_cal),
        "worst_gap_above_0.5": worst_gap_above(y_te, te_cal),
    }


def run_head(name: str, path: Path, feats: list[str], label: str,
             deep: bool) -> dict:
    df = pd.read_parquet(path)
    dev, te = dev_test_split(df)
    y_dev = dev[label].to_numpy(dtype=float)
    y_te = te[label].to_numpy(dtype=float)

    print("\n=== %s ===" % name)
    print("dev %s   test %s   base rate %.4f" % (dev.shape, te.shape, y_te.mean()))

    cands = dict(CANDIDATES)
    if deep:
        from train_deep import deep_candidates  # imported late; needs torch
        cands.update(deep_candidates(name))

    out = {"n_dev": int(len(dev)), "n_test": int(len(te)),
           "positive_rate_test": float(y_te.mean()), "models": {}}

    for cname, fn in cands.items():
        t0 = time.time()
        try:
            oof, te_raw = fn(dev, te, feats, label)
        except Exception as exc:
            print("  %-22s FAILED: %s" % (cname, exc))
            out["models"][cname] = {"error": str(exc)}
            continue
        m = calibrate_and_score(oof, y_dev, te_raw, y_te)
        m["fit_seconds"] = round(time.time() - t0, 1)
        out["models"][cname] = m
        print("  %-22s AUC %.4f  AP %.4f  Brier %.4f  rel %.5f  gap %.3f  (%.0fs)"
              % (cname, m["auc"], m["average_precision"], m["brier"],
                 m["reliability"], m["worst_gap_above_0.5"], m["fit_seconds"]))

    ok = {k: v for k, v in out["models"].items() if "auc" in v}
    if ok:
        out["best_by_auc"] = max(ok, key=lambda k: ok[k]["auc"])
        out["best_by_ap"] = max(ok, key=lambda k: ok[k]["average_precision"])
        print("  best AUC: %s   best AP: %s" % (out["best_by_auc"], out["best_by_ap"]))
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--deep", action="store_true",
                    help="also run the LSTM and graph network (needs torch)")
    ap.add_argument("--head", choices=["flood", "drought", "both"], default="both")
    args = ap.parse_args()

    RESULTS.mkdir(exist_ok=True)
    report = {"protocol": {
        "split": "train/calibrate 2015-2022, test 2023-2024, by year",
        "calibration": "isotonic fitted on development out-of-fold scores",
        "folds": 5,
        "seed": SEED,
    }}

    if args.head in ("flood", "both"):
        report["flood"] = run_head(
            "flood", DATA / "flood_dataset.parquet", FLOOD_FEATS,
            "flood_label", args.deep)
    if args.head in ("drought", "both"):
        report["drought"] = run_head(
            "drought", DATA / "drought_dataset.parquet", DROUGHT_FEATS,
            "drought_label", args.deep)

    OUT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("\nwrote", OUT)


if __name__ == "__main__":
    main()
