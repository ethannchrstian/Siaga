import type { AllocateResponse, RiskDistrict } from "./api/client";

const HI = 0.5;

export interface Kpis {
  exposed: number; // people under meaningful risk
  atRisk: number; // districts with either hazard high
  served: number; // districts in the plan
  fleetPct: number;
}

export function computeKpis(
  risk: Map<string, RiskDistrict>,
  result: AllocateResponse | null,
): Kpis {
  let exposed = 0;
  let atRisk = 0;
  for (const d of risk.values()) {
    const p = Math.max(d.flood_prob, d.drought_prob);
    if (p >= 0.05) exposed += p * d.population;
    if (p >= HI) atRisk += 1;
  }
  return {
    exposed: Math.round(exposed),
    atRisk,
    served: result?.summary.n_districts_served ?? 0,
    fleetPct: result?.summary.fleet_used_pct ?? 0,
  };
}

export interface RankedDistrict {
  district_id: string;
  name: string;
  kabupaten: string;
  exposed: number;
  flood: number;
  drought: number;
  dominant: "flood" | "drought";
}

export function topExposed(
  risk: Map<string, RiskDistrict>,
  n = 8,
): RankedDistrict[] {
  const rows: RankedDistrict[] = [];
  for (const d of risk.values()) {
    const p = Math.max(d.flood_prob, d.drought_prob);
    if (p < 0.05) continue;
    rows.push({
      district_id: d.district_id,
      name: d.name,
      kabupaten: d.kabupaten,
      exposed: Math.round(p * d.population),
      flood: d.flood_prob,
      drought: d.drought_prob,
      dominant: d.drought_prob >= d.flood_prob ? "drought" : "flood",
    });
  }
  return rows.sort((a, b) => b.exposed - a.exposed).slice(0, n);
}

export function fmtInt(n: number): string {
  return n.toLocaleString("id-ID");
}

export function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} jt`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)} rb`;
  return String(n);
}
