"""Load the trained models and turn feature rows into calibrated hazard
probabilities. Single source of truth for inference, used by both the offline
history builder (ml/predict_history.py) and the API.
"""

import json
import pickle
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb

ART = Path(__file__).resolve().parents[1] / "artifacts"


@lru_cache(maxsize=1)
def _artifacts() -> dict:
    meta = json.loads((ART / "model_meta.json").read_text())
    out = {"meta": meta}
    for name in ("flood", "drought"):
        booster = xgb.Booster()
        booster.load_model(str(ART / f"{name}_model.json"))
        with open(ART / f"{name}_calibrator.pkl", "rb") as f:
            cal = pickle.load(f)
        out[name] = {"booster": booster, "cal": cal}
    return out


def _apply_cal(cal: dict, raw: np.ndarray) -> np.ndarray:
    if cal.get("type") == "platt" and cal.get("model") is not None:
        return cal["model"].predict_proba(raw.reshape(-1, 1))[:, 1]
    return raw


def _score(name: str, feats_df: pd.DataFrame) -> np.ndarray:
    art = _artifacts()
    cols = art["meta"][f"{name}_feats"]
    dmat = xgb.DMatrix(feats_df[cols].to_numpy(), feature_names=cols)
    raw = art[name]["booster"].predict(dmat)
    return np.clip(_apply_cal(art[name]["cal"], raw), 0.0, 1.0)


def score_flood(feats_df: pd.DataFrame) -> np.ndarray:
    return _score("flood", feats_df)


def score_drought(feats_df: pd.DataFrame) -> np.ndarray:
    return _score("drought", feats_df)


def operating_thresholds() -> dict:
    art = _artifacts()
    return {
        name: float(art[name]["cal"].get("op_threshold", 0.5))
        for name in ("flood", "drought")
    }
