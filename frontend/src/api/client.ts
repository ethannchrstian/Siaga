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
  // False for the six kecamatan with no modelled river. Their probabilities
  // are zero because nothing was computed, not because anything was found to
  // be safe, and the interface must never render them as 0%.
  modeled: boolean;
  // Observed standing water from Sentinel-1 radar. Null where the month has
  // no usable radar coverage. This is a measurement, not a prediction.
  rob: RobReading | null;
  // Radar sees water where the flood model called this district quiet. The
  // flood head is trained on river discharge and cannot see tidal rob.
  rob_blind_spot: boolean;
}

export type RobLevel = "tinggi" | "waspada" | "normal" | "tak_terpantau";

export interface RobReading {
  // Share of the kecamatan returning open-water backscatter this month.
  water_frac: number;
  // What this kecamatan normally shows in this calendar month. Irrigated
  // paddy is radar-dark too, so the raw fraction alone means nothing.
  baseline: number | null;
  // water_frac - baseline. This is what the map colours.
  anomaly: number | null;
  level: RobLevel;
  // Permanent water grew here across the decade: subsidence, not weather.
  chronic: boolean;
  trend: number;
  // Rob is a coastal mechanism. Inland, high water is usually a reservoir, so
  // the blind-spot claim is only made where the kecamatan fronts the sea.
  coastal: boolean;
}

export interface RiskResponse {
  date: string;
  date_min: string;
  date_max: string;
  // Radar is an optional layer; false hides the mode rather than breaking it.
  rob_available: boolean;
  // The calendar month the radar figures were observed in. Sentinel-1
  // revisits every 12 days, so a single day has no reading.
  rob_month: string | null;
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

// ---- Operator overrides -------------------------------------------------
// Recorded server-side so the record outlives one browser. See
// backend/app/routers/decisions.py for why none of this retrains anything.

export interface DecisionPost {
  kind: string;
  date: string;
  district_id?: string;
  district?: string;
  resource?: string;
  units?: number;
  operator: string;
}

export interface ContestedDistrict {
  district: string;
  count: number;
}

export interface DecisionSummary {
  total: number;
  overrides: number;
  /** Kecamatan the operator overrules most: where the model's inputs are
   *  probably wrong, judged by someone who knows the ground. */
  contested: ContestedDistrict[];
}

export const recordDecision = (body: DecisionPost) =>
  postJSON<{ recorded: boolean }>("/decisions", body);

export const getDecisions = () => getJSON<DecisionSummary>("/decisions");

// ---- Session ------------------------------------------------------------
// The server verifies and issues the token; see backend/app/routers/auth.py
// for what this does and does not protect.

const TOKEN_KEY = "siaga_token";

export interface Session {
  display: string;
  role: string;
}

export function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function login(username: string, password: string): Promise<Session> {
  const res = await postJSON<Session & { token: string }>("/auth/login", {
    username,
    password,
  });
  try {
    localStorage.setItem(TOKEN_KEY, res.token);
  } catch {
    // Storage disabled: the session still works until this tab is closed.
  }
  return { display: res.display, role: res.role };
}

/** Restores a session across a reload. Rejects on an unknown or expired
 *  token, which is the signal to show the sign-in screen again. */
export async function currentSession(): Promise<Session> {
  const token = storedToken();
  if (!token) throw new Error("no session");
  const res = await fetch(`${BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("session rejected");
  return res.json() as Promise<Session>;
}

export function clearSession(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // nothing to clear
  }
}

// ---- Model selection evidence -------------------------------------------
// Served from the training outputs rather than typed into the page, so the
// figures cannot drift away from the models actually deployed.

export interface ModelFamily {
  key: string;
  label: string;
  deployed: boolean;
  flood_auc: number | null;
  drought_auc: number | null;
}

export interface CalibratorCandidate {
  name: string;
  reliability: number;
  worst_gap: number;
  brier: number;
}

export interface ModelInfo {
  protocol: { split?: string; calibration?: string; folds?: number; seed?: number };
  families: ModelFamily[];
  headline: Record<string, { auc: number; average_precision: number; brier: number }>;
  calibrators: Record<string, { chosen: string; candidates: CalibratorCandidate[] }>;
  /** The radar-labelled head: trained, evaluated, and beaten by a naive
   *  persistence baseline on average precision, so it is not served. */
  rob: {
    model_ap?: number;
    baseline_ap?: number;
    model_auc?: number;
    baseline_auc?: number;
    max_prob?: number;
    served?: boolean;
  };
}

export const getModelInfo = () => getJSON<ModelInfo>("/model-info");
