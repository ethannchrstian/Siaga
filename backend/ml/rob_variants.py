"""Does the inundation head earn its place on the operator's screen?

Four candidates, one protocol, so the question is settled with numbers instead
of argument. Everything reuses ml/train.py: identical split (develop 2015-2022,
test 2023-2024), identical isotonic calibration, identical metrics.

  nowcast        Features and label from the same month. This is what shipped
                 first, and it is the weak one: radar has already observed
                 that month, so the model answers a question that is already
                 answered.

  forecast       Same features, label moved one month ahead. This is the only
                 variant that tells an operator something radar cannot, and it
                 matches what the other two heads already do.

  forecast_nolag Forecast without anom_lag1 / anom_lag2. Separates genuine
                 skill from persistence: a chronically flooded kecamatan is
                 flooded again next month, and a model that only knows that is
                 not worth a bar on the screen.

  persistence    No model at all. "Next month repeats this month's anomaly."
                 The bar every candidate has to clear. A learned model that
                 cannot beat this is not adding knowledge.

Written before the results were seen, with the pass criteria stated up front so
a poor number cannot be rationalised after the fact:

  1. forecast must beat persistence on AUC and on average precision
  2. average precision is the metric that matters; AUC flatters rare events
  3. the highest probability the model ever emits is reported, because a head
     that never exceeds 0.25 cannot be displayed as a percentage next to heads
     that reach 0.9
  4. a failure is reported as a failure, and rob stays an observation layer

Run: venv/Scripts/python ml/rob_variants.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.model_selection import cross_val_predict

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND / "ml"))

from train import (  # noqa: E402
    ROB_FEATS,
    best_f1_threshold,
    choose_calibrator,
    dev_test_split,
    make_model,
    reliability_term,
    worst_gap_above,
)
from sklearn.isotonic import IsotonicRegression  # noqa: E402
from sklearn.linear_model import LogisticRegression  # noqa: E402

DATA = BACKEND / "data"
RESULTS = BACKEND / "results"

NOLAG_FEATS = [f for f in ROB_FEATS if not f.startswith("anom_lag")]


def _fit_calibrator(kind: str, oof: np.ndarray, y: np.ndarray):
    """Mirror ml/train.py exactly, including the isotonic clip."""
    if kind == "platt":
        m = LogisticRegression(C=1e6, solver="lbfgs")
        m.fit(oof.reshape(-1, 1), y)
        return lambda raw: m.predict_proba(raw.reshape(-1, 1))[:, 1]
    if kind == "isotonic":
        m = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
        m.fit(oof, y)
        return lambda raw: np.clip(m.predict(raw), 1e-3, 1 - 1e-3)
    return lambda raw: raw


def score(y: np.ndarray, p: np.ndarray, op: float) -> dict:
    pred = (p >= op).astype(int)
    tp = int(((pred == 1) & (y == 1)).sum())
    fp = int(((pred == 1) & (y == 0)).sum())
    fn = int(((pred == 0) & (y == 1)).sum())
    return {
        "auc": round(float(roc_auc_score(y, p)), 4),
        "average_precision": round(float(average_precision_score(y, p)), 4),
        "brier": round(float(brier_score_loss(y, p)), 5),
        "reliability": round(float(reliability_term(y, p)), 5),
        "worst_gap_above_0.5": round(float(worst_gap_above(y, p)), 3),
        "precision_at_op": round(tp / max(tp + fp, 1), 3),
        "recall_at_op": round(tp / max(tp + fn, 1), 3),
        "op_threshold": round(float(op), 3),
        "max_prob": round(float(p.max()), 3),
        "frac_above_0.5": round(float((p > 0.5).mean()), 5),
        "base_rate": round(float(y.mean()), 4),
    }


def run_model(df: pd.DataFrame, feats: list[str], label: str) -> dict:
    dev, te = dev_test_split(df)
    X_dev, y_dev = dev[feats], dev[label]
    ratio = (y_dev == 0).sum() / max((y_dev == 1).sum(), 1)
    pos_weight = float(np.sqrt(ratio))

    oof = cross_val_predict(
        make_model(pos_weight), X_dev, y_dev, cv=5, method="predict_proba"
    )[:, 1]
    y_arr = y_dev.to_numpy(dtype=float)
    kind, _ = choose_calibrator(oof, y_arr)
    calibrate = _fit_calibrator(kind, oof, y_arr)

    model = make_model(pos_weight)
    model.fit(X_dev, y_dev)
    te_cal = calibrate(model.predict_proba(te[feats])[:, 1])

    op = best_f1_threshold(y_arr, calibrate(oof))
    out = score(te[label].to_numpy(dtype=float), te_cal, op)
    out["calibrator"] = kind
    out["n_features"] = len(feats)
    return out


def run_persistence(df: pd.DataFrame) -> dict:
    """No model: this month's anomaly, used directly as next month's score.

    Ranking only, so AUC and average precision are meaningful while Brier is
    not; the anomaly is a fraction of area, not a probability. Reported as null
    rather than as a number that invites a false comparison.
    """
    _, te = dev_test_split(df)
    y = te["rob_label_next"].to_numpy(dtype=float)
    p = te["anomaly"].to_numpy(dtype=float)
    return {
        "auc": round(float(roc_auc_score(y, p)), 4),
        "average_precision": round(float(average_precision_score(y, p)), 4),
        "brier": None,
        "base_rate": round(float(y.mean()), 4),
        "note": "no model; ranks next month by this month's observed anomaly",
    }


def main() -> None:
    path = DATA / "rob_dataset.parquet"
    if not path.exists():
        raise SystemExit(f"missing {path}; run ml/build_rob_features.py first")
    df = pd.read_parquet(path)

    res = {
        "nowcast": run_model(df, ROB_FEATS, "rob_label"),
        "forecast": run_model(df, ROB_FEATS, "rob_label_next"),
        "forecast_nolag": run_model(df, NOLAG_FEATS, "rob_label_next"),
        "persistence": run_persistence(df),
    }

    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "rob_variants.json").write_text(
        json.dumps(res, indent=2), encoding="utf-8"
    )

    hdr = f"{'variant':<16}{'AUC':>8}{'AP':>8}{'maxP':>8}{'prec':>8}{'recall':>8}"
    print(hdr)
    print("-" * len(hdr))
    for name, r in res.items():
        print("%-16s%8s%8s%8s%8s%8s" % (
            name,
            r["auc"], r["average_precision"],
            r.get("max_prob", "-"), r.get("precision_at_op", "-"),
            r.get("recall_at_op", "-"),
        ))

    f, p = res["forecast"], res["persistence"]
    nl = res["forecast_nolag"]
    print()
    print("PASS CRITERIA")
    print("  forecast beats persistence on AUC : %s  (%.4f vs %.4f)"
          % ("YES" if f["auc"] > p["auc"] else "NO", f["auc"], p["auc"]))
    print("  forecast beats persistence on AP  : %s  (%.4f vs %.4f)"
          % ("YES" if f["average_precision"] > p["average_precision"] else "NO",
             f["average_precision"], p["average_precision"]))
    print("  skill survives without lags       : %s  (AP %.4f vs %.4f)"
          % ("YES" if nl["average_precision"] > p["average_precision"] else "NO",
             nl["average_precision"], p["average_precision"]))
    print("  highest probability ever emitted  : %.3f" % f["max_prob"])
    print()
    print("wrote", RESULTS / "rob_variants.json")


if __name__ == "__main__":
    main()
