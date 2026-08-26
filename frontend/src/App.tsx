import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapView, { type MapHandle } from "./components/MapView";
import Controls, { type CompareMode } from "./components/Controls";
import CompareBanner from "./components/CompareBanner";
import Legend from "./components/Legend";
import Sidebar, { type DiversionOutcome } from "./components/Sidebar";
import DistrictDrawer from "./components/DistrictDrawer";
import DepotDrawer from "./components/DepotDrawer";
import NavRail, { type View } from "./components/NavRail";
import Overview from "./components/Overview";
import Insiden from "./components/Insiden";
import Inventaris from "./components/Inventaris";
import About from "./components/About";
import Toasts, { type Toast } from "./components/Toasts";
import BootSplash from "./components/BootSplash";
import SignIn from "./components/SignIn";
import { ChevronLeftIcon, EyeIcon, ShieldIcon, TargetIcon } from "./icons";
import { useCountUp } from "./hooks/useCountUp";
import ReplayControl from "./components/ReplayControl";
import DispatchOrder from "./components/DispatchOrder";
import SupplyControls, { type ReserveStatus, type SupplyImpact } from "./components/SupplyControls";
import ExplainPanel from "./components/ExplainPanel";
import {
  appendDecision,
  clearLog,
  operatorName,
  readLog,
  type DecisionEntry,
  type DecisionKind,
} from "./decisionLog";
import {
  clearSession,
  currentSession,
  getRobSeries,
  friendlyError,
  getDistricts,
  getRisk,
  getRiskRange,
  getScenario,
  postAllocate,
  explainStatus,
  type RiskRangeResponse,
  type RobSeries,
  type AllocateResponse,
  type DistrictProperties,
  type Lock,
  type PlanItem,
  type Reject,
  type RiskDistrict,
  type ScenarioResponse,
  type SupplyScope,
} from "./api/client";
import type { ViewMode } from "./hazard";
import { computeKpis, fmtCompact, fmtInt } from "./metrics";
import "./App.css";
import "./redesign.css";

const PRESETS = [
  { label: "Dua bahaya Feb 2015", date: "2015-02-19", note: "Stress test alokasi · in-sample" },
  { label: "Kemarau Sep 2023", date: "2023-09-15", note: "Demo ramalan · out-of-sample" },
  { label: "Musim hujan Jan 2024", date: "2024-01-15", note: "Demo ramalan · out-of-sample" },
];

const INITIAL_DATE = "2015-02-19";
const DECISION_CONTEXT_KEY = "siaga_decision_context_v2";

const keyOf = (p: PlanItem) => `${p.district_id}:${p.resource}`;

function summarizeDiversion(pending: DiversionPending, result: AllocateResponse): DiversionOutcome {
  const failed = result.plan.some(
    (item) => item.district_id === pending.district_id && item.resource === pending.resource,
  );
  const totals = (plan: PlanItem[]) => {
    const byDistrict = new Map<string, { district: string; units: number }>();
    for (const item of plan) {
      if (item.resource !== pending.resource || item.district_id === pending.district_id) continue;
      const current = byDistrict.get(item.district_id);
      byDistrict.set(item.district_id, {
        district: item.district,
        units: (current?.units ?? 0) + item.units,
      });
    }
    return byDistrict;
  };
  const before = totals(pending.beforePlan);
  const after = totals(result.plan);
  let remaining = pending.units;
  const destinations = [...after.entries()]
    .map(([districtId, value]) => ({
      districtId,
      district: value.district,
      units: Math.max(value.units - (before.get(districtId)?.units ?? 0), 0),
    }))
    .filter((item) => item.units > 0)
    .sort((a, b) => b.units - a.units)
    .map((item) => {
      const units = Math.min(item.units, remaining);
      remaining -= units;
      return { district: item.district, units };
    })
    .filter((item) => item.units > 0);

  return {
    targetDistrict: pending.district,
    resourceLabel: pending.resource_label,
    removedUnits: pending.units,
    destinations,
    returnedUnits: failed ? 0 : remaining,
    coverageDelta: Math.round(result.comparison.siaga.expected_covered - pending.beforeCovered),
    failed,
  };
}

interface StoredDecisionContext {
  date: string;
  locks: Lock[];
  rejects: Reject[];
}

function loadDecisionContext(expectedDate: string): {
  locks: Map<string, Lock>;
  rejects: Map<string, Reject>;
} {
  try {
    const raw = localStorage.getItem(DECISION_CONTEXT_KEY);
    if (!raw) return { locks: new Map(), rejects: new Map() };
    const stored = JSON.parse(raw) as StoredDecisionContext;
    if (stored.date !== expectedDate) return { locks: new Map(), rejects: new Map() };
    return {
      locks: new Map((stored.locks ?? []).map((item) => [`${item.district_id}:${item.resource}`, item])),
      rejects: new Map((stored.rejects ?? []).map((item) => [`${item.district_id}:${item.resource}`, item])),
    };
  } catch {
    return { locks: new Map(), rejects: new Map() };
  }
}

function storeDecisionContext(
  date: string,
  locks: Map<string, Lock>,
  rejects: Map<string, Reject>,
): void {
  try {
    localStorage.setItem(DECISION_CONTEXT_KEY, JSON.stringify({
      date,
      locks: [...locks.values()],
      rejects: [...rejects.values()],
    } satisfies StoredDecisionContext));
  } catch {
    // Storage disabled: the active plan context remains available in memory.
  }
}

type DiversionPending = Pick<
  PlanItem,
  "district_id" | "district" | "resource" | "resource_label" | "units"
> & {
  beforePlan: PlanItem[];
  beforeCovered: number;
};

/** Sign-in wraps the console so nothing is fetched before there is a session.
 *  "checking" is its own state: rendering the form for a moment and then
 *  replacing it would flash a login screen at an operator who never left. */
export default function App() {
  const [session, setSession] = useState<"checking" | "out" | "in">("checking");

  useEffect(() => {
    currentSession()
      .then(() => setSession("in"))
      .catch(() => setSession("out"));
  }, []);

  if (session === "checking") return <div className="signin-checking" />;
  if (session === "out") return <SignIn onSignedIn={() => setSession("in")} />;
  return <Console onSignOut={() => { clearSession(); setSession("out"); }} />;
}

function Console({ onSignOut }: { onSignOut: () => void }) {
  const [scenario, setScenario] = useState<ScenarioResponse | null>(null);
  // Whether the grounded explanation feature has a key configured. Checked once;
  // the panel stays hidden entirely when the backend has no LLM key.
  const [explainOn, setExplainOn] = useState(false);
  useEffect(() => {
    explainStatus().then((s) => setExplainOn(s.available)).catch(() => setExplainOn(false));
  }, []);
  const [baseSupplyScope, setBaseSupplyScope] = useState<Exclude<SupplyScope, "provincial">>("corridor");
  const [maxTravelMin, setMaxTravelMin] = useState(180);
  const [reserveStatuses, setReserveStatuses] = useState<Record<string, ReserveStatus>>({});
  const confirmedProvincialDepotIds = useMemo(
    () => Object.entries(reserveStatuses).filter(([, status]) => status === "confirmed").map(([id]) => id).sort(),
    [reserveStatuses],
  );
  const confirmedReserveKey = confirmedProvincialDepotIds.join(",");
  const supplyScope: SupplyScope = confirmedProvincialDepotIds.length ? "provincial" : baseSupplyScope;
  const [date, setDate] = useState<string>(INITIAL_DATE);
  const [mode, setMode] = useState<ViewMode>("gabungan");
  const [reachDepotId, setReachDepotId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const pushToast = useCallback((msg: string, kind: Toast["kind"]) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, msg, kind }]);
    setTimeout(
      () => setToasts((current) => current.filter((item) => item.id !== id)),
      5000,
    );
  }, []);

  // Radar time-lapse. Ten years of observed inundation, one frame per month.
  // The map otherwise shows a single month, which reduces the thing this
  // product is arguing -- that the coast is losing land -- to one still frame.
  const [lapse, setLapse] = useState<{ months: string[]; idx: number } | null>(null);
  const lapseDataRef = useRef<RobSeries | null>(null);
  const lapseTimerRef = useRef<number | null>(null);
  const [lapseLoading, setLapseLoading] = useState(false);

  const stopLapse = useCallback(() => {
    if (lapseTimerRef.current !== null) {
      window.clearInterval(lapseTimerRef.current);
      lapseTimerRef.current = null;
    }
    setLapse(null);
  }, []);

  const startLapse = useCallback(async () => {
    if (lapseLoading || lapseTimerRef.current !== null) return;
    setLapseLoading(true);
    try {
      const data = lapseDataRef.current ?? (await getRobSeries());
      lapseDataRef.current = data;
      if (data.months.length === 0) return;
      setLapse({ months: data.months, idx: 0 });
      lapseTimerRef.current = window.setInterval(() => {
        setLapse((cur) => {
          if (!cur) return cur;
          if (cur.idx >= cur.months.length - 1) {
            // Hold on the final frame instead of snapping back to 2015: the
            // last month is the point, and a loop erases it.
            if (lapseTimerRef.current !== null) {
              window.clearInterval(lapseTimerRef.current);
              lapseTimerRef.current = null;
            }
            return cur;
          }
          return { ...cur, idx: cur.idx + 1 };
        });
      }, 110);
    } catch {
      pushToast("Rekaman radar tidak dapat dimuat.", "info");
    } finally {
      setLapseLoading(false);
    }
  }, [lapseLoading, pushToast]);

  useEffect(() => () => {
    if (lapseTimerRef.current !== null) window.clearInterval(lapseTimerRef.current);
  }, []);

  // One frame's worth of anomaly, keyed by district, for MapView to paint.
  const lapseFrame = useMemo(() => {
    const data = lapseDataRef.current;
    if (!lapse || !data) return null;
    const m = new Map<string, number | null>();
    for (const [did, series] of Object.entries(data.districts)) {
      m.set(did, series[lapse.idx] ?? null);
    }
    return m;
  }, [lapse]);

  // Leaving the radar view mid-playback would leave the map painted with a
  // month nothing on screen names any more.
  useEffect(() => {
    if (lapse && mode !== "rob") stopLapse();
  }, [lapse, mode, stopLapse]);
  const [compare, setCompare] = useState<CompareMode>("siaga");
  const [view, setView] = useState<View>("peta");
  const [risk, setRisk] = useState<Map<string, RiskDistrict>>(new Map());
  // Radar coverage for the selected date, and the month it was observed in.
  const [rob, setRob] = useState<{ available: boolean; month: string | null }>({
    available: false,
    month: null,
  });
  const [result, setResult] = useState<AllocateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supplyImpact, setSupplyImpact] = useState<SupplyImpact | null>(null);
  const pendingSupplySnapshotRef = useRef<{
    label: string;
    date: string;
    districts: number;
    people: number;
    units: number;
  } | null>(null);

  const rememberSupplyBaseline = useCallback(() => {
    if (!result) return;
    pendingSupplySnapshotRef.current = {
      label: scenario?.supply_profile.label ?? "Cakupan sebelumnya",
      date: result.date,
      districts: result.summary.n_districts_served,
      people: result.comparison.siaga.expected_covered,
      units: Object.values(result.summary.total_dispatched).reduce((sum, value) => sum + value, 0),
    };
  }, [result, scenario]);

  // Locks are deliberate operator decisions, so they outlive the tab. A control
  // room runs across shift handovers, and a decision that disappears when
  // someone closes a browser is not a decision the next shift can rely on.
  // Rejects are scenario-specific. Restoring one after the date or supply
  // context has changed would silently carry an old field decision forward.
  const initialDecisionContext = useRef(loadDecisionContext(INITIAL_DATE));
  const [locks, setLocks] = useState<Map<string, Lock>>(() => initialDecisionContext.current.locks);
  const [rejects, setRejects] = useState<Map<string, Reject>>(() => initialDecisionContext.current.rejects);
  const [log, setLog] = useState<DecisionEntry[]>(readLog);
  const [showOrder, setShowOrder] = useState(false);
  // Collapsing either side panel hands its width to the map, which matters
  // most when a district drawer is also docked.
  const [planOpen, setPlanOpen] = useState(true);
  const [railOpen, setRailOpen] = useState(true);

  useEffect(() => {
    storeDecisionContext(date, locks, rejects);
  }, [date, locks, rejects]);

  // One place to record a decision, so the audit trail cannot drift from what
  // the buttons actually did.
  const record = useCallback(
    (kind: DecisionKind, p?: Partial<PlanItem>) =>
      setLog(
        appendDecision({
          kind,
          planDate: date,
          districtId: p?.district_id,
          district: p?.district,
          resourceLabel: p?.resource_label,
          units: p?.units,
          peopleExposed: p?.people_exposed,
        }),
      ),
    [date],
  );

  const [selected, setSelected] = useState<string | null>(null);
  const [selectedDepot, setSelectedDepot] = useState<string | null>(null);
  // Kecamatan under the cursor in the plan list, outlined on the map so a card
  // and a place are obviously the same thing.
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const mapHandleRef = useRef<MapHandle>(null);

  // Hindcast replay: sweep the 3 weeks leading into the selected date. While
  // active, risk frames come from the prefetched range (no per-day fetches,
  // no re-solves) and the allocation is hidden until the "decision" lands.
  const [replay, setReplay] = useState<{ dates: string[]; idx: number } | null>(null);
  const [replayLoading, setReplayLoading] = useState(false);
  const replayDataRef = useRef<RiskRangeResponse | null>(null);
  const replayTimerRef = useRef<number | null>(null);
  const replayRequestRef = useRef(0);
  const diversionRef = useRef<DiversionPending | null>(null);
  const [diversionOutcome, setDiversionOutcome] = useState<DiversionOutcome | null>(null);
  const dateRef = useRef(date);
  dateRef.current = date;
  const propsRef = useRef<Map<string, DistrictProperties>>(new Map());
  const [districtMeta, setDistrictMeta] = useState<Map<string, DistrictProperties>>(new Map());

  const changeSupplyScope = (next: Exclude<SupplyScope, "provincial">) => {
    rememberSupplyBaseline();
    setBaseSupplyScope(next);
    record("supply_scope_change");
    pushToast(
      next === "corridor"
        ? "Cakupan dikembalikan ke inventaris koridor yang terevaluasi."
        : "Depot regional terjangkau kini menjadi kandidat perencanaan.",
      "info",
    );
  };

  const requestProvincialSupport = (depotId: string) => {
    setReserveStatuses((current) => ({ ...current, [depotId]: "pending" }));
    record("provincial_support_requested");
    pushToast(
      "Permintaan dukungan provinsi dicatat; inventaris belum masuk rencana sebelum dikonfirmasi.",
      "info",
    );
  };

  const confirmProvincialSupport = (depotId: string) => {
    rememberSupplyBaseline();
    setBaseSupplyScope("regional");
    setReserveStatuses((current) => ({ ...current, [depotId]: "confirmed" }));
    record("provincial_support_confirmed");
    pushToast(
      "Dukungan provinsi dikonfirmasi dan kini dapat dipertimbangkan optimizer.",
      "lock",
    );
  };

  const cancelProvincialSupport = (depotId: string) => {
    if (reserveStatuses[depotId] === "confirmed") rememberSupplyBaseline();
    setReserveStatuses((current) => ({ ...current, [depotId]: "not_requested" }));
    record("provincial_support_cancelled");
    pushToast("Inventaris provinsi dikeluarkan dari rencana aktif.", "info");
  };

  const changeMaxTravel = (value: number) => {
    rememberSupplyBaseline();
    setMaxTravelMin(value);
    record("operational_assumption_change");
    pushToast(`Batas waktu perencanaan diubah menjadi ${value} menit.`, "info");
  };

  useEffect(() => {
    getScenario(supplyScope, 100, confirmedProvincialDepotIds)
      .then(setScenario)
      .catch((e) => setError(friendlyError(e)));
  }, [confirmedReserveKey, supplyScope]);

  useEffect(() => {
    getDistricts()
      .then((fc) => {
        const next = new Map<string, DistrictProperties>();
        for (const f of fc.features)
          next.set(f.properties.district_id, f.properties);
        propsRef.current = next;
        setDistrictMeta(next);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    getRisk(date)
      .then((r) => {
        const m = new Map<string, RiskDistrict>();
        for (const d of r.districts) m.set(d.district_id, d);
        setRisk(m);
        setRob({ available: r.rob_available, month: r.rob_month });
        setError(null);
      })
      .catch((e) => setError(friendlyError(e)));
  }, [date]);

  useEffect(() => {
    pendingSupplySnapshotRef.current = null;
    setSupplyImpact(null);
  }, [date]);

  // Leaving the radar window while the radar view is open would show an empty
  // map with no explanation, so fall back to the combined view instead.
  useEffect(() => {
    if (mode === "rob" && !rob.available) setMode("gabungan");
  }, [mode, rob.available]);

  // Coverage delta between consecutive re-solves on the same date: the
  // visible cost/benefit of each Kunci/Alihkan decision.
  const [coverageDelta, setCoverageDelta] = useState<number | null>(null);
  const prevCoveredRef = useRef<{ date: string; covered: number } | null>(null);
  const deltaTimerRef = useRef<number | null>(null);
  const allocationRequestRef = useRef(0);

  useEffect(() => {
    // A change in the available network is a new scenario, not an operator
    // override. Do not present its coverage difference as a lock/reject gain.
    prevCoveredRef.current = null;
    setCoverageDelta(null);
  }, [confirmedReserveKey, maxTravelMin, supplyScope]);

  const reallocate = useCallback(() => {
    const requestId = ++allocationRequestRef.current;
    setLoading(true);
    postAllocate({
      date,
      locks: [...locks.values()],
      rejects: [...rejects.values()],
      supply_scope: supplyScope,
      availability_pct: 100,
      max_travel_min: maxTravelMin,
      confirmed_provincial_depot_ids: confirmedProvincialDepotIds,
    })
      .then((res) => {
        if (requestId !== allocationRequestRef.current) return;
        setResult(res);
        setError(null);
        const supplyBefore = pendingSupplySnapshotRef.current;
        if (supplyBefore && supplyBefore.date === res.date) {
          const dispatched = Object.values(res.summary.total_dispatched).reduce((sum, value) => sum + value, 0);
          setSupplyImpact({
            fromLabel: supplyBefore.label,
            toLabel: res.supply_profile.label,
            districtsDelta: res.summary.n_districts_served - supplyBefore.districts,
            peopleDelta: Math.round(res.comparison.siaga.expected_covered - supplyBefore.people),
            unitsDelta: dispatched - supplyBefore.units,
          });
          pendingSupplySnapshotRef.current = null;
        }
        const cov = res.comparison?.siaga.expected_covered;
        if (cov !== undefined) {
          const prev = prevCoveredRef.current;
          if (prev && prev.date === res.date && cov !== prev.covered) {
            setCoverageDelta(cov - prev.covered);
            if (deltaTimerRef.current !== null) clearTimeout(deltaTimerRef.current);
            deltaTimerRef.current = window.setTimeout(
              () => setCoverageDelta(null),
              6000,
            );
          }
          prevCoveredRef.current = { date: res.date, covered: cov };
        }

        const diversion = diversionRef.current;
        if (diversion) {
          const outcome = summarizeDiversion(diversion, res);
          setDiversionOutcome(outcome);
          pushToast(
            outcome.failed
              ? `Pengalihan ${diversion.resource_label} belum berhasil diterapkan.`
              : `Rencana diperbarui setelah alokasi ke ${diversion.district} dikeluarkan.`,
            outcome.failed ? "reject" : "info",
          );
          diversionRef.current = null;
        }
      })
      .catch((e) => {
        if (requestId !== allocationRequestRef.current) return;
        const message = friendlyError(e);
        setError(message);
        if (diversionRef.current) {
          pushToast("Pengalihan gagal. Periksa koneksi backend lalu coba lagi.", "reject");
          diversionRef.current = null;
        }
      })
      .finally(() => {
        if (requestId === allocationRequestRef.current) setLoading(false);
      });
  }, [confirmedReserveKey, date, locks, maxTravelMin, pushToast, rejects, supplyScope]);

  useEffect(() => {
    reallocate();
  }, [reallocate]);

  useEffect(() => () => {
    allocationRequestRef.current += 1;
    replayRequestRef.current += 1;
    if (replayTimerRef.current !== null) clearInterval(replayTimerRef.current);
    if (deltaTimerRef.current !== null) clearTimeout(deltaTimerRef.current);
  }, []);

  const onLock = (p: PlanItem) => {
    const k = keyOf(p);
    const isLocking = !locks.has(k);
    setLocks((prev) => {
      const next = new Map(prev);
      if (next.has(k)) next.delete(k);
      else next.set(k, { district_id: p.district_id, resource: p.resource, units: p.units });
      return next;
    });
    record(isLocking ? "lock" : "unlock", p);
    if (isLocking) {
      // Send the unit down its route so locking reads as a dispatch, not just
      // a button changing colour.
      mapHandleRef.current?.dispatch(p);
      pushToast(
        `Dikunci: ${p.units} ${p.resource_label} berangkat ke ${p.district}.`,
        "lock",
      );
    } else pushToast(`Kunci dilepas untuk ${p.district}.`, "info");
  };
  const onReject = (p: PlanItem) => {
    diversionRef.current = {
      district_id: p.district_id,
      district: p.district,
      resource: p.resource,
      resource_label: p.resource_label,
      units: p.units,
      beforePlan: result?.plan ?? [],
      beforeCovered: result?.comparison.siaga.expected_covered ?? 0,
    };
    setDiversionOutcome(null);
    const k = keyOf(p);
    setRejects((prev) => new Map(prev).set(k, { district_id: p.district_id, resource: p.resource }));
    setLocks((prev) => {
      if (!prev.has(k)) return prev;
      const next = new Map(prev);
      next.delete(k);
      return next;
    });
    record("reject", p);
    // The line animation communicates the operator's access constraint. The
    // optimizer excludes the selected district-resource pair; it does not
    // claim to calculate a replacement road route.
    mapHandleRef.current?.redirect(p);
    pushToast(
      `${p.units} ${p.resource_label} ke ${p.district} dikeluarkan; menghitung ulang rencana…`,
      "reject",
    );
  };
  const onClearReject = (k: string) => {
    const [districtId, resource] = k.split(":");
    const district = risk.get(districtId);
    setRejects((prev) => {
      const next = new Map(prev);
      next.delete(k);
      return next;
    });
    record("clear_reject", {
      district_id: districtId,
      district: district?.name,
      resource: resource as PlanItem["resource"],
      resource_label: resource === "pompa" ? "pompa banjir" : "truk tangki air",
    });
    pushToast("Penolakan dibatalkan. Rencana dioptimasi ulang.", "info");
  };

  const changeDate = (nextDate: string) => {
    if (nextDate === date) return;
    setLocks(new Map());
    setRejects(new Map());
    setDiversionOutcome(null);
    diversionRef.current = null;
    setSelected(null);
    setSelectedDepot(null);
    setReachDepotId(null);
    clearLog();
    setLog(appendDecision({ kind: "date_change", planDate: nextDate }));
    setDate(nextDate);
    pushToast("Tanggal berubah; keputusan dari rencana sebelumnya telah dikosongkan.", "info");
  };

  const applyReplayFrame = useCallback((idx: number) => {
    const data = replayDataRef.current;
    if (!data) return;
    setRisk((prev) => {
      const next = new Map(prev);
      for (const d of data.districts) {
        const cur = next.get(d.district_id);
        if (!cur) continue;
        next.set(d.district_id, {
          ...cur,
          flood_prob: d.flood[idx],
          drought_prob: d.drought[idx],
        });
      }
      return next;
    });
  }, []);

  const stopReplay = useCallback((completed = false) => {
    if (replayTimerRef.current !== null) {
      clearInterval(replayTimerRef.current);
      replayTimerRef.current = null;
    }
    const requestId = ++replayRequestRef.current;
    setReplayLoading(true);
    // Restore the decision date's exact risk (a mid-stop leaves a stale frame).
    getRisk(dateRef.current)
      .then((r) => {
        if (requestId !== replayRequestRef.current) return;
        const m = new Map<string, RiskDistrict>();
        for (const d of r.districts) m.set(d.district_id, d);
        setRisk(m);
        setError(null);
        pushToast(
          completed
            ? "Putar ulang selesai. Rencana keputusan ditampilkan kembali."
            : "Putar ulang dihentikan. Risiko dikembalikan ke tanggal aktif.",
          "info",
        );
      })
      .catch((e) => {
        if (requestId !== replayRequestRef.current) return;
        setError(friendlyError(e));
        pushToast("Gagal mengembalikan risiko ke tanggal aktif.", "reject");
      })
      .finally(() => {
        if (requestId !== replayRequestRef.current) return;
        replayDataRef.current = null;
        setReplay(null);
        setReplayLoading(false);
      });
  }, [pushToast]);

  const startReplay = useCallback(() => {
    if (replayLoading || replayTimerRef.current !== null) return;
    const end = dateRef.current;
    const d0 = new Date(`${end}T00:00:00Z`);
    d0.setUTCDate(d0.getUTCDate() - 20);
    const start = d0.toISOString().slice(0, 10);
    const requestId = ++replayRequestRef.current;
    setReplayLoading(true);
    setError(null);
    getRiskRange(start, end)
      .then((data) => {
        if (requestId !== replayRequestRef.current) return;
        const validFrames = data.dates.length >= 2 && data.districts.every(
          (district) =>
            district.flood.length === data.dates.length &&
            district.drought.length === data.dates.length &&
            district.flood.every(Number.isFinite) &&
            district.drought.every(Number.isFinite),
        );
        if (!validFrames) {
          throw new Error("Data putar ulang tidak lengkap untuk tanggal ini.");
        }
        replayDataRef.current = data;
        setSelected(null);
        setSelectedDepot(null);
        setReplay({ dates: data.dates, idx: 0 });
        applyReplayFrame(0);
        setReplayLoading(false);
        pushToast(`Putar ulang dimulai: ${data.dates.length} hari risiko.`, "info");
        let i = 0;
        replayTimerRef.current = window.setInterval(() => {
          i += 1;
          if (i >= data.dates.length) {
            // Decision date reached: the normal risk/plan return to the map.
            stopReplay(true);
            return;
          }
          setReplay({ dates: data.dates, idx: i });
          applyReplayFrame(i);
        }, 400);
      })
      .catch((e) => {
        if (requestId !== replayRequestRef.current) return;
        const message = friendlyError(e);
        setError(message);
        setReplayLoading(false);
        pushToast("Putar ulang tidak dapat dimulai untuk tanggal ini.", "reject");
      });
  }, [applyReplayFrame, pushToast, replayLoading, stopReplay]);

  const labelFor = useCallback((key: string) => {
    const [did, res] = key.split(":");
    const name = propsRef.current.get(did)?.name ?? did;
    return `${name} · ${res === "pompa" ? "pompa" : "truk tangki"}`;
  }, []);

  const plan = useMemo(() => result?.plan ?? [], [result]);
  // The plan the MAP paints: SIAGA's, or the uncoordinated counterfactual.
  // Hidden during replay so the allocation "fires" only at the decision date.
  const mapPlan = useMemo(
    () =>
      replay
        ? []
        : compare === "siaga"
          ? plan
          : result?.baseline?.plan ?? [],
    [replay, compare, plan, result],
  );
  // Every plan-dependent KPI must follow the comparison toggle. Previously
  // these always read result.plan/result.summary (SIAGA), so switching to the
  // baseline only changed the map while the KPI strip kept SIAGA's figures.
  const activeAllocation = useMemo(
    () => result
      ? compare === "siaga"
        ? { plan: result.plan, summary: result.summary }
        : { plan: result.baseline.plan, summary: result.baseline.summary }
      : null,
    [compare, result],
  );
  const kpis = useMemo(
    () => computeKpis(risk, activeAllocation),
    [risk, activeAllocation],
  );
  // Stable identity so MapView's repaint effect only fires on real changes.
  const lockedKeySet = useMemo(() => new Set(locks.keys()), [locks]);

  // Crew usage for the plan currently on the map (one crew per unit).
  const crew = useMemo(() => {
    const dispatch =
      compare === "siaga"
        ? result?.depot_dispatch
        : result?.baseline?.depot_dispatch;
    const used = Object.values(dispatch ?? {}).reduce(
      (a, d) => a + d.pompa + d.truk_tangki,
      0,
    );
    const total = (scenario?.depots ?? []).reduce(
      (a, d) => a + d.fleet.regu,
      0,
    );
    return { used, total };
  }, [compare, result, scenario]);
  const assignmentsForSelected = useMemo(
    () => mapPlan.filter((p) => p.district_id === selected),
    [mapPlan, selected],
  );
  const openDistrict = (id: string) => {
    setView("peta");
    setSelectedDepot(null);
    setReachDepotId(null);
    setSelected(id);
    // Selecting from a list should move the map, otherwise the operator has to
    // find the kecamatan themselves to see what the card is talking about.
    mapHandleRef.current?.focusDistrict(id);
  };
  const onDepot = (depotId: string) => {
    setSelected(null);
    setSelectedDepot(depotId);
    setReachDepotId((current) => current === depotId ? current : null);
  };
  const depotObj = scenario?.depots.find((d) => d.depot_id === selectedDepot) ?? null;

  return (
    <div className="app">
      {/* The rail is full height and sits beside the command bar, so there is
          one navigation surface rather than two competing strips of chrome. */}
      <NavRail
        operator={operatorName()}
        onSignOut={onSignOut}
        view={view}
        onView={setView}
        monitoringCount={kpis.aboveMonitoring}
        date={date}
        dateMin={scenario?.date_min ?? "2015-01-30"}
        dateMax={scenario?.date_max ?? "2024-12-31"}
        presets={PRESETS}
        onDate={changeDate}
        disabled={replayLoading || replay !== null}
        collapsed={!railOpen}
        onToggleCollapsed={() => setRailOpen((open) => !open)}
      />

      <div className="app-main">
      {error && (
        <div className="errbar" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => { setError(null); setDate((d) => d); reallocate(); }}>
            Coba lagi
          </button>
        </div>
      )}
      {/* Screen readers get told when a re-solve lands; the visual delta badge
          is the only signal otherwise. */}
      <div className="sr-only" aria-live="polite">
        {loading ? "Menghitung ulang rencana alokasi" : result ? `Rencana diperbarui: ${result.summary.n_districts_served} kecamatan` : ""}
      </div>

      <div className="body">

        {view === "peta" && (
          <div className="peta">
            {/* No page title: the active nav item already names the screen, and
                a heading plus a band of cards cost the map ~128px of height. */}
            <section className="stat-strip" aria-label="Ringkasan situasi">
              {/* The coordination gain is the point of the whole system, so it
                  leads the row rather than sitting in a map corner. */}
              {!replay && result?.comparison && (
                <CompareBanner comparison={result.comparison} compare={compare} />
              )}
              <SituationStrip
                monitored={kpis.aboveMonitoring}
                planned={kpis.served}
                proactive={kpis.proactiveAllocations}
                protectedPeople={
                  compare === "siaga"
                    ? result?.comparison?.siaga.expected_covered ?? 0
                    : result?.comparison?.baseline.expected_covered ?? 0
                }
                crew={crew}
              />
            </section>
            <main className={`content${planOpen ? "" : " plan-collapsed"}`}>
              <div className={`map-wrap${selected || selectedDepot ? " with-drawer" : ""}`}>
                {/* Collapsed, the panel leaves behind a tab on the map edge so
                    there is always one obvious way back to the plan. */}
                {!planOpen && (
                  <button
                    type="button"
                    className="plan-reopen"
                    onClick={() => setPlanOpen(true)}
                    title="Tampilkan rencana prapenempatan"
                    aria-label="Tampilkan rencana prapenempatan"
                  >
                    <ChevronLeftIcon size={16} />
                    <span>Rencana</span>
                    {(activeAllocation?.plan.length ?? 0) > 0 && <i>{activeAllocation?.summary.n_districts_served}</i>}
                  </button>
                )}
                <MapView
                  ref={mapHandleRef}
                  risk={risk}
                  mode={mode}
                  depots={scenario?.depots ?? []}
                  plan={mapPlan}
                  onSelect={openDistrict}
                  onDepot={onDepot}
                  highlightedId={hoveredId ?? selected}
                  lockedKeys={lockedKeySet}
                  reachDepotId={reachDepotId}
                  robOverride={lapseFrame}
                />
                <Controls
                  mode={mode}
                  onMode={setMode}
                  robAvailable={rob.available}
                  onTimelapse={mode === "rob" ? startLapse : undefined}
                  timelapseLoading={lapseLoading}
                  timelapseRunning={lapse !== null}
                  counts={{
                    gabungan: kpis.aboveMonitoring,
                    banjir: kpis.floodMonitoring,
                    cekaman: kpis.droughtMonitoring,
                    rob: kpis.robWatch,
                  }}
                  compare={compare}
                  onCompare={setCompare}
                  onReplay={startReplay}
                  disabled={!!replay}
                  replayLoading={replayLoading}
                  supplyControl={(
                    <SupplyControls
                      scope={supplyScope}
                      baseScope={baseSupplyScope}
                      profile={scenario?.supply_profile}
                      depots={scenario?.depots}
                      provincialReserves={scenario?.provincial_reserves}
                      maxTravelMin={maxTravelMin}
                      reserveStatuses={reserveStatuses}
                      impact={supplyImpact}
                      disabled={!!replay || loading}
                      onScope={changeSupplyScope}
                      onMaxTravel={changeMaxTravel}
                      onRequestReserve={requestProvincialSupport}
                      onConfirmReserve={confirmProvincialSupport}
                      onCancelReserve={cancelProvincialSupport}
                    />
                  )}
                />
                {lapse && (
                  <ReplayControl
                    dates={lapse.months}
                    idx={lapse.idx}
                    onStop={stopLapse}
                    label="Genangan terpantau radar"
                    granularity="month"
                  />
                )}
                {replay && (
                  <ReplayControl
                    dates={replay.dates}
                    idx={replay.idx}
                    onStop={() => stopReplay(false)}
                    restoring={replayLoading}
                  />
                )}
                <div className="map-left-stack">
                  <Legend
                    mode={mode}
                    dispatched={
                      (compare === "siaga"
                        ? result?.summary
                        : result?.baseline?.summary
                      )?.total_dispatched
                    }
                  />
                </div>
                {selected && (
                  <DistrictDrawer
                    props={propsRef.current.get(selected) ?? null}
                    risk={risk.get(selected)}
                    assignments={assignmentsForSelected}
                    date={date}
                    calibration={scenario?.calibration}
                    robMonth={rob.month}
                    unserved={
                      selected
                        ? result?.unserved.find((u) => u.district_id === selected) ?? null
                        : null
                    }
                    onClose={() => setSelected(null)}
                  />
                )}
                {depotObj && (
                  <DepotDrawer
                    depot={depotObj}
                    result={result}
                    reachVisible={reachDepotId === depotObj.depot_id}
                    onToggleReach={() => {
                      const turningOn = reachDepotId !== depotObj.depot_id;
                      setReachDepotId(turningOn ? depotObj.depot_id : null);
                      if (turningOn) mapHandleRef.current?.focusDepotReach(depotObj.depot_id);
                    }}
                    onClose={() => {
                      setSelectedDepot(null);
                      setReachDepotId(null);
                    }}
                  />
                )}
              </div>
              <Sidebar
                result={result}
                loading={loading}
                locks={new Set(locks.keys())}
                rejects={new Set(rejects.keys())}
                onLock={onLock}
                onReject={onReject}
                onClearReject={onClearReject}
                onClearLocks={() => {
                  setLocks(new Map());
                  record("clear_all_locks");
                  pushToast("Semua kunci dilepas. Rencana kembali ke rekomendasi optimizer.", "info");
                }}
                onSelect={openDistrict}
                labelFor={labelFor}
                readonly={compare === "terpisah"}
                coverageDelta={coverageDelta}
                diversionOutcome={diversionOutcome}
                onDismissDiversion={() => setDiversionOutcome(null)}
                crew={crew}
                selectedId={selected}
                onHover={setHoveredId}
                onPublishOrder={() => setShowOrder(true)}
                onCollapse={() => setPlanOpen(false)}
                assistant={explainOn ? (
                  <ExplainPanel date={date} result={result} risk={risk} disabled={!!replay || loading} />
                ) : undefined}
              />
            </main>
            {/* Honesty line. Kept on the primary screen rather than buried in
                Metode & Data, because a judge reads the map first. */}
            <footer className="source-note">
              <b>{scenario?.supply_profile.label ?? "Inventaris koridor"} · {scenario?.supply_profile.evaluation_status === "historically_evaluated" ? "profil terevaluasi" : "skenario eksploratif"}.</b>{" "}
              Hindcast 2015–2024, bukan kondisi waktu nyata. Inventaris peralatan terdaftar dari InaLogpal; kesiapan unit dan regu memerlukan konfirmasi BPBD. {" "}
              Curah hujan ERA5 &amp; debit sungai GloFAS via Open-Meteo · batas kecamatan GADM ·
              populasi WorldPop. Lokasi depot adalah centroid administratif; waktu tempuh merupakan estimasi perencanaan.
            </footer>
          </div>
        )}

        {view === "insiden" && (
          <Insiden
            risk={risk}
            plan={plan}
            date={date}
            districtMeta={districtMeta}
            onSelect={openDistrict}
          />
        )}
        {view === "inventaris" && (
          <Inventaris
            depots={scenario?.depots ?? []}
            result={result}
            note={scenario?.note}
            profile={scenario?.supply_profile}
          />
        )}
        {view === "ringkasan" && (
          <Overview
            risk={risk}
            result={result}
            date={date}
            locks={new Set(locks.keys())}
            rejects={new Set(rejects.keys())}
            onSelect={openDistrict}
            onPublishOrder={() => setShowOrder(true)}
          />
        )}
        {view === "tentang" && (
          <About
            dateMin={scenario?.date_min}
            dateMax={scenario?.date_max}
            scenarioNote={scenario?.note}
          />
        )}
      </div>
      </div>

      {showOrder && result && (
        <DispatchOrder
          result={result}
          locks={lockedKeySet}
          log={log}
          planDate={result.date}
          scenarioNote={scenario?.note}
          onClose={() => setShowOrder(false)}
        />
      )}
      <Toasts toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
      {/* An error still lifts the splash: a stuck logo is worse than the
          errbar the user needs to see. */}
      <BootSplash ready={(scenario !== null && risk.size > 0) || error !== null} />
    </div>
  );
}

// The three numbers read as one sentence: this many qualify, the fleet only
// reaches this many, and that protects this many people. The 296-vs-13 gap
// reads as the system ignoring 283 places unless the answer (crews exhausted)
// travels with the middle number, so it stays inline rather than in a footnote.
//
// One row, not three cards. Two of these figures are already printed in the
// sidebar head a few hundred pixels to the right, so the band earns its keep
// through the causal ordering, not through repeating them at tile size.
function SituationStrip({
  monitored,
  planned,
  proactive,
  protectedPeople,
  crew,
}: {
  monitored: number;
  planned: number;
  proactive: number;
  protectedPeople: number;
  crew: { used: number; total: number };
}) {
  const exhausted = crew.total > 0 && crew.used >= crew.total;
  // Same hook the coordination delta uses, a touch quicker so the headline
  // beside these lands last. Without it one figure of four moved on a date
  // change while its neighbours snapped.
  const monitoredNow = useCountUp(monitored, 600);
  const plannedNow = useCountUp(planned, 600);
  const protectedNow = useCountUp(protectedPeople, 600);
  return (
    <div className="situation-strip" aria-label="Alur keputusan: dipantau, dipilih, terlindungi">
      <span className="strip-stat">
        <span className="strip-icon watch" aria-hidden="true"><EyeIcon size={15} /></span>
        <span className="strip-body">
          <b>{fmtInt(monitoredNow)}</b>
          <small>kecamatan dipantau</small>
        </span>
      </span>

      <span className="strip-stat">
        <span className="strip-icon pick" aria-hidden="true"><TargetIcon size={15} /></span>
        <span className="strip-body">
          <span className="strip-figure-row">
            <b>{fmtInt(plannedNow)}</b>
            {crew.total > 0 && (
              <i className={`strip-crew${exhausted ? " is-exhausted" : ""}`} title={`Regu terpakai: ${crew.used} dari ${crew.total}`}>
                regu {fmtInt(crew.used)}/{fmtInt(crew.total)}
                {exhausted ? " · armada habis" : ""}
              </i>
            )}
          </span>
          {/* "1 di bawah ambang" on its own meant nothing to a first-time
              reader. Named as proactive and paired with the number it is
              below, it reads as a deliberate choice rather than a warning. */}
          <small>
            dipilih optimizer
            {proactive > 0 && (
              <em title="Optimizer mempertimbangkan kebutuhan mulai peluang 5%, terpisah dari Ambang Pemantauan 50%.">
                {" "}· {fmtInt(proactive)} proaktif di bawah ambang 50%
              </em>
            )}
          </small>
        </span>
      </span>

      <span className="strip-stat">
        <span className="strip-icon guard" aria-hidden="true"><ShieldIcon size={15} /></span>
        <span className="strip-body">
          <b>{fmtCompact(protectedNow)}</b>
          <small>jiwa terlindungi</small>
        </span>
      </span>
    </div>
  );
}
