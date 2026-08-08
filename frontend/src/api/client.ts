// In production the API is served from the same origin as this bundle, so the
// base is empty and every call is a relative path. In dev, Vite serves the UI
// on :5173 while uvicorn runs on :8000, so point at that unless VITE_API_BASE
// says otherwise (set it to deploy the frontend separately from the API).
const BASE =
  import.meta.env.VITE_API_BASE ??
  (import.meta.env.DEV ? "http://localhost:8000" : "");

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${path} -> ${res.status} ${detail || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

// Raw fetch rejections ("TypeError: Failed to fetch") tell an operator nothing
// and look like a crash during a demo. Translate to something actionable.
export function friendlyError(e: unknown): string {
  const raw = String(e);
  if (/Failed to fetch|NetworkError|ERR_CONNECTION|load failed/i.test(raw))
    return "Tidak dapat terhubung ke server SIAGA. Periksa apakah layanan backend sedang berjalan.";
  if (/-> 5\d\d/.test(raw))
    return "Server SIAGA gagal memproses permintaan. Coba beberapa saat lagi.";
  if (/-> 42\d/.test(raw))
    return "Rentang tanggal tidak valid untuk data yang tersedia.";
  if (/-> 4\d\d/.test(raw))
    return "Data tidak tersedia untuk tanggal ini.";
  return "Terjadi gangguan saat memuat data.";
}

export interface DistrictProperties {
  district_id: string;
  name: string;
  kabupaten: string;
  provinsi: string;
}

export type DistrictCollection = GeoJSON.FeatureCollection<
  GeoJSON.MultiPolygon | GeoJSON.Polygon,
  DistrictProperties
>;

export interface RiskDistrict {
  district_id: string;
  name: string;
  kabupaten: string;
  population: number;
  flood_prob: number;
  drought_prob: number;
  // Canonical: max(flood, drought) x population, computed backend-side at full
  // precision. Always render this rather than recomputing from the rounded
  // probabilities above.
  people_exposed: number;
}

export interface RiskResponse {
  date: string;
  date_min: string;
  date_max: string;
  districts: RiskDistrict[];
}

export interface Depot {
  depot_id: string;
  name: string;
  lat: number;
  lon: number;
  fleet: { truk_tangki: number; pompa: number; regu: number };
}

/** One bin of the reliability curve: what the model said, what happened. */
export interface CalibrationBin {
  lo: number;
  hi: number;
  predicted: number;
  observed: number;
  n: number;
}

export interface HazardCalibration {
  brier: number;
  reliability: number;
  "worst_gap_above_0.5": number;
  base_rate: number;
  test_years: string;
  curve: CalibrationBin[];
  precision_at_op?: number;
  recall_at_op?: number;
}

export interface ScenarioResponse {
  date_min: string;
  date_max: string;
  resources: string[];
  resource_labels: Record<string, string>;
  note: string;
  depots: Depot[];
  /** Absent if the reliability run has not been executed. */
  calibration?: Partial<Record<"flood" | "drought", HazardCalibration>>;
}

export interface PlanItem {
  district_id: string;
  district: string;
  kabupaten: string;
  resource: "pompa" | "truk_tangki";
  resource_label: string;
  units: number;
  from_depot: string;
  minutes: number;
  hazard_prob: number;
  population: number;
  people_exposed: number;
  reason: string;
}

export interface DepotDispatch {
  name: string;
  pompa: number;
  truk_tangki: number;
}

export interface PlanSummary {
  status: string;
  total_dispatched: { pompa: number; truk_tangki: number };
  total_fleet: { pompa: number; truk_tangki: number };
  fleet_used_pct: number;
  n_districts_served: number;
  n_active_districts: number;
}

// People covered / left uncovered, evaluated on the shared scenario ensemble.
export interface CoverageMetrics {
  expected_uncovered: number;
  cvar_uncovered: number;
  expected_covered: number;
  expected_demand: number;
}

export interface AllocateResponse {
  date: string;
  plan: PlanItem[];
  depot_dispatch: Record<string, DepotDispatch>;
  summary: PlanSummary;
  // Counterfactual: uncoordinated per-hazard allocation (paper's B2 config).
  baseline: {
    plan: PlanItem[];
    depot_dispatch: Record<string, DepotDispatch>;
    summary: PlanSummary;
  };
  comparison: {
    siaga: CoverageMetrics;
    baseline: CoverageMetrics;
    delta_protected: number;
    delta_cvar: number;
  };
}

export interface Lock {
  district_id: string;
  resource: string;
  units: number;
}
export interface Reject {
  district_id: string;
  resource: string;
}

// Compact per-district probability series for the hindcast replay.
export interface RiskRangeResponse {
  dates: string[];
  districts: { district_id: string; flood: number[]; drought: number[] }[];
}

export const getDistricts = () =>
  getJSON<DistrictCollection>("/districts");
export const getRiskRange = (start: string, end: string) =>
  getJSON<RiskRangeResponse>(
    `/risk/range?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
  );

export interface DistrictSeries {
  district_id: string;
  dates: string[];
  flood: number[];
  drought: number[];
}
export const getDistrictSeries = (districtId: string, end: string, days = 60) =>
  getJSON<DistrictSeries>(
    `/risk/district/${districtId}?days=${days}&end=${end}`,
  );
export const getRisk = (date?: string) =>
  getJSON<RiskResponse>(`/risk${date ? `?date=${date}` : ""}`);
export const getScenario = () => getJSON<ScenarioResponse>("/scenario");
export const postAllocate = (body: {
  date?: string;
  locks: Lock[];
  rejects: Reject[];
}) => postJSON<AllocateResponse>("/allocate", body);
