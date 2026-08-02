import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapView from "./components/MapView";
import Controls from "./components/Controls";
import Legend from "./components/Legend";
import Sidebar from "./components/Sidebar";
import CausalLoop from "./components/CausalLoop";
import DistrictDrawer from "./components/DistrictDrawer";
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
import "./App.css";

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
  const [risk, setRisk] = useState<Map<string, RiskDistrict>>(new Map());
  const [result, setResult] = useState<AllocateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [locks, setLocks] = useState<Map<string, Lock>>(new Map());
  const [rejects, setRejects] = useState<Map<string, Reject>>(new Map());

  const [selected, setSelected] = useState<string | null>(null);
  const propsRef = useRef<Map<string, DistrictProperties>>(new Map());
  const popRef = useRef<Map<string, number>>(new Map());

  // one-time: scenario + district props/population lookup
  useEffect(() => {
    getScenario().then(setScenario).catch((e) => setError(String(e)));
    getDistricts()
      .then((fc) => {
        for (const f of fc.features)
          propsRef.current.set(f.properties.district_id, f.properties);
      })
      .catch(() => {});
  }, []);

  // risk whenever date changes
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

  // (re)allocate when date / locks / rejects change
  const reallocate = useCallback(() => {
    setLoading(true);
    postAllocate({
      date,
      locks: [...locks.values()],
      rejects: [...rejects.values()],
    })
      .then((res) => {
        setResult(res);
        for (const p of res.plan) popRef.current.set(p.district_id, p.population);
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
    setLocks((prev) => {
      const next = new Map(prev);
      if (next.has(k)) next.delete(k);
      else next.set(k, { district_id: p.district_id, resource: p.resource, units: p.units });
      return next;
    });
  };
  const onReject = (p: PlanItem) => {
    const k = keyOf(p);
    setRejects((prev) => {
      const next = new Map(prev);
      next.set(k, { district_id: p.district_id, resource: p.resource });
      return next;
    });
    setLocks((prev) => {
      if (!prev.has(k)) return prev;
      const next = new Map(prev);
      next.delete(k);
      return next;
    });
  };
  const onClearReject = (k: string) =>
    setRejects((prev) => {
      const next = new Map(prev);
      next.delete(k);
      return next;
    });

  const labelFor = useCallback(
    (key: string) => {
      const [did, res] = key.split(":");
      const name = propsRef.current.get(did)?.name ?? did;
      const resLabel = res === "pompa" ? "pompa" : "truk tangki";
      return `${name} · ${resLabel}`;
    },
    [],
  );

  const plan = result?.plan ?? [];
  const assignmentsForSelected = useMemo(
    () => plan.filter((p) => p.district_id === selected),
    [plan, selected],
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-title">
          <span className="topbar-name">SIAGA</span>
          <span className="topbar-sub">
            Peringatan Dini Banjir–Kekeringan &amp; Prapenempatan Sumber Daya
          </span>
        </div>
        <div className="topbar-right">
          Koridor Pantura · Purwarupa{result ? ` · ${result.date}` : ""}
        </div>
      </header>

      {error && <div className="errbar">Gagal memuat data: {error}</div>}

      <main className="content">
        <div className="map-wrap">
          <MapView
            risk={risk}
            mode={mode}
            depots={scenario?.depots ?? []}
            plan={plan}
            onSelect={setSelected}
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
              population={popRef.current.get(selected)}
              assignments={assignmentsForSelected}
              onClose={() => setSelected(null)}
            />
          )}
        </div>
        <div className="right">
          <Sidebar
            result={result}
            loading={loading}
            locks={new Set(locks.keys())}
            rejects={new Set(rejects.keys())}
            onLock={onLock}
            onReject={onReject}
            onClearReject={onClearReject}
            onSelect={setSelected}
            labelFor={labelFor}
          />
          <CausalLoop />
        </div>
      </main>
    </div>
  );
}
