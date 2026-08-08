"""Hindcast the four evaluation configurations, and separate the two mechanisms
by which the coupled system can win.

Four ways to decide where a limited fleet goes, all scored on the identical
seeded scenario ensemble:

  B0  reactive          nothing pre-positioned; dispatch happens after the event
                        is declared, so every realized need is unmet at the
                        moment it matters. Scored as the empty plan.
  B1  greedy top-K      one pooled ranking of both hazards by expected people
                        exposed, served nearest-depot-first until stock or crews
                        run out. Crew-aware, risk-blind.
  B2  two desks         flood desk allocates pumps first and takes crews, the
                        drought desk plans trucks from what is left. This is how
                        the two hazards are handled today.
  B3  SIAGA             one MILP over both hazards against the shared crew pool,
                        minimizing E[cost] + beta * CVaR_alpha[cost].

SIAGA can beat the baselines two different ways, and they need separating
because they generalize differently:

  tail-aware placement  the CVaR term places units against the worst scenarios
                        rather than the average one. Available on every date,
                        including single-hazard ones.
  cross-hazard coupling pumps and trucks arguing over one crew pool. Can only
                        matter on days when both hazards actually demand units.

Along the Pantura corridor the two hazards are seasonally anti-correlated: the
wet season demands pumps and no trucks, the dry season the reverse. Compound
days are the exception, so the second mechanism is dormant most of the time and
averaging over all dates hides it. Hence two experiments.

  Experiment 1  all dates in the held-out 2023-2024 test window. Out of sample
                for the hazard models. Measures what the system is worth in
                routine operation.
  Experiment 2  contested days only, drawn from the full 2015-2024 record,
                where both hazards demand units and the smaller of the two
                demands at least MIN_CONTESTED units. Measures what the coupling
                is worth when it is actually live. NOTE: 2015-2022 are training
                years for the hazard models, so hazard probabilities on those
                dates are in-sample and this experiment is reported separately
                and labelled as such. It is a statement about the decision
                layer, not about forecast skill.

Outputs (backend/results/):
  hindcast.csv                one row per (date, config), experiment 1
  hindcast_contested.csv      one row per (date, config), experiment 2
  hindcast_summary.json       aggregates and head-to-head records for both

Run: PYTHONPATH=. python ml/run_hindcast.py   (from backend/, venv active)
"""

from __future__ import annotations

import json
import math
import sys
import time
from pathlib import Path

import pandas as pd

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.services import scenario  # noqa: E402
from app.services.allocator import (  # noqa: E402
    CVAR_ALPHA,
    CVAR_BETA,
    N_SCENARIOS,
    PER_UNIT,
    PROB_KEY,
    RESOURCES,
    RISK_FLOOR,
    SEED,
    active_districts,
    allocate,
)
from app.services.baseline import (  # noqa: E402
    allocate_b1,
    allocate_baseline,
    coverage_metrics,
)

RESULTS = BACKEND / "results"

# ml/train.py trains on 2015-2022 and tests on 2023-2024. Experiment 1 stays
# inside the test window so nothing in the chain has seen these dates.
TEST_START = "2023-01-01"
TEST_END = "2024-12-31"
STRIDE_DAYS = 5

# A day is contested when both hazards demand units and the smaller of the two
# demands at least this many. Below it the minority hazard cannot displace
# enough of the majority to be measurable.
MIN_CONTESTED = 10

CONFIGS = ("B0", "B1", "B2", "B3")
LABELS = {
    "B0": "Reaktif (tanpa prapenempatan)",
    "B1": "Prakiraan + greedy top-K",
    "B2": "Dua meja independen",
    "B3": "SIAGA (MILP terkopel, CVaR)",
}


def unit_demand(records: list[dict]) -> dict[str, int]:
    """Units each hazard would ask for if nothing were scarce."""
    act = active_districts(records)
    return {
        r: sum(
            math.ceil(d[PROB_KEY[r]] * d["population"] / PER_UNIT[r])
            for d in act
            if d[PROB_KEY[r]] >= RISK_FLOOR
        )
        for r in RESOURCES
    }


def plans_for(records: list[dict], depots: list) -> dict[str, list[dict]]:
    """The four plans for one date. B0 pre-positions nothing, by definition."""
    return {
        "B0": [],
        "B1": allocate_b1(records, depots)["plan"],
        "B2": allocate_baseline(records, depots)["plan"],
        "B3": allocate(records, depots)["plan"],
    }


def score_dates(dates, depots, tag: str) -> pd.DataFrame:
    rows = []
    t0 = time.time()
    for n, dt in enumerate(dates, 1):
        ts, records = scenario.risk_records(str(dt))
        demand = unit_demand(records)
        plans = plans_for(records, depots)
        for cfg in CONFIGS:
            m = coverage_metrics(records, plans[cfg])
            rows.append(
                {
                    "date": str(ts.date()),
                    "config": cfg,
                    "expected_uncovered": m["expected_uncovered"],
                    "cvar_uncovered": m["cvar_uncovered"],
                    "expected_demand": m["expected_demand"],
                    "cvar_demand": m["cvar_demand"],
                    "units": sum(p["units"] for p in plans[cfg]),
                    "districts_served": len({p["district_id"] for p in plans[cfg]}),
                    "want_pompa": demand["pompa"],
                    "want_truk": demand["truk_tangki"],
                }
            )
        if n % 25 == 0 or n == len(dates):
            print(f"  [{tag}] {n}/{len(dates)} dates  {time.time() - t0:.0f}s")
    return pd.DataFrame(rows)


def hazard_mix() -> pd.DataFrame:
    """Per-day unit demand of each hazard across the whole record.

    Cached to results/hazard_mix.csv: it needs no solving, but scanning 3624
    dates still costs about 90 seconds and the answer only changes when
    risk_history.parquet is rebuilt. Delete the file to force a rescan.
    """
    cache = RESULTS / "hazard_mix.csv"
    if cache.exists():
        print(f"Hazard mix: reusing {cache.name}")
        return pd.read_csv(cache)

    all_dates = sorted(scenario.risk_history()["date"].drop_duplicates())
    print(f"Hazard mix: scanning {len(all_dates)} dates (no solving)...")
    rows = []
    t0 = time.time()
    for dt in all_dates:
        _, records = scenario.risk_records(str(dt.date()))
        d = unit_demand(records)
        rows.append(
            {
                "date": str(dt.date()),
                "want_pompa": d["pompa"],
                "want_truk": d["truk_tangki"],
                "minor": min(d["pompa"], d["truk_tangki"]),
            }
        )
    df = pd.DataFrame(rows)
    df.to_csv(cache, index=False)
    print(f"  scanned in {time.time() - t0:.0f}s, cached to {cache.name}")
    return df


def find_contested() -> list[str]:
    """Days where both hazards demand units and the smaller one is non-trivial."""
    mix = hazard_mix()
    hits = mix[mix["minor"] >= MIN_CONTESTED]
    print(f"  {len(hits)} contested days of {len(mix)} "
          f"(both hazards, smaller >= {MIN_CONTESTED} units)")
    return list(hits["date"])


def main() -> None:
    RESULTS.mkdir(parents=True, exist_ok=True)
    depots = list(scenario.depots())

    print(f"Ensemble: {N_SCENARIOS} scenarios, seed {SEED}, "
          f"alpha {CVAR_ALPHA}, beta {CVAR_BETA}\n")

    print(f"Experiment 1: routine operation, {TEST_START} to {TEST_END}, "
          f"stride {STRIDE_DAYS}d (out of sample)")
    test_dates = [d.date() for d in pd.date_range(TEST_START, TEST_END,
                                                  freq=f"{STRIDE_DAYS}D")]
    df_test = score_dates(test_dates, depots, "routine")
    df_test.to_csv(RESULTS / "hindcast.csv", index=False)

    print(f"\nExperiment 2: contested days, full record "
          f"(2015-2022 in sample, reported separately)")
    contested = find_contested()
    df_cont = score_dates(contested, depots, "contested")
    df_cont.to_csv(RESULTS / "hindcast_contested.csv", index=False)

    summary = {
        "ensemble": {
            "n_scenarios": N_SCENARIOS,
            "seed": SEED,
            "cvar_alpha": CVAR_ALPHA,
            "cvar_beta": CVAR_BETA,
        },
        "min_contested_units": MIN_CONTESTED,
        "routine": summarize(df_test, TEST_START, TEST_END, "out of sample"),
        "contested": summarize(df_cont, "2015-01-30", "2024-12-31",
                               "2015-2022 in sample"),
    }
    (RESULTS / "hindcast_summary.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8"
    )

    report("EXPERIMENT 1  routine operation, 2023-2024, out of sample",
           summary["routine"])
    report("EXPERIMENT 2  contested days only, full record",
           summary["contested"])
    print(f"\nWrote hindcast.csv, hindcast_contested.csv and "
          f"hindcast_summary.json to {RESULTS}")


def summarize(df: pd.DataFrame, start: str, end: str, sample_note: str) -> dict:
    """Per-config aggregates, plus head-to-head records against B3.

    Coverage is reported as a share of realized demand. Absolute people-counts
    swing by an order of magnitude between a quiet week and a monsoon peak,
    which makes raw means unreadable.
    """
    wide = df.pivot(index="date", columns="config")
    demand = wide["expected_demand"]["B0"]
    cvar_demand = wide["cvar_demand"]["B0"]

    out = {
        "n_dates": int(len(wide)),
        "period": [start, end],
        "sample": sample_note,
        "configs": {},
        "head_to_head_vs_B3": {},
    }

    for cfg in CONFIGS:
        unc = wide["expected_uncovered"][cfg]
        cvar = wide["cvar_uncovered"][cfg]
        out["configs"][cfg] = {
            "label": LABELS[cfg],
            "mean_uncovered": float(unc.mean()),
            "median_uncovered": float(unc.median()),
            "mean_cvar_uncovered": float(cvar.mean()),
            "coverage_pct": float(100.0 * (1.0 - unc.sum() / demand.sum())),
            # Tail coverage compares tail uncovered with demand in those same
            # worst-case scenarios, not with mean demand.
            "tail_coverage_pct": float(
                100.0 * (1.0 - cvar.sum() / cvar_demand.sum())
            ),
            "mean_units": float(wide["units"][cfg].mean()),
            "mean_districts_served": float(wide["districts_served"][cfg].mean()),
        }

    for cfg in ("B0", "B1", "B2"):
        rec = {}
        for metric, key in (("mean", "expected_uncovered"),
                            ("tail", "cvar_uncovered")):
            delta = wide[key][cfg] - wide[key]["B3"]  # positive => B3 better
            rec[metric] = {
                "b3_better": int((delta > 0).sum()),
                "tie": int((delta == 0).sum()),
                "b3_worse": int((delta < 0).sum()),
                "median_gain": float(delta.median()),
                "mean_gain": float(delta.mean()),
                "gain_pct_of_demand": float(
                    100.0 * delta.sum()
                    / (demand.sum() if metric == "mean" else cvar_demand.sum())
                ),
            }
        out["head_to_head_vs_B3"][cfg] = rec

    return out


def report(title: str, s: dict) -> None:
    print(f"\n{title}")
    print(f"  {s['n_dates']} dates, {s['period'][0]} to {s['period'][1]}, "
          f"{s['sample']}")
    print(f"\n  {'':4}{'config':32}{'coverage':>10}{'tail cov':>10}"
          f"{'units':>8}{'kec':>6}")
    for cfg in CONFIGS:
        c = s["configs"][cfg]
        print(f"  {cfg:4}{c['label']:32}{c['coverage_pct']:>9.2f}%"
              f"{c['tail_coverage_pct']:>9.2f}%"
              f"{c['mean_units']:>8.1f}{c['mean_districts_served']:>6.1f}")

    print(f"\n  B3 head-to-head (win / tie / loss, median gain in jiwa):")
    for cfg, rec in s["head_to_head_vs_B3"].items():
        for metric in ("mean", "tail"):
            r = rec[metric]
            print(f"    vs {cfg} [{metric:4}]  "
                  f"{r['b3_better']:>3} / {r['tie']:>3} / {r['b3_worse']:>3}"
                  f"   median {r['median_gain']:+,.0f}")


if __name__ == "__main__":
    main()
