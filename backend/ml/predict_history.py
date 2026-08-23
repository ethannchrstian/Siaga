"""Score the trained models over the full feature history and save a per-district
daily risk table. Serving reads this table, so predictions are fast and
deterministic, and the hindcast replay slider has every date precomputed.

Output: backend/data/risk_history.parquet
  columns: district_id, date, flood_prob, drought_prob[, rob_prob]
  (flood is daily; drought and rob are monthly, forward-filled onto each day)

rob_prob appears only where the Sentinel-1 tables and the rob model were built.
It is the inundation head: its label comes from radar rather than from a river
discharge percentile, so it covers tidal flooding the flood head cannot
represent at all.

Run: python ml/predict_history.py   (from backend/, venv active, after train.py)
"""

import os
import sys
from pathlib import Path

import pandas as pd

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.services.hazard import (  # noqa: E402
    has_rob,
    score_drought,
    score_flood,
    score_rob,
)

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

    # The rob head is trained and evaluated (ml/rob_variants.py) but not
    # deployed: it loses to a naive persistence baseline on average precision,
    # so serving its probability would put a number on the operator's screen
    # that is beaten by "same as last month". The artifacts stay so the
    # negative result stays reproducible. Set SIAGA_SERVE_ROB=1 to score it.
    rob_path = DATA / "rob_dataset.parquet"
    if os.environ.get("SIAGA_SERVE_ROB") and rob_path.exists() and has_rob():
        rob = pd.read_parquet(rob_path)
        rob = rob[["district_id", "month"]].assign(rob_prob=score_rob(rob))
        rob["ym"] = rob["month"].dt.to_period("M")
        out["ym"] = out["date"].dt.to_period("M")
        out = out.merge(
            rob[["district_id", "ym", "rob_prob"]],
            on=["district_id", "ym"],
            how="left",
        ).drop(columns="ym")
        # Unlike drought, do not fill across the whole record. The rob head
        # needs two months of radar history before it can score anything, and
        # a month a district was never observed in must stay null rather than
        # inherit a neighbouring month's number.
        out["rob_prob"] = out.groupby("district_id")["rob_prob"].ffill(limit=31)
    else:
        print("  rob head trained but not served (loses to persistence); "
              "risk_history has no rob_prob column")

    out = out.sort_values(["district_id", "date"]).reset_index(drop=True)
    out.to_parquet(DATA / "risk_history.parquet", index=False)
    rob_note = ""
    if "rob_prob" in out:
        cov = out["rob_prob"].notna().mean()
        rob_note = (
            f"\n  rob_prob mean {out.rob_prob.mean():.3f} over {cov:.0%} of rows"
        )
    print(
        f"Wrote {len(out):,} rows to risk_history.parquet\n"
        f"  dates {out.date.min().date()}..{out.date.max().date()}, "
        f"{out.district_id.nunique()} districts\n"
        f"  flood_prob mean {out.flood_prob.mean():.3f}, "
        f"drought_prob mean {out.drought_prob.mean():.3f}"
        + rob_note
    )


if __name__ == "__main__":
    main()
