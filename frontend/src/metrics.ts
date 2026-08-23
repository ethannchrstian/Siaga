import type { AllocateResponse, RiskDistrict } from "./api/client";
import { CRITICAL_ALLOCATION_THRESHOLD, MONITORING_THRESHOLD } from "./thresholds";

export interface Kpis {
  exposed: number; // people under meaningful risk
  aboveMonitoring: number;
  floodMonitoring: number;
  droughtMonitoring: number;
  // Radar counts, computed here for the same reason as the rest: the map mode
  // switcher and the monitoring page must not arrive at them separately.
  robWatch: number;
  blindSpots: number;
  // Kecamatan the hazard models do not cover at all.
  unmodeled: number;
  totalDistricts: number;
  coveredMonitoring: number;
  proactiveAllocations: number;
  served: number; // districts in the plan
  fleetPct: number;
}

export function computeKpis(
  risk: Map<string, RiskDistrict>,
  result: Pick<AllocateResponse, "plan" | "summary"> | null,
): Kpis {
  let exposed = 0;
  let aboveMonitoring = 0;
  let floodMonitoring = 0;
  let droughtMonitoring = 0;
  let coveredMonitoring = 0;
  let robWatch = 0;
  let blindSpots = 0;
  const plannedIds = new Set((result?.plan ?? []).map((item) => item.district_id));
  for (const d of risk.values()) {
    // An unassessed kecamatan is not a quiet one. Counting its zero would put
    // it in the same bucket as places the models cleared.
    if (!d.modeled) continue;
    const p = Math.max(d.flood_prob, d.drought_prob);
    // people_exposed comes from the backend at full precision. Recomputing it
    // from the rounded probabilities above is what made this page disagree
    // with the plan panel about the same kecamatan.
    if (p >= CRITICAL_ALLOCATION_THRESHOLD) exposed += d.people_exposed;
    if (p >= MONITORING_THRESHOLD) {
      aboveMonitoring += 1;
      if (plannedIds.has(d.district_id)) coveredMonitoring += 1;
    }
    if (d.flood_prob >= MONITORING_THRESHOLD) floodMonitoring += 1;
    if (d.drought_prob >= MONITORING_THRESHOLD) droughtMonitoring += 1;
    // Radar has no probability threshold to cross: it reports observed water
    // against the kecamatan's own seasonal normal, so the bands are the count.
    if (d.rob && (d.rob.level === "waspada" || d.rob.level === "tinggi")) robWatch += 1;
    if (d.rob_blind_spot) blindSpots += 1;
  }
  const served = result?.summary.n_districts_served ?? 0;
  return {
    exposed: Math.round(exposed),
    unmodeled: [...risk.values()].filter((d) => !d.modeled).length,
    aboveMonitoring,
    floodMonitoring,
    droughtMonitoring,
    robWatch,
    blindSpots,
    totalDistricts: risk.size,
    coveredMonitoring,
    proactiveAllocations: Math.max(served - coveredMonitoring, 0),
    served,
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
    // An unassessed kecamatan is not a quiet one. Counting its zero would put
    // it in the same bucket as places the models cleared.
    if (!d.modeled) continue;
    const p = Math.max(d.flood_prob, d.drought_prob);
    if (p < CRITICAL_ALLOCATION_THRESHOLD) continue;
    rows.push({
      district_id: d.district_id,
      name: d.name,
      kabupaten: d.kabupaten,
      exposed: d.people_exposed,
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
  // Indonesian uses a comma as the decimal separator: 24,1 jt, not 24.1 jt.
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".", ",")} jt`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)} rb`;
  return fmtInt(n);
}
