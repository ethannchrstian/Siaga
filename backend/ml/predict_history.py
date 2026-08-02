"""Score the trained models over the full feature history and save a per-district
daily risk table. Serving reads this table, so predictions are fast and
deterministic, and the hindcast replay slider has every date precomputed.

Output: backend/data/risk_history.parquet
  columns: district_id, date, flood_prob, drought_prob
  (flood is daily; drought is monthly, forward-filled onto each day of the month)

Run: python ml/predict_history.py   (from backend/, venv active, after train.py)
"""

import sys
from pathlib import Path

import pandas as pd

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.services.hazard import score_drought, score_flood  # noqa: E402

DATA = BACKEND / "data"


def main() -> None:
    flood = pd.read_parquet(DATA / "flood_dataset.parquet")
    drought = pd.read_parquet(DATA / "drought_dataset.parquet")

    flood = flood[["district_id", "date"]].assign(
        flood_prob=score_flood(pd.read_parquet(DATA / "flood_dataset.parquet"))
    )

    drought = drought[["district_id", "date"]].assign(
        drought_prob=score_drought(pd.read_parquet(DATA / "drought_dataset.parquet"))
    )
    drought["ym"] = drought["date"].dt.to_period("M")

    # Broadcast monthly drought prob onto every day, then join to daily flood.
    out = flood.copy()
    out["ym"] = out["date"].dt.to_period("M")
    out = out.merge(
        drought[["district_id", "ym", "drought_prob"]],
        on=["district_id", "ym"],
        how="left",
    ).drop(columns="ym")
    out["drought_prob"] = out.groupby("district_id")["drought_prob"].ffill().bfill()

    out = out.sort_values(["district_id", "date"]).reset_index(drop=True)
    out.to_parquet(DATA / "risk_history.parquet", index=False)
    print(
        f"Wrote {len(out):,} rows to risk_history.parquet\n"
        f"  dates {out.date.min().date()}..{out.date.max().date()}, "
        f"{out.district_id.nunique()} districts\n"
        f"  flood_prob mean {out.flood_prob.mean():.3f}, "
        f"drought_prob mean {out.drought_prob.mean():.3f}"
    )


if __name__ == "__main__":
    main()
