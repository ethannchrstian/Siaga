import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapView from "./components/MapView";
import Controls from "./components/Controls";
import Legend from "./components/Legend";
import Sidebar from "./components/Sidebar";
import DistrictDrawer from "./components/DistrictDrawer";
import DepotDrawer from "./components/DepotDrawer";
import NavRail, { type View } from "./components/NavRail";
import KpiStrip from "./components/KpiStrip";
import Overview from "./components/Overview";
import Insiden from "./components/Insiden";
import Inventaris from "./components/Inventaris";
import About from "./components/About";
import Toasts, { type Toast } from "./components/Toasts";
import Header from "./components/Header";
import {
  getDistricts,
  getRisk,
  getScenario,
  postAllocate,
  type AllocateResponse,
  type DistrictProperties,
  type Lock,
  type PlanItem,
  type Reject,
  type RiskDistrict,
  type ScenarioResponse,
} from "./api/client";
import type { ViewMode } from "./hazard";
import { computeKpis } from "./metrics";
import "./App.css";
import "./redesign.css";

const PRESETS = [
  { label: "Dua bahaya Feb 2015", date: "2015-02-19" },
  { label: "Kemarau Sep 2023", date: "2023-09-15" },
  { label: "Musim hujan Jan 2024", date: "2024-01-15" },
];

const keyOf = (p: PlanItem) => `${p.district_id}:${p.resource}`;

export default function App() {
  const [scenario, setScenario] = useState<ScenarioResponse | null>(null);
  const [date, setDate] = useState<string>("2015-02-19");
  const [mode, setMode] = useState<ViewMode>("gabungan");
  const [view, setView] = useState<View>("peta");
  const [risk, setRisk] = useState<Map<string, RiskDistrict>>(new Map());
  const [result, setResult] = useState<AllocateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [locks, setLocks] = useState<Map<string, Lock>>(new Map());
  const [rejects, setRejects] = useState<Map<string, Reject>>(new Map());

  const [selected, setSelected] = useState<string | null>(null);
  const [selectedDepot, setSelectedDepot] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const propsRef = useRef<Map<string, DistrictProperties>>(new Map());
  const [districtMeta, setDistrictMeta] = useState<Map<string, DistrictProperties>>(new Map());

  const pushToast = useCallback((msg: string, kind: Toast["kind"]) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  useEffect(() => {
    getScenario().then(setScenario).catch((e) => setError(String(e)));
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
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, [date]);

  const reallocate = useCallback(() => {
    setLoading(true);
    postAllocate({
      date,
      locks: [...locks.values()],
      rejects: [...rejects.values()],
    })
      .then((res) => {
        setResult(res);
        setError(null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [date, locks, rejects]);

  useEffect(() => {
    reallocate();
  }, [reallocate]);

  const onLock = (p: PlanItem) => {
    const k = keyOf(p);
    const isLocking = !locks.has(k);
    setLocks((prev) => {
      const next = new Map(prev);
      if (next.has(k)) next.delete(k);
      else next.set(k, { district_id: p.district_id, resource: p.resource, units: p.units });
      return next;
    });
    if (isLocking)
      pushToast(
        `Dikunci: ${p.units} ${p.resource_label} ke ${p.district}. Rencana dioptimasi ulang di sekitarnya.`,
        "lock",
      );
    else pushToast(`Kunci dilepas untuk ${p.district}.`, "info");
  };
  const onReject = (p: PlanItem) => {
    const k = keyOf(p);
    setRejects((prev) => new Map(prev).set(k, { district_id: p.district_id, resource: p.resource }));
    setLocks((prev) => {
      if (!prev.has(k)) return prev;
      const next = new Map(prev);
      next.delete(k);
      return next;
    });
    pushToast(
      `Ditolak: ${p.resource_label} untuk ${p.district}. Sumber daya dialihkan.`,
      "reject",
    );
  };
  const onClearReject = (k: string) => {
    setRejects((prev) => {
      const next = new Map(prev);
      next.delete(k);
      return next;
    });
    pushToast("Penolakan dibatalkan. Rencana dioptimasi ulang.", "info");
  };

  const labelFor = useCallback((key: string) => {
    const [did, res] = key.split(":");
    const name = propsRef.current.get(did)?.name ?? did;
    return `${name} · ${res === "pompa" ? "pompa" : "truk tangki"}`;
  }, []);

  const plan = useMemo(() => result?.plan ?? [], [result]);
  const kpis = useMemo(() => computeKpis(risk, result), [risk, result]);
  const assignmentsForSelected = useMemo(
    () => plan.filter((p) => p.district_id === selected),
    [plan, selected],
  );
  const openDistrict = (id: string) => {
    setView("peta");
    setSelectedDepot(null);
    setSelected(id);
  };
  const onDepot = (depotId: string) => {
    setSelected(null);
    setSelectedDepot(depotId);
  };
  const depotObj = scenario?.depots.find((d) => d.depot_id === selectedDepot) ?? null;

  return (
    <div className="app">
      <Header />

      {error && <div className="errbar">Gagal memuat data: {error}</div>}

      <div className="body">
        <NavRail view={view} onView={setView} incidentCount={kpis.atRisk} lastUpdated={date} />

        {view === "peta" && (
          <div className="peta">
            <KpiStrip kpis={kpis} />
            <main className="content">
              <div className="map-wrap">
                <MapView
                  risk={risk}
                  mode={mode}
                  depots={scenario?.depots ?? []}
                  plan={plan}
                  onSelect={openDistrict}
                  onDepot={onDepot}
                />
                <Controls
                  mode={mode}
                  onMode={setMode}
                  date={date}
                  dateMin={scenario?.date_min ?? "2015-01-30"}
                  dateMax={scenario?.date_max ?? "2024-12-31"}
                  onDate={setDate}
                  presets={PRESETS}
                />
                <Legend mode={mode} />
                {selected && (
                  <DistrictDrawer
                    props={propsRef.current.get(selected) ?? null}
                    risk={risk.get(selected)}
                    population={risk.get(selected)?.population}
                    assignments={assignmentsForSelected}
                    onClose={() => setSelected(null)}
                  />
                )}
                {depotObj && (
                  <DepotDrawer
                    depot={depotObj}
                    result={result}
                    onClose={() => setSelectedDepot(null)}
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
                onSelect={openDistrict}
                labelFor={labelFor}
              />
            </main>
          </div>
        )}

        {view === "insiden" && (
          <Insiden
            risk={risk}
            plan={plan}
            date={date}
            districtMeta={districtMeta}
            kpis={kpis}
            onSelect={openDistrict}
          />
        )}
        {view === "inventaris" && (
          <Inventaris depots={scenario?.depots ?? []} result={result} note={scenario?.note} />
        )}
        {view === "ringkasan" && (
          <Overview risk={risk} result={result} date={date} onSelect={openDistrict} />
        )}
        {view === "tentang" && <About />}
      </div>

      <Toasts toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  );
}
