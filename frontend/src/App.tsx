import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapView from "./components/MapView";
import Controls, { type CompareMode } from "./components/Controls";
import CompareBanner from "./components/CompareBanner";
import Legend from "./components/Legend";
import Sidebar from "./components/Sidebar";
import DistrictDrawer from "./components/DistrictDrawer";
import DepotDrawer from "./components/DepotDrawer";
import NavRail, { type View } from "./components/NavRail";
import Overview from "./components/Overview";
import Insiden from "./components/Insiden";
import Inventaris from "./components/Inventaris";
import About from "./components/About";
import Toasts, { type Toast } from "./components/Toasts";
import Header from "./components/Header";
import ReplayControl from "./components/ReplayControl";
import {
  getDistricts,
  getRisk,
  getRiskRange,
  getScenario,
  postAllocate,
  type RiskRangeResponse,
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

type DisruptionTarget = Pick<
  PlanItem,
  "district_id" | "district" | "resource" | "resource_label" | "units"
>;

export default function App() {
  const [scenario, setScenario] = useState<ScenarioResponse | null>(null);
  const [date, setDate] = useState<string>("2015-02-19");
  const [mode, setMode] = useState<ViewMode>("gabungan");
  const [compare, setCompare] = useState<CompareMode>("siaga");
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

  // Hindcast replay: sweep the 3 weeks leading into the selected date. While
  // active, risk frames come from the prefetched range (no per-day fetches,
  // no re-solves) and the allocation is hidden until the "decision" lands.
  const [replay, setReplay] = useState<{ dates: string[]; idx: number } | null>(null);
  const [replayLoading, setReplayLoading] = useState(false);
  const replayDataRef = useRef<RiskRangeResponse | null>(null);
  const replayTimerRef = useRef<number | null>(null);
  const replayRequestRef = useRef(0);
  const [disruption, setDisruption] = useState<DisruptionTarget | null>(null);
  const disruptionRef = useRef<DisruptionTarget | null>(null);
  const dateRef = useRef(date);
  dateRef.current = date;
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

  // Coverage delta between consecutive re-solves on the same date: the
  // visible cost/benefit of each Kunci/Tolak decision.
  const [coverageDelta, setCoverageDelta] = useState<number | null>(null);
  const prevCoveredRef = useRef<{ date: string; covered: number } | null>(null);
  const deltaTimerRef = useRef<number | null>(null);
  const allocationRequestRef = useRef(0);

  const reallocate = useCallback(() => {
    const requestId = ++allocationRequestRef.current;
    setLoading(true);
    postAllocate({
      date,
      locks: [...locks.values()],
      rejects: [...rejects.values()],
    })
      .then((res) => {
        if (requestId !== allocationRequestRef.current) return;
        setResult(res);
        setError(null);
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

        const disrupted = disruptionRef.current;
        if (disrupted) {
          const rejectedStillPresent = res.plan.some(
            (item) => item.district_id === disrupted.district_id && item.resource === disrupted.resource,
          );
          const replacement = res.plan.find(
            (item) => item.resource === disrupted.resource && item.district_id !== disrupted.district_id,
          );
          if (rejectedStillPresent) {
            pushToast(`Pengalihan ${disrupted.resource_label} belum berhasil diterapkan.`, "reject");
          } else if (replacement) {
            pushToast(
              `Rute diperbarui: ${disrupted.resource_label} dari ${disrupted.district} dialihkan ke ${replacement.district}.`,
              "info",
            );
          } else {
            pushToast(
              `Rute ke ${disrupted.district} ditutup; ${disrupted.resource_label} dilepas dari rencana aktif.`,
              "info",
            );
          }
          disruptionRef.current = null;
          setDisruption(null);
        }
      })
      .catch((e) => {
        if (requestId !== allocationRequestRef.current) return;
        const message = String(e);
        setError(message);
        if (disruptionRef.current) {
          pushToast("Pengalihan rute gagal. Periksa koneksi backend lalu coba lagi.", "reject");
          disruptionRef.current = null;
          setDisruption(null);
        }
      })
      .finally(() => {
        if (requestId === allocationRequestRef.current) setLoading(false);
      });
  }, [date, locks, pushToast, rejects]);

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
        setError(String(e));
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
        const message = String(e);
        setError(message);
        setReplayLoading(false);
        pushToast("Putar ulang tidak dapat dimulai untuk tanggal ini.", "reject");
      });
  }, [applyReplayFrame, pushToast, replayLoading, stopReplay]);

  // Scripted disruption: a field report cuts the route to the top flood
  // allocation; the operator rejects it and watches the plan re-route. Same
  // mechanics as a manual Tolak — only the narrative differs.
  const simulateDisruption = useCallback(() => {
    if (loading || disruptionRef.current) return;
    const p = result?.plan ?? [];
    const top = p.find((x) => x.resource === "pompa") ?? p[0];
    if (!top) {
      pushToast("Belum ada alokasi aktif yang dapat dialihkan.", "info");
      return;
    }
    const target: DisruptionTarget = {
      district_id: top.district_id,
      district: top.district,
      resource: top.resource,
      resource_label: top.resource_label,
      units: top.units,
    };
    disruptionRef.current = target;
    setDisruption(target);
    const k = keyOf(top);
    setRejects((prev) =>
      new Map(prev).set(k, { district_id: top.district_id, resource: top.resource }),
    );
    setLocks((prev) => {
      if (!prev.has(k)) return prev;
      const next = new Map(prev);
      next.delete(k);
      return next;
    });
    pushToast(
      `Laporan diterima: akses ke ${top.district} terputus. Optimizer sedang mengalihkan ${top.units} ${top.resource_label}.`,
      "reject",
    );
  }, [loading, result, pushToast]);

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
  const kpis = useMemo(() => computeKpis(risk, result), [risk, result]);
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
      <Header
        date={date}
        dateMin={scenario?.date_min ?? "2015-01-30"}
        dateMax={scenario?.date_max ?? "2024-12-31"}
        monitoringCount={kpis.aboveMonitoring}
        presets={PRESETS}
        onDate={setDate}
        disabled={replayLoading || replay !== null}
      />

      {error && <div className="errbar">Gagal memuat data: {error}</div>}

      <div className="body">
        <NavRail view={view} onView={setView} monitoringCount={kpis.aboveMonitoring} lastUpdated={date} />

        {view === "peta" && (
          <div className="peta">
            <section className="briefing-band" aria-label="Ringkasan situasi">
              <div className="briefing-intro">
                <div className="briefing-eyebrow">
                  <span className="briefing-pulse" /> Situasi koridor Pantura
                </div>
                <h1>Peta &amp; alokasi</h1>
                <p>Banjir 0–72 jam · cekaman air bulan depan</p>
              </div>
              <MapSituationStrip
                monitored={kpis.aboveMonitoring}
                planned={kpis.served}
                proactive={kpis.proactiveAllocations}
                fleetPct={kpis.fleetPct}
              />
            </section>
            <main className="content">
              <div className="map-wrap">
                <MapView
                  risk={risk}
                  mode={mode}
                  depots={scenario?.depots ?? []}
                  plan={mapPlan}
                  onSelect={openDistrict}
                  onDepot={onDepot}
                />
                <Controls
                  mode={mode}
                  onMode={setMode}
                  compare={compare}
                  onCompare={setCompare}
                  onReplay={startReplay}
                  onDisrupt={simulateDisruption}
                  disabled={!!replay}
                  replayLoading={replayLoading}
                  disrupting={disruption !== null}
                  canDisrupt={compare === "siaga" && !loading && (result?.plan.length ?? 0) > 0}
                />
                {replay && (
                  <ReplayControl
                    dates={replay.dates}
                    idx={replay.idx}
                    onStop={() => stopReplay(false)}
                    restoring={replayLoading}
                  />
                )}
                <div className="map-left-stack">
                  {!replay && result?.comparison && (
                    <CompareBanner comparison={result.comparison} compare={compare} />
                  )}
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
                    population={risk.get(selected)?.population}
                    assignments={assignmentsForSelected}
                    date={date}
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
                readonly={compare === "terpisah"}
                coverageDelta={coverageDelta}
                crew={crew}
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
            onSelect={openDistrict}
          />
        )}
        {view === "inventaris" && (
          <Inventaris depots={scenario?.depots ?? []} result={result} note={scenario?.note} />
        )}
        {view === "ringkasan" && (
          <Overview
            risk={risk}
            result={result}
            date={date}
            locks={new Set(locks.keys())}
            rejects={new Set(rejects.keys())}
            onSelect={openDistrict}
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

      <Toasts toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  );
}

function MapSituationStrip({ monitored, planned, proactive, fleetPct }: { monitored: number; planned: number; proactive: number; fleetPct: number }) {
  return (
    <div className="map-situation-strip" aria-label="Ringkasan keputusan peta">
      <div title="Ambang Pemantauan 50% hanya menandai wilayah untuk kesadaran situasi; tidak memicu alokasi otomatis."><span>Ambang Pemantauan</span><b>{monitored.toLocaleString("id-ID")}</b><small>peluang ≥50% · visual</small></div>
      <div><span>Dipilih optimizer</span><b>{planned.toLocaleString("id-ID")}</b><small>kecamatan dalam rencana</small></div>
      <div className={proactive > 0 ? "is-proactive" : ""} title="Wilayah di bawah Ambang Pemantauan dapat tetap dipilih optimizer mulai peluang 5%."><span>Alokasi preventif</span><b>{proactive.toLocaleString("id-ID")}</b><small>di bawah pemantauan 50%</small></div>
      <div><span>Armada digunakan</span><b>{fleetPct}%</b><small>pompa &amp; truk</small></div>
    </div>
  );
}
