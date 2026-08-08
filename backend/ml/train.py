"""Train the flood and drought models, calibrate, evaluate on a held-out
time split, and save everything the API needs to serve predictions.

Time split (mirrors the paper): train <=2021, val 2022, test 2023-2024.
Calibration matters because the allocator samples scenarios from these
probabilities, so we fit an isotonic calibrator on the validation year and
report Brier score alongside AUC.

Outputs (backend/app/artifacts/):
  flood_model.json, drought_model.json      trained XGBoost boosters
  flood_calibrator.pkl, drought_calibrator.pkl
  model_meta.json                           feature lists
  metrics.json                              test-set metrics (for the slides)

Run: python ml/train.py   (from backend/, venv active)
"""

import json
import pickle
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    f1_score,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from xgboost import XGBClassifier

BACKEND = Path(__file__).resolve().parents[1]
DATA = BACKEND / "data"
ART = BACKEND / "app" / "artifacts"

FLOOD_FEATS = [
    "rain_1d", "rain_3d", "rain_7d", "rain_30d",
    "disc_now", "disc_7d_mean", "disc_change_3d", "month", "coastal",
]
DROUGHT_FEATS = ["spi1", "spi3", "spi6", "p1", "dry_run", "month", "coastal"]


def dev_test_split(df: pd.DataFrame):
    """Development years 2015-2022 (train + calibration), test 2023-2024."""
    dev = df[df["year"] <= 2022]
    te = df[df["year"] >= 2023]
    return dev, te


def best_f1_threshold(y: np.ndarray, p: np.ndarray) -> float:
    """Operating threshold that maximizes F1 on the validation set. Reporting
    P/R at a fixed 0.5 is misleading for calibrated rare-event probabilities."""
    prec, rec, thr = precision_recall_curve(y, p)
    f1 = 2 * prec * rec / np.clip(prec + rec, 1e-9, None)
    return float(thr[max(np.argmax(f1[:-1]), 0)]) if len(thr) else 0.5


def reliability_term(y: np.ndarray, p: np.ndarray, n_bins: int = 10) -> float:
    """Murphy's calibration term: population-weighted mean squared gap between
    forecast and observed frequency. Lower is better."""
    bins = np.linspace(0, 1, n_bins + 1)
    idx = np.clip(np.digitize(p, bins) - 1, 0, n_bins - 1)
    total = 0.0
    for b in range(n_bins):
        m = idx == b
        if m.any():
            total += m.sum() * (p[m].mean() - y[m].mean()) ** 2
    return float(total / len(y))


def worst_gap_above(y: np.ndarray, p: np.ndarray, lo: float = 0.5,
                    min_n: int = 20) -> float:
    """Largest calibration gap in the bins above `lo`.

    This is the region the allocator acts on, and it holds few rows, so a
    global Brier score barely notices when it is wrong. Selecting a calibrator
    on Brier alone is what previously left the drought head predicting 0.86
    where 0.53 was observed.
    """
    bins = np.linspace(0, 1, 11)
    idx = np.clip(np.digitize(p, bins) - 1, 0, 9)
    worst = 0.0
    for b in range(10):
        if bins[b] < lo:
            continue
        m = idx == b
        if m.sum() >= min_n:
            worst = max(worst, abs(p[m].mean() - y[m].mean()))
    return float(worst)


def _fit_platt(raw_tr, y_tr, raw_te):
    lr = LogisticRegression(C=1e6, solver="lbfgs")
    lr.fit(raw_tr.reshape(-1, 1), y_tr)
    return lr.predict_proba(raw_te.reshape(-1, 1))[:, 1]


def _fit_isotonic(raw_tr, y_tr, raw_te):
    ir = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
    ir.fit(raw_tr, y_tr)
    return ir.predict(raw_te)


CALIBRATORS = {"platt": _fit_platt, "isotonic": _fit_isotonic}


def choose_calibrator(raw: np.ndarray, y: np.ndarray) -> tuple[str, dict]:
    """Pick a calibrator on how well it calibrates, not on Brier alone.

    Each candidate is scored with its own inner cross-validation, so a
    calibrator never grades itself on rows it was fitted to. The ranking key is
    the calibration term first and the worst high-probability gap second,
    because a decision layer that samples scenarios from these probabilities is
    hurt precisely where a global average is least sensitive.
    """
    scores = {}
    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    for name, fit in CALIBRATORS.items():
        oof = np.zeros_like(raw)
        for tr, te in skf.split(raw.reshape(-1, 1), y):
            oof[te] = fit(raw[tr], y[tr], raw[te])
        scores[name] = oof
    scores["identity"] = raw

    table = {
        name: {
            "reliability": reliability_term(y, p),
            "worst_gap": worst_gap_above(y, p),
            "brier": float(brier_score_loss(y, p)),
        }
        for name, p in scores.items()
    }
    best = min(table, key=lambda n: (table[n]["reliability"], table[n]["worst_gap"]))

    print("  calibrator selection (inner CV on development years):")
    for name, s in sorted(table.items(), key=lambda kv: kv[1]["reliability"]):
        mark = " <- chosen" if name == best else ""
        print(f"    {name:10} reliability {s['reliability']:.5f}  "
              f"worst gap>0.5 {s['worst_gap']:.3f}  "
              f"brier {s['brier']:.5f}{mark}")
    return best, table


def make_model(pos_weight: float) -> XGBClassifier:
    return XGBClassifier(
        n_estimators=300,
        max_depth=5,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        scale_pos_weight=pos_weight,
        eval_metric="logloss",
        n_jobs=4,
        random_state=42,
    )


def train_one(name: str, df: pd.DataFrame, feats: list[str], label: str) -> dict:
    dev, te = dev_test_split(df)
    X_dev, y_dev = dev[feats], dev[label]
    # Gentle reweighting (sqrt of imbalance) so raw scores are not wildly
    # decalibrated before the Platt step.
    ratio = (y_dev == 0).sum() / max((y_dev == 1).sum(), 1)
    pos_weight = float(np.sqrt(ratio))

    # Out-of-fold probabilities across ALL development years (2015-2022) give a
    # representative basis for calibration, instead of a single unrepresentative
    # validation year. This matters for drought, whose base rate swings year to
    # year with ENSO.
    oof = cross_val_predict(
        make_model(pos_weight), X_dev, y_dev, cv=5, method="predict_proba"
    )[:, 1]

    y_arr = y_dev.to_numpy(dtype=float)
    kind, cal_table = choose_calibrator(oof, y_arr)

    # Refit the chosen calibrator on all development rows for deployment.
    if kind == "platt":
        fitted = LogisticRegression(C=1e6, solver="lbfgs")
        fitted.fit(oof.reshape(-1, 1), y_arr)

        def calibrate(raw: np.ndarray) -> np.ndarray:
            return fitted.predict_proba(raw.reshape(-1, 1))[:, 1]
    elif kind == "isotonic":
        fitted = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
        fitted.fit(oof, y_arr)

        def calibrate(raw: np.ndarray) -> np.ndarray:
            # Isotonic is a step function and will happily return exactly 0 or
            # 1. The allocator samples occurrence from these values, and a
            # probability of exactly 1 asserts a certainty the data cannot
            # support, so keep them strictly inside the open interval.
            return np.clip(fitted.predict(raw), 1e-3, 1 - 1e-3)
    else:
        fitted = None

        def calibrate(raw: np.ndarray) -> np.ndarray:
            return raw

    op_thr = best_f1_threshold(y_dev.values, calibrate(oof))

    # Final model trained on all development years.
    model = make_model(pos_weight)
    model.fit(X_dev, y_dev)

    te_raw = model.predict_proba(te[feats])[:, 1]
    te_cal = calibrate(te_raw)

    y = te[label].values
    metrics = {
        "n_train": int(len(dev)),
        "n_test": int(len(te)),
        "test_years": "2023-2024",
        "positive_rate_test": float(y.mean()),
        "auc": float(roc_auc_score(y, te_cal)),
        "average_precision": float(average_precision_score(y, te_cal)),
        "brier": float(brier_score_loss(y, te_cal)),
        "brier_uncalibrated": float(brier_score_loss(y, te_raw)),
        "operating_threshold": op_thr,
        "precision_at_op": float(precision_score(y, te_cal >= op_thr, zero_division=0)),
        "recall_at_op": float(recall_score(y, te_cal >= op_thr, zero_division=0)),
        "f1_at_op": float(f1_score(y, te_cal >= op_thr, zero_division=0)),
    }
    importances = dict(
        sorted(
            zip(feats, (float(x) for x in model.feature_importances_)),
            key=lambda kv: -kv[1],
        )
    )
    metrics["feature_importance"] = importances

    metrics["reliability"] = reliability_term(y, te_cal)
    metrics["worst_gap_above_0.5"] = worst_gap_above(y, te_cal)

    model.get_booster().save_model(str(ART / f"{name}_model.json"))
    with open(ART / f"{name}_calibrator.pkl", "wb") as f:
        pickle.dump(
            {"type": kind, "model": fitted, "op_threshold": op_thr},
            f,
        )
    metrics["calibrator"] = kind
    metrics["calibrator_selection"] = cal_table

    print(f"\n[{name}]  AUC {metrics['auc']:.3f}  "
          f"AP {metrics['average_precision']:.3f}  "
          f"Brier {metrics['brier']:.4f} (uncal {metrics['brier_uncalibrated']:.4f})  "
          f"P/R/F1@op={op_thr:.2f}: {metrics['precision_at_op']:.2f}/"
          f"{metrics['recall_at_op']:.2f}/{metrics['f1_at_op']:.2f}")
    print("  top features:", list(importances)[:4])
    return metrics


def main() -> None:
    ART.mkdir(parents=True, exist_ok=True)
    flood = pd.read_parquet(DATA / "flood_dataset.parquet")
    drought = pd.read_parquet(DATA / "drought_dataset.parquet")

    metrics = {
        "flood": train_one("flood", flood, FLOOD_FEATS, "flood_label"),
        "drought": train_one("drought", drought, DROUGHT_FEATS, "drought_label"),
    }
    (ART / "model_meta.json").write_text(
        json.dumps({"flood_feats": FLOOD_FEATS, "drought_feats": DROUGHT_FEATS}),
        encoding="utf-8",
    )
    (ART / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    print(f"\nSaved models + metrics to {ART}")


if __name__ == "__main__":
    main()
