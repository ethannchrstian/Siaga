"""What the interface needs to say about how the models were chosen.

The console previously described the data and the labels and stopped there.
Someone reading it could not tell whether XGBoost was selected or simply
reached for, which is the same impression the concept paper left before the
comparison existed. The evidence was already on disk in results/; this serves
it so the product can show its own working.

Read-only, and every figure comes from a file written by a training run. The
two performance cards on the Metode & Data page used to carry hand-typed
numbers, which drift silently the moment a model is retrained.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter

router = APIRouter()

BACKEND = Path(__file__).resolve().parents[2]
RESULTS = BACKEND / "results"
ARTIFACTS = BACKEND / "app" / "artifacts"

# Display order runs simplest to most elaborate so the table reads as an
# argument rather than a leaderboard: the deployed model is last because it had
# to beat everything above it.
ORDER = ["logistic_regression", "random_forest", "lstm", "stgnn_mass", "xgboost"]

LABELS = {
    "logistic_regression": "Regresi logistik",
    "random_forest": "Random forest",
    "lstm": "LSTM (urutan mentah)",
    "stgnn_mass": "Graf spasial + kekekalan massa",
    "xgboost": "XGBoost",
}

DEPLOYED = "xgboost"


def _load(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


@lru_cache(maxsize=1)
def _payload() -> dict:
    comparison = _load(RESULTS / "model_comparison.json")
    variants = _load(RESULTS / "rob_variants.json")
    metrics = _load(ARTIFACTS / "metrics.json")

    families = []
    for key in ORDER:
        flood = comparison.get("flood", {}).get("models", {}).get(key)
        drought = comparison.get("drought", {}).get("models", {}).get(key)
        if not flood and not drought:
            continue
        families.append({
            "key": key,
            "label": LABELS.get(key, key),
            "deployed": key == DEPLOYED,
            "flood_auc": round(flood["auc"], 3) if flood else None,
            "drought_auc": round(drought["auc"], 3) if drought else None,
        })

    # How the calibrator was picked, per hazard. The choice is made on the
    # Murphy reliability term rather than on Brier, because Brier mixes
    # reliability with resolution and a model can win it while its
    # probabilities still misstate what they mean.
    calibrators = {}
    for hazard in ("flood", "drought"):
        sel = metrics.get(hazard, {}).get("calibrator_selection")
        if not sel:
            continue
        calibrators[hazard] = {
            "chosen": metrics[hazard].get("calibrator"),
            "candidates": [
                {
                    "name": name,
                    "reliability": round(v["reliability"], 5),
                    "worst_gap": round(v["worst_gap"], 3),
                    "brier": round(v["brier"], 4),
                }
                for name, v in sel.items()
            ],
        }

    # The rob head, kept because a documented loss is evidence too.
    rob = {}
    if variants:
        f, p = variants.get("forecast", {}), variants.get("persistence", {})
        if f and p:
            rob = {
                "model_ap": f.get("average_precision"),
                "baseline_ap": p.get("average_precision"),
                "model_auc": f.get("auc"),
                "baseline_auc": p.get("auc"),
                "max_prob": f.get("max_prob"),
                "served": False,
            }

    return {
        "protocol": comparison.get("protocol", {}),
        "families": families,
        "headline": {
            hazard: {
                "auc": round(metrics.get(hazard, {}).get("auc", 0), 3),
                "average_precision": round(
                    metrics.get(hazard, {}).get("average_precision", 0), 3
                ),
                "brier": round(metrics.get(hazard, {}).get("brier", 0), 4),
            }
            for hazard in ("flood", "drought")
            if hazard in metrics
        },
        "calibrators": calibrators,
        "rob": rob,
    }


@router.get("/model-info")
def model_info() -> dict:
    """Model selection evidence, straight from the training outputs."""
    return _payload()
