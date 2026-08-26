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
    # rob is optional: it only exists where the Sentinel-1 tables were built,
    # and the two forecast heads must load and serve without it.
    for name in ("flood", "drought", "rob"):
        model_path = ART / f"{name}_model.json"
        if not model_path.exists():
            continue
        booster = xgb.Booster()
        booster.load_model(str(model_path))
        with open(ART / f"{name}_calibrator.pkl", "rb") as f:
            cal = pickle.load(f)
        out[name] = {"booster": booster, "cal": cal}
    return out


def _apply_cal(cal: dict, raw: np.ndarray) -> np.ndarray:
    """Apply the calibrator chosen at training time.

    Must mirror ml/train.py exactly, including the isotonic clip. A mismatch
    here would silently shift every served probability away from the values the
    model was validated on.
    """
    kind, model = cal.get("type"), cal.get("model")
    if model is None:
        return raw
    if kind == "platt":
        return model.predict_proba(raw.reshape(-1, 1))[:, 1]
    if kind == "isotonic":
        return np.clip(model.predict(raw), 1e-3, 1 - 1e-3)
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


def score_rob(feats_df: pd.DataFrame) -> np.ndarray:
    """Probability that radar will see inundation above this kecamatan's own
    seasonal normal next month. Trained on Sentinel-1 labels, so unlike the
    flood head it is not blind to water that arrives without a river."""
    return _score("rob", feats_df)


def has_rob() -> bool:
    return "rob" in _artifacts()


def operating_thresholds() -> dict:
    art = _artifacts()
    return {
        name: float(art[name]["cal"].get("op_threshold", 0.5))
        for name in ("flood", "drought", "rob")
        if name in art
    }
